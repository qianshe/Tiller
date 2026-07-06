import type { AcpAgentProvider, SessionResumeInfo, SessionSummary, WorktreeSummary } from "@tiller/shared";
import { resolveProviderById } from "@tiller/agent-registry";
import type { AcpProtocolLoggingOptions, SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { HelmHandlerContext } from "../../handlers/context";
import type { StoredSessionRuntimeDescriptor } from "../../sessions/facade";
import type { SessionRecord } from "./services";
import type { ProviderLifecyclePort } from "../provider-lifecycle";
import type { createProviderHistoryService } from "../provider-history/service";
import { createRestoreReplayBuffer, hasRestoreReplayContent } from "../replay/event-buffer";
import { buildSessionResumeInfo, markSessionResumeUnavailable } from "../resume-info";
import { resolveProviderHistorySnapshot } from "../provider-history/source";
import {
  MIGRATE_LEGACY_RESUMED_TO_COMPACTION_ONLY,
  repairCompactionBootstrapTimeline,
} from "../session-timeline/compaction-bootstrap";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "./config-options";
import type { TillerLogger } from "../../logging/logger";

type ResumePreconditionInput = {
  agent: AcpAgentProvider | undefined;
  worktree: WorktreeSummary | undefined;
  runtimeSessionId?: string;
  restoreMethod?: SessionResumeInfo["restoreMethod"];
  agentId: string;
  cwd?: string;
};

type SessionResumeServiceOptions = {
  sessions: Map<string, SessionRecord>;
  sessionStore: {
    list(): SessionSummary[];
    upsert(summary: SessionSummary): void;
  };
  sessionMessageStore: {
    list(sessionId: string): unknown[];
    replace(sessionId: string, messages: unknown[]): void;
  };
  sessionArtifactStore: { remove(sessionId: string): void };
  sessionRuntimeStore: { get(sessionId: string): StoredSessionRuntimeDescriptor | null | undefined };
  providerLifecycle: ProviderLifecyclePort;
  providerHistory: ReturnType<typeof createProviderHistoryService>;
  getAgents(): AcpAgentProvider[];
  getProjects(): Array<{ id: string; path?: string }>;
  createHandlerContext(): HelmHandlerContext;
  resolveStoredSessionWorktree(summary: SessionSummary): WorktreeSummary | undefined;
  buildResumeInfo(summary: SessionSummary, agent: AcpAgentProvider | undefined): SessionResumeInfo;
  hydrateSessionSummary(summary: SessionSummary): SessionSummary;
  persistRuntimeDescriptor(summary: SessionSummary, agent: AcpAgentProvider | undefined, capabilities?: StoredSessionRuntimeDescriptor["capabilities"]): void;
  handleRuntimeEvent(sessionId: string, event: SessionRuntimeEvent): void;
  logConnectionLifecycle(event: Parameters<ProviderLifecyclePort["createRuntime"]>[0] extends { onConnectionLifecycleEvent?: infer Handler }
    ? Handler extends (event: infer Event) => void
      ? Event
      : never
    : never): void;
  logger?: Pick<TillerLogger, "debug" | "error">;
  logInfo(message: string): void;
  logError(message: string): void;
  protocolLogging?: AcpProtocolLoggingOptions;
};

const RESTORE_REPLAY_SETTLE_MS = 100;
const RESTORE_REPLAY_MAX_WAIT_MS = 2_000;

export function createSessionResumeService(options: SessionResumeServiceOptions) {
  async function startSessionResume(
    sessionId: string,
    resumeOptions: { forceReloadActive?: boolean } = {},
  ) {
    const activeRecord = options.sessions.get(sessionId);
    if (activeRecord && !resumeOptions.forceReloadActive) {
      await options.providerHistory.refreshAuthoritativeSessionHistory(sessionId);
      const resume = options.buildResumeInfo(activeRecord.summary, activeRecord.agent);
      logResumeInfo(options, "runtime.session_reconnect.active", {
        sessionId,
        runtimeSessionId: resume.runtimeSessionId ?? "unknown",
      });
      return {
        ok: true,
        resume,
        message: "Client reconnected to the still-running Helm session; no ACP restore was needed.",
      };
    }

    const summary = activeRecord?.summary ?? options.sessionStore.list().find((item) => item.id === sessionId);
    if (!summary) {
      const now = new Date().toISOString();
      return {
        ok: false,
        resume: {
          mode: "none" as const,
          state: "resume-unavailable" as const,
          reason: "Session not found.",
          checkedAt: now,
        },
        message: "Session not found.",
      };
    }

    const agent = activeRecord?.agent ?? resolveProviderById(summary.agentId, options.getAgents());
    const worktree = activeRecord?.worktree ?? options.resolveStoredSessionWorktree(summary);
    const resume = activeRecord && resumeOptions.forceReloadActive
      ? buildSessionResumeInfo(
          summary,
          agent,
          undefined,
          {
            ...(options.sessionRuntimeStore.get(sessionId) ?? {}),
            sessionId,
            providerId: summary.agentId,
            runtimeSessionId: activeRecord.runtime.runtimeSessionId,
            capabilities: activeRecord.runtime.sessionCapabilities,
            lastSeenAt: summary.updatedAt,
            state: "resumeable",
          },
        )
      : options.buildResumeInfo(summary, agent);
    const unavailableReason = resolveResumeUnavailableReason({
      agent,
      worktree,
      runtimeSessionId: resume.runtimeSessionId,
      restoreMethod: resume.restoreMethod,
      agentId: summary.agentId,
      cwd: summary.cwd ?? options.getProjects().find((item) => item.id === summary.projectId)?.path,
    });
    if (unavailableReason) {
      return {
        ok: false,
        resume: markSessionResumeUnavailable(resume, unavailableReason),
        message: unavailableReason,
      };
    }
    const restoreAgent = agent as AcpAgentProvider;
    const restoreWorktree = worktree as WorktreeSummary;
    const restoreRuntimeSessionId = resume.runtimeSessionId as string;
    const restoreMethod = resume.restoreMethod as "session/load" | "session/resume";

    try {
      logResumeInfo(options, "runtime.session_restore.started", {
        sessionId,
        runtimeSessionId: restoreRuntimeSessionId,
        method: restoreMethod,
      });
      const handlerContext = options.createHandlerContext();
      const restoreReplayBuffer = createRestoreReplayBuffer(
        sessionId,
        handlerContext,
        {
          runtimeSessionId: restoreRuntimeSessionId,
          providerId: restoreAgent.id,
        },
      );
      let lastRestoreReplayEventAt = 0;
      logResumeInfo(options, "runtime.restore_replay.opened", { sessionId });
      if (activeRecord && resumeOptions.forceReloadActive) {
        // Drop the existing ACP session reference first; otherwise the shared
        // connection reuses it and never sends session/load.
        await activeRecord.runtime.close();
      }
      const runtime = await options.providerLifecycle.createRuntime({
        sessionId,
        worktree: restoreWorktree,
        agent: restoreAgent,
        sessionConfig: {
          model: summary.model,
          reasoningEffort: summary.reasoningEffort,
        },
        restore: {
          runtimeSessionId: restoreRuntimeSessionId,
          strategy: restoreMethod === "session/load" ? "load" : "resume",
          replayBaselineMessages: options.sessionMessageStore.list(sessionId),
        },
        protocolLogging: options.protocolLogging,
        onEvent: (event) => options.handleRuntimeEvent(sessionId, event),
        onRestoreReplayEvent: (event) => {
          lastRestoreReplayEventAt = Date.now();
          restoreReplayBuffer.add(event);
        },
        onConnectionLifecycleEvent: options.logConnectionLifecycle,
      });
      await waitForRestoreReplayToSettle(() => lastRestoreReplayEventAt);
      const replaySnapshot = restoreReplayBuffer.snapshot();
      options.providerHistory.recordSessionPlan?.(sessionId, replaySnapshot.plan);
      const localTimeline = handlerContext.sessionTimelineStore?.list?.(sessionId) ?? [];
      if (
        MIGRATE_LEGACY_RESUMED_TO_COMPACTION_ONLY &&
        handlerContext.sessionTimelineStore?.replace &&
        localTimeline.length > 0
      ) {
        const repairedTimeline = repairCompactionBootstrapTimeline({
          sessionId,
          timeline: localTimeline,
          messages: replaySnapshot.messages,
          providerId: restoreAgent.id,
          restoreMethod,
        });
        if (repairedTimeline) {
          handlerContext.sessionTimelineStore.replace(sessionId, repairedTimeline.entries);
          logResumeInfo(options, "runtime.restore_replay.compaction_repaired", {
            sessionId,
            entries: repairedTimeline.entries.length,
            synthesizedBoundary: repairedTimeline.synthesizedBoundary,
          });
        }
      }

      if (replaySnapshot.toolCalls.length || replaySnapshot.outputs.length || replaySnapshot.diffs.length) {
        options.sessionArtifactStore.remove(sessionId);
      }
      const replayCounts = restoreReplayBuffer.flush({ persistLocalStores: false });
      if (hasRestoreReplayContent(replayCounts)) {
        logResumeInfo(options, "runtime.restore_replay.completed", {
          sessionId,
          ...replayCounts,
        });
      }
      // ACP replay can restore runtime context, but canonical display history
      // stays owned by local sessionTimelineStore. Never replace local
      // transcript here.
      const historySnapshot = await resolveProviderHistorySnapshot([
        {
          source: "acp-session-load",
          load: async () => (options.providerHistory.hasHistoryContent(replaySnapshot) ? replaySnapshot : null),
        },
      ]);
      if (historySnapshot?.source === "acp-session-load") {
        logResumeInfo(options, "runtime.history_cache.loaded", {
          source: "acp-session-load",
          sessionId,
          messages: historySnapshot.messages.length,
          toolCalls: historySnapshot.toolCalls.length,
          outputs: historySnapshot.outputs.length,
          diffs: historySnapshot.diffs.length,
          planEntries: historySnapshot.plan?.entries.length ?? 0,
        });
      }
      const restoredRuntimeModel =
        runtime.sessionConfigState?.model ??
        runtime.sessionModelState?.currentModelId;
      const restoredModel = restoredRuntimeModel ?? summary.model;
      const resolvedRestoredConfigOptions = resolveConfigOptionsForSelection({
        incomingOptions: runtime.sessionConfigOptions,
        previousOptions: summary.configOptions,
        selectedModel: restoredModel,
      });
      const restoredConfigOptions = resolvedRestoredConfigOptions.options;
      const restoredSummary = options.hydrateSessionSummary({
        ...summary,
        model: restoredModel,
        modelOptions: runtime.sessionModelState?.options ?? summary.modelOptions,
        configOptions: restoredConfigOptions,
        reasoningEffort: resolveConfigReasoningEffortForOptions(
          summary.reasoningEffort ?? runtime.sessionConfigState?.reasoningEffort,
          resolvedRestoredConfigOptions,
        ),
        runtimeSessionId: runtime.runtimeSessionId,
        status: "idle",
        updatedAt: new Date().toISOString(),
      });
      options.sessions.set(sessionId, { summary: restoredSummary, agent: restoreAgent, worktree: restoreWorktree, runtime });
      options.sessionStore.upsert(restoredSummary);
      options.persistRuntimeDescriptor(restoredSummary, restoreAgent, runtime.sessionCapabilities);
      logResumeInfo(options, "runtime.session_restore.completed", {
        sessionId,
        runtimeSessionId: runtime.runtimeSessionId,
        method: restoreMethod,
      });
      return {
        ok: true,
        resume: options.buildResumeInfo(restoredSummary, restoreAgent),
        session: restoredSummary,
        message: `ACP ${restoreMethod} completed for this session.`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "ACP restore failed.";
      logResumeError(options, "runtime.session_restore.failed", {
        sessionId,
        runtimeSessionId: restoreRuntimeSessionId,
        method: restoreMethod,
        providerId: restoreAgent.id,
        errorMessage,
      });
      return {
        ok: false,
        resume: {
          ...resume,
          state: "resume-unavailable" as const,
          reason: errorMessage,
          checkedAt: new Date().toISOString(),
        },
        message: errorMessage,
      };
    }
  }

  return { startSessionResume };
}

async function waitForRestoreReplayToSettle(getLastEventAt: () => number) {
  const startedAt = Date.now();
  while (true) {
    const now = Date.now();
    const lastEventAt = getLastEventAt();
    const quietFor = lastEventAt ? now - lastEventAt : now - startedAt;
    const elapsed = now - startedAt;
    if (quietFor >= RESTORE_REPLAY_SETTLE_MS || elapsed >= RESTORE_REPLAY_MAX_WAIT_MS) {
      return;
    }
    await sleep(Math.min(
      RESTORE_REPLAY_SETTLE_MS - quietFor,
      RESTORE_REPLAY_MAX_WAIT_MS - elapsed,
    ));
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function logResumeInfo(
  options: SessionResumeServiceOptions,
  event: string,
  fields: Record<string, unknown>,
) {
  if (options.logger) {
    options.logger.debug(event, fields);
    return;
  }
  options.logInfo(`[tiller] ${event} ${formatLogFields(fields)}`);
}

function logResumeError(
  options: SessionResumeServiceOptions,
  event: string,
  fields: Record<string, unknown>,
) {
  if (options.logger) {
    options.logger.error(event, fields);
    return;
  }
  options.logError(`[tiller] ${event} ${formatLogFields(fields)}`);
}

function formatLogFields(fields: Record<string, unknown>) {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

function resolveResumeUnavailableReason({
  agent,
  worktree,
  runtimeSessionId,
  restoreMethod,
  agentId,
  cwd,
}: ResumePreconditionInput): string | null {
  if (!agent) {
    return `Agent provider ${agentId} is not configured.`;
  }
  if (!worktree) {
    return cwd
      ? `Worktree path ${cwd} is not configured or does not exist.`
      : "Worktree cwd is not configured.";
  }
  if (!runtimeSessionId) {
    return "ACP runtime session id is missing.";
  }
  if (restoreMethod !== "session/load" && restoreMethod !== "session/resume") {
    return `ACP restore method ${restoreMethod ?? "none"} is unsupported.`;
  }
  return null;
}
