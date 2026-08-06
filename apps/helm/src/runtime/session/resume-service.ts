import type {
  AcpAgentProvider,
  SessionResumeInfo,
  SessionSummary,
  WorktreeSummary,
} from "@tiller/shared";
import { resolveProviderById } from "@tiller/agent-registry";
import type { AcpProtocolLoggingOptions, SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { NotificationRaisedParams } from "@tiller/sync-protocol";
import type { StoredSessionRuntimeDescriptor } from "../../sessions/facade";
import type { SessionRecord } from "./services";
import type { HelmRuntimeHandle, ProviderLifecyclePort } from "../provider-lifecycle";
import { buildSessionResumeInfo, markSessionResumeUnavailable } from "../resume-info";
import {
  isReasoningConfigOption,
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "./config-options";
import type { TillerLogger } from "../../logging/logger";
import { createSessionBootstrapEvents } from "./event/bootstrap";

type PendingConfig = NonNullable<StoredSessionRuntimeDescriptor["pendingConfig"]>;
type RuntimeConfigureResult = Awaited<ReturnType<HelmRuntimeHandle["configure"]>>;

function hasAdvertisedConfigValue(
  option: RuntimeConfigureResult["options"][number] | undefined,
  value: string | boolean,
) {
  const choices = option?.options ?? [];
  return choices.length > 0 && choices.some((choice) => choice.value === value);
}

function isUnavailableReasoningEffort(value: string, result: RuntimeConfigureResult) {
  const option = result.options.find((candidate) => isReasoningConfigOption(candidate));
  const choices = option?.options ?? [];
  return choices.length > 0 && !hasAdvertisedConfigValue(option, value);
}

function isUnavailableReasoningConfigOption(
  configId: string,
  value: string | boolean,
  result: RuntimeConfigureResult,
) {
  if (typeof value !== "string") {
    return false;
  }
  const option = result.options.find((candidate) => candidate.id === configId);
  return Boolean(
    option &&
    isReasoningConfigOption(option) &&
    (option.options?.length ?? 0) > 0 &&
    !hasAdvertisedConfigValue(option, value),
  );
}

function hasCategoryConfig(config: PendingConfig): boolean {
  return (
    config.agentMode !== undefined ||
    config.model !== undefined ||
    config.reasoningEffort !== undefined
  );
}

function categoryConfigWasApplied(config: PendingConfig, result: RuntimeConfigureResult): boolean {
  const appliedModel = result.state.model ?? result.modelState?.currentModelId;
  return (
    (config.agentMode === undefined || result.state.agentMode === config.agentMode) &&
    (config.model === undefined || appliedModel === config.model) &&
    (config.reasoningEffort === undefined ||
      result.state.reasoningEffort === config.reasoningEffort ||
      isUnavailableReasoningEffort(config.reasoningEffort, result))
  );
}

function directConfigWasApplied(
  configId: string,
  value: string | boolean,
  result: RuntimeConfigureResult,
): boolean {
  const appliedOption = result.options.find((option) => option.id === configId);
  const appliedValue =
    appliedOption?.currentValue ?? appliedOption?.selectedValue ?? appliedOption?.value;
  return appliedValue === value;
}

async function applyPendingRuntimeConfig(
  runtime: HelmRuntimeHandle,
  config: PendingConfig,
): Promise<RuntimeConfigureResult> {
  let result: RuntimeConfigureResult | undefined;
  if (hasCategoryConfig(config)) {
    result = await runtime.configure({
      agentMode: config.agentMode,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
    });
    if (!categoryConfigWasApplied(config, result)) {
      throw new Error("Saved session config could not be applied after ACP restore.");
    }
  }
  if (!result && (config.configOptions?.length ?? 0) > 0) {
    // Read the restored ACP options before applying direct values so stale
    // reasoning settings can be skipped without sending a rejected request.
    result = await runtime.configure({});
  }
  for (const option of config.configOptions ?? []) {
    if (result && isUnavailableReasoningConfigOption(option.configId, option.value, result)) {
      continue;
    }
    result = await runtime.configure(option);
    if (
      !directConfigWasApplied(option.configId, option.value, result) &&
      !isUnavailableReasoningConfigOption(option.configId, option.value, result)
    ) {
      throw new Error("Saved session config could not be applied after ACP restore.");
    }
  }
  if (!result) {
    throw new Error("Saved session config could not be applied after ACP restore.");
  }
  return result;
}

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
  sessionRuntimeStore: {
    get(sessionId: string): StoredSessionRuntimeDescriptor | null | undefined;
  };
  providerLifecycle: ProviderLifecyclePort;
  getAgents(): AcpAgentProvider[];
  getProjects(): Array<{ id: string; path?: string }>;
  resolveStoredSessionWorktree(summary: SessionSummary): WorktreeSummary | undefined;
  buildResumeInfo(summary: SessionSummary, agent: AcpAgentProvider | undefined): SessionResumeInfo;
  hydrateSessionSummary(summary: SessionSummary): SessionSummary;
  persistRuntimeDescriptor(
    summary: SessionSummary,
    agent: AcpAgentProvider | undefined,
    capabilities?: StoredSessionRuntimeDescriptor["capabilities"],
    pendingConfig?: StoredSessionRuntimeDescriptor["pendingConfig"] | null,
  ): void;
  handleRuntimeEvent(sessionId: string, event: SessionRuntimeEvent): void;
  logConnectionLifecycle(
    event: Parameters<ProviderLifecyclePort["createRuntime"]>[0] extends {
      onConnectionLifecycleEvent?: infer Handler;
    }
      ? Handler extends (event: infer Event) => void
        ? Event
        : never
      : never,
  ): void;
  logger?: Pick<TillerLogger, "debug" | "error">;
  logInfo(message: string): void;
  logError(message: string): void;
  notify?: (notification: NotificationRaisedParams) => void;
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
      notifyResumeFailure(options, sessionId, "Session not found.", "SESSION_RESUME_UNAVAILABLE");
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

    const runtimeDescriptor = options.sessionRuntimeStore.get(sessionId);
    const agent = activeRecord?.agent ?? resolveProviderById(summary.agentId, options.getAgents());
    const worktree = activeRecord?.worktree ?? options.resolveStoredSessionWorktree(summary);
    const resume =
      activeRecord && resumeOptions.forceReloadActive
        ? buildSessionResumeInfo(summary, agent, undefined, {
            ...(runtimeDescriptor ?? {}),
            sessionId,
            providerId: summary.agentId,
            runtimeSessionId: activeRecord.runtime.runtimeSessionId,
            capabilities: activeRecord.runtime.sessionCapabilities,
            lastSeenAt: summary.updatedAt,
            state: "resumeable",
          })
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
      notifyResumeFailure(options, sessionId, unavailableReason, "SESSION_RESUME_UNAVAILABLE");
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

    let runtime: HelmRuntimeHandle | undefined;
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
      runtime = await options.providerLifecycle.createRuntime({
        sessionId,
        worktree: restoreWorktree,
        agent: restoreAgent,
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
      const pendingConfigResult = runtimeDescriptor?.pendingConfig
        ? await applyPendingRuntimeConfig(runtime, runtimeDescriptor.pendingConfig)
        : undefined;
      const restoredRuntimeModel =
        pendingConfigResult?.state.model ??
        pendingConfigResult?.modelState?.currentModelId ??
        runtime.sessionConfigState?.model ??
        runtime.sessionModelState?.currentModelId;
      const restoredModel = restoredRuntimeModel ?? summary.model;
      const resolvedRestoredConfigOptions = resolveConfigOptionsForSelection({
        incomingOptions: pendingConfigResult?.options ?? runtime.sessionConfigOptions,
        previousOptions: summary.configOptions,
        selectedModel: restoredModel,
      });
      const restoredConfigOptions = resolvedRestoredConfigOptions.options;
      const restoredSummary = options.hydrateSessionSummary({
        ...summary,
        model: restoredModel,
        modelOptions:
          pendingConfigResult?.modelState?.options ??
          runtime.sessionModelState?.options ??
          summary.modelOptions,
        configOptions: restoredConfigOptions,
        reasoningEffort: resolveConfigReasoningEffortForOptions(
          pendingConfigResult?.state.reasoningEffort ??
            runtime.sessionConfigState?.reasoningEffort ??
            summary.reasoningEffort,
          resolvedRestoredConfigOptions,
        ),
        runtimeSessionId: runtime.runtimeSessionId,
        status: "idle",
        updatedAt: new Date().toISOString(),
      });
      options.sessions.set(sessionId, {
        summary: restoredSummary,
        agent: restoreAgent,
        worktree: restoreWorktree,
        runtime,
      });
      options.sessionStore.upsert(restoredSummary);
      options.persistRuntimeDescriptor(
        restoredSummary,
        restoreAgent,
        runtime.sessionCapabilities,
        runtimeDescriptor?.pendingConfig ? null : undefined,
      );
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
      await runtime?.close().catch(() => undefined);
      const errorMessage = error instanceof Error ? error.message : "ACP restore failed.";
      logResumeError(options, "runtime.session_restore.failed", {
        sessionId,
        runtimeSessionId: restoreRuntimeSessionId,
        method: restoreMethod,
        providerId: restoreAgent.id,
        errorMessage,
      });
      notifyResumeFailure(options, sessionId, errorMessage, "ACP_SESSION_RESTORE_FAILED");
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

function notifyResumeFailure(
  options: SessionResumeServiceOptions,
  sessionId: string,
  message: string,
  code: string,
) {
  options.notify?.({
    kind: "error",
    source: "runtime",
    code,
    sessionId,
    message,
  });
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
