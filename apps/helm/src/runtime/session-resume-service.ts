import type { AcpAgentProvider, SessionResumeInfo, SessionSummary, WorktreeSummary } from "@tiller/shared";
import { resolveProviderById } from "@tiller/agent-registry";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { HelmHandlerContext } from "../handlers/context";
import type { StoredSessionRuntimeDescriptor } from "../sessions/facade";
import type { SessionRecord } from "./session-services";
import type { ProviderLifecyclePort } from "./provider-lifecycle";
import type { createProviderHistoryService } from "./provider-history-service";
import { createRestoreReplayBuffer } from "./replay-event-buffer";
import { buildSessionResumeInfo, markSessionResumeUnavailable } from "./resume-info";
import { resolveProviderHistorySnapshot } from "./provider-history-source";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "./session-config-options";

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
  logInfo(message: string): void;
  logError(message: string): void;
};

export function createSessionResumeService(options: SessionResumeServiceOptions) {
  async function startSessionResume(
    sessionId: string,
    resumeOptions: { forceReloadActive?: boolean } = {},
  ) {
    const activeRecord = options.sessions.get(sessionId);
    if (activeRecord && !resumeOptions.forceReloadActive) {
      await options.providerHistory.refreshAuthoritativeSessionHistory(sessionId);
      const resume = options.buildResumeInfo(activeRecord.summary, activeRecord.agent);
      options.logInfo(
        `[tiller] client reconnect session=${sessionId} runtime=${resume.runtimeSessionId ?? "unknown"}`,
      );
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
      options.logInfo(
        `[tiller] 阶段=恢复旧会话开始 session=${sessionId} runtime=${restoreRuntimeSessionId} method=${restoreMethod}`,
      );
      const restoreReplayBuffer = createRestoreReplayBuffer(
        sessionId,
        options.createHandlerContext(),
      );
      options.logInfo(
        `[tiller] 阶段=恢复重放缓存打开 session=${sessionId}`,
      );
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
        onEvent: (event) => options.handleRuntimeEvent(sessionId, event),
        onRestoreReplayEvent: (event) => {
          restoreReplayBuffer.add(event);
        },
        onConnectionLifecycleEvent: options.logConnectionLifecycle,
      });
      const replaySnapshot = restoreReplayBuffer.snapshot();
      if (replaySnapshot.messages.length) {
        options.sessionMessageStore.replace(sessionId, []);
      }
      if (replaySnapshot.toolCalls.length || replaySnapshot.outputs.length || replaySnapshot.diffs.length) {
        options.sessionArtifactStore.remove(sessionId);
      }
      const replayCounts = restoreReplayBuffer.flush();
      options.logInfo(
        `[tiller] 阶段=恢复重放缓存完成 session=${sessionId} messages=${replayCounts.messages} toolCalls=${replayCounts.toolCalls} outputs=${replayCounts.outputs} diffs=${replayCounts.diffs}`,
      );
      const historySnapshot = await resolveProviderHistorySnapshot([
        {
          source: "acp-session-load",
          load: async () => (options.providerHistory.hasHistoryContent(replaySnapshot) ? replaySnapshot : null),
        },
        {
          source: "adapter-authoritative-history",
          load: async () => {
            try {
              return await options.providerHistory.loadAdapterHistoryContent(restoreAgent, restoreRuntimeSessionId, restoreWorktree.path);
            } catch (error) {
              options.logError(
                `[tiller] provider.export.history failed session=${sessionId}: ${error instanceof Error ? error.message : "Provider history export failed."}`,
              );
              return null;
            }
          },
        },
        {
          source: "local-cache",
          load: async () => options.providerHistory.readLocalProviderHistory(sessionId),
        },
      ]);
      if (historySnapshot?.source === "acp-session-load") {
        options.logInfo(
          `[tiller] history.cache source=acp-session-load session=${sessionId} messages=${historySnapshot.messages.length} toolCalls=${historySnapshot.toolCalls.length} outputs=${historySnapshot.outputs.length} diffs=${historySnapshot.diffs.length}`,
        );
      } else if (historySnapshot?.source === "adapter-authoritative-history") {
        options.providerHistory.applyAuthoritativeProviderHistory(sessionId, restoreAgent, restoreRuntimeSessionId, historySnapshot);
      }
      if (activeRecord && resumeOptions.forceReloadActive) {
        activeRecord.runtime.cancel();
      }
      const restoredModel = summary.model ?? runtime.sessionConfigState?.model;
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
      options.logInfo(
        `[tiller] 阶段=恢复旧会话完成 session=${sessionId} runtime=${runtime.runtimeSessionId} method=${restoreMethod}`,
      );
      return {
        ok: true,
        resume: options.buildResumeInfo(restoredSummary, restoreAgent),
        message: `ACP ${restoreMethod} completed for this session.`,
      };
    } catch (error) {
      options.logError(
        `[tiller] 阶段=恢复旧会话失败 session=${sessionId} message=${error instanceof Error ? error.message : "ACP restore failed."}`,
      );
      return {
        ok: false,
        resume: {
          ...resume,
          state: "resume-unavailable" as const,
          reason: error instanceof Error ? error.message : "ACP restore failed.",
          checkedAt: new Date().toISOString(),
        },
        message: error instanceof Error ? error.message : "ACP restore failed.",
      };
    }
  }

  return { startSessionResume };
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
