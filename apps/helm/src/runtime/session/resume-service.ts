import type { AcpAgentProvider, SessionResumeInfo, SessionSummary, WorktreeSummary } from "@tiller/shared";
import { resolveProviderById } from "@tiller/agent-registry";
import type { AcpProtocolLoggingOptions, SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { StoredSessionRuntimeDescriptor } from "../../sessions/facade";
import type { SessionRecord } from "./services";
import type { ProviderLifecyclePort } from "../provider-lifecycle";
import { buildSessionResumeInfo, markSessionResumeUnavailable } from "../resume-info";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "./config-options";
import type { TillerLogger } from "../../logging/logger";
import { createSessionBootstrapEvents } from "./event/bootstrap";

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
    get(sessionId: string): SessionSummary | undefined;
    upsert(summary: SessionSummary): void;
  };
  sessionRuntimeStore: { get(sessionId: string): StoredSessionRuntimeDescriptor | null | undefined };
  providerLifecycle: ProviderLifecyclePort;
  getAgents(): AcpAgentProvider[];
  getProjects(): Array<{ id: string; path?: string }>;
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
  logger?: Pick<TillerLogger, "debug" | "warn" | "error">;
  logInfo(message: string): void;
  logError(message: string): void;
  protocolLogging?: AcpProtocolLoggingOptions;
};

export function createSessionResumeService(options: SessionResumeServiceOptions) {
  async function startSessionResume(
    sessionId: string,
    resumeOptions: { forceReloadActive?: boolean } = {},
  ) {
    const activeRecord = options.sessions.get(sessionId);
    if (activeRecord && !resumeOptions.forceReloadActive) {
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

    const summary = activeRecord?.summary ?? options.sessionStore.get(sessionId);
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
          replayBaselineMessages: [],
        },
        protocolLogging: options.protocolLogging,
        onEvent: (event) => options.handleRuntimeEvent(sessionId, event),
        onRestoreReplayEvent: () => undefined,
        onConnectionLifecycleEvent: options.logConnectionLifecycle,
      });
      const loadedRuntimeModel =
        runtime.sessionConfigState?.model ?? runtime.sessionModelState?.currentModelId;
      const requestedModel = summary.model !== loadedRuntimeModel ? summary.model : undefined;
      const requestedReasoningEffort =
        summary.reasoningEffort !== runtime.sessionConfigState?.reasoningEffort
          ? summary.reasoningEffort
          : undefined;
      let restoredConfigResult: Awaited<ReturnType<typeof runtime.configure>> | undefined;
      let restoreConfigErrorMessage: string | undefined;
      if (requestedModel || requestedReasoningEffort) {
        try {
          restoredConfigResult = await runtime.configure({
            model: requestedModel,
            reasoningEffort: requestedReasoningEffort,
          });
        } catch (error) {
          restoreConfigErrorMessage =
            error instanceof Error
              ? error.message
              : "Runtime rejected the persisted session config.";
        }
      }
      const restoredRuntimeState = restoredConfigResult?.state ?? runtime.sessionConfigState;
      const restoredModelState = restoredConfigResult?.modelState ?? runtime.sessionModelState;
      const restoredRuntimeModel =
        restoredRuntimeState?.model ?? restoredModelState?.currentModelId ?? loadedRuntimeModel;
      const restoredRuntimeReasoningEffort =
        restoredRuntimeState?.reasoningEffort ?? runtime.sessionConfigState?.reasoningEffort;
      if (
        (requestedModel && restoredRuntimeModel !== summary.model) ||
        (requestedReasoningEffort && restoredRuntimeReasoningEffort !== summary.reasoningEffort)
      ) {
        logResumeWarning(options, "runtime.session_restore.config_not_applied", {
          sessionId,
          requestedModel: requestedModel ?? "unchanged",
          actualModel: restoredRuntimeModel ?? "unknown",
          requestedReasoningEffort: requestedReasoningEffort ?? "unchanged",
          actualReasoningEffort: restoredRuntimeReasoningEffort ?? "unknown",
          errorMessage: restoreConfigErrorMessage ?? "unsupported",
        });
      }
      const restoredModel = restoredRuntimeModel ?? summary.model;
      const resolvedRestoredConfigOptions = resolveConfigOptionsForSelection({
        incomingOptions: restoredConfigResult?.options ?? runtime.sessionConfigOptions,
        previousOptions: summary.configOptions,
        selectedModel: restoredModel,
      });
      const restoredConfigOptions = resolvedRestoredConfigOptions.options;
      const restoredSummary = options.hydrateSessionSummary({
        ...summary,
        model: restoredModel,
        modelOptions: restoredModelState?.options ?? summary.modelOptions,
        configOptions: restoredConfigOptions,
        reasoningEffort: resolveConfigReasoningEffortForOptions(
          restoredRuntimeReasoningEffort ?? summary.reasoningEffort,
          resolvedRestoredConfigOptions,
        ),
        runtimeSessionId: runtime.runtimeSessionId,
        status: "idle",
        updatedAt: new Date().toISOString(),
      });
      options.sessions.set(sessionId, { summary: restoredSummary, agent: restoreAgent, worktree: restoreWorktree, runtime });
      options.sessionStore.upsert(restoredSummary);
      options.persistRuntimeDescriptor(restoredSummary, restoreAgent, runtime.sessionCapabilities);
      for (const event of createSessionBootstrapEvents(restoredSummary)) {
        options.handleRuntimeEvent(sessionId, event);
      }
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

function logResumeWarning(
  options: SessionResumeServiceOptions,
  event: string,
  fields: Record<string, unknown>,
) {
  if (options.logger) {
    options.logger.warn(event, fields);
    return;
  }
  options.logInfo(`[tiller] warning ${event} ${formatLogFields(fields)}`);
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
