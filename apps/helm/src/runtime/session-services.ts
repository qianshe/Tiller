import { createAcpRuntime, type SessionRuntimeEvent } from "@tiller/acp-runtime";
import { resolveProviderById } from "@tiller/agent-registry";
import type {
  AcpAgentProvider,
  AcpModelState,
  AgentMessage,
  AgentPromptContent,
  FileDiffSummary,
  PermissionRequest,
  SessionReasoningEffort,
  SessionResumeInfo,
  SessionSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import {
  alignSessionProjectBinding,
  createHelmSessionStores,
  loadProviderAuthoritativeHistory,
  normalizeDiffPath,
  readWorkspaceGitDiffs,
  type StoredSessionRuntimeDescriptor,
} from "../sessions/facade";
import {
  planProviderHistorySync,
  shouldRepairProviderHistorySnapshot,
  toParagraphMessages,
} from "../sessions/provider-history-sync.js";
import { broadcastSessionUpdate } from "../rpc/notifications";
import { handleRuntimeEvent as dispatchRuntimeEvent } from "./events";
import { buildSessionResumeInfo, resolveSessionRestoreCapabilities } from "./resume-info";
import { createWarmRuntimePool, type WarmRuntimeKey } from "./warm-runtime-pool";
import { createRestoreReplayBuffer } from "./replay-event-buffer";

type HelmSessionStores = ReturnType<typeof createHelmSessionStores>;

type SessionRuntimeConfig = {
  agentMode?: string;
  model?: string;
  reasoningEffort?: SessionReasoningEffort;
};

export type SessionRecord = {
  summary: SessionSummary;
  agent: AcpAgentProvider;
  workspace: WorkspaceSummary;
  runtime: Awaited<ReturnType<typeof createAcpRuntime>>;
};

type SessionServicesOptions = {
  sessions: Map<string, SessionRecord>;
  permissionIndex: Map<string, { sessionId: string; request: PermissionRequest }>;
  sessionStore: HelmSessionStores["sessionStore"];
  sessionMessageStore: HelmSessionStores["sessionMessageStore"];
  sessionArtifactStore: HelmSessionStores["sessionArtifactStore"];
  sessionRuntimeStore: HelmSessionStores["sessionRuntimeStore"];
  getAgents: () => AcpAgentProvider[];
  getProjects: () => ProjectSummary[];
  getWorkspaces: () => WorkspaceSummary[];
  createHandlerContext: () => HelmHandlerContext;
  broadcastNotification: (method: string, params: unknown) => void;
  logInfo: (message: string) => void;
  logError: (message: string) => void;
};

type ProjectSummary = import("@tiller/shared").ProjectSummary;

type WarmSessionRuntime = {
  runtime: SessionRecord["runtime"];
  attach: (sessionId: string) => void;
  cancel: () => void;
  expiresTimer: ReturnType<typeof setTimeout>;
};

const WARM_RUNTIME_TTL_MS = 5 * 60_000;

export function createSessionServices(options: SessionServicesOptions) {
  const openCodeHistoryRefreshes = new Map<string, number>();
  const warmRuntimes = createWarmRuntimePool<WarmSessionRuntime>();

  function handleRuntimeEvent(sessionId: string, event: SessionRuntimeEvent) {
    dispatchRuntimeEvent(sessionId, event, options.createHandlerContext());
  }

  function clearPermissionRequestsForSession(sessionId: string) {
    for (const [requestId, permission] of options.permissionIndex.entries()) {
      if (permission.sessionId === sessionId) {
        options.permissionIndex.delete(requestId);
      }
    }
  }

  function deleteLocalSessionData(sessionId: string) {
    options.sessionStore.remove(sessionId);
    options.sessionMessageStore.remove(sessionId);
    options.sessionArtifactStore.remove(sessionId);
    options.sessionRuntimeStore.remove(sessionId);
  }

  function persistSessionMessage(sessionId: string, message: AgentMessage) {
    options.sessionMessageStore.append(sessionId, message);
  }

  function updateSessionSummary(
    sessionId: string,
    mutate: (summary: SessionSummary) => SessionSummary,
  ) {
    const activeSummary = options.sessions.get(sessionId)?.summary;
    const persistedSummary = options.sessionStore.list().find((item) => item.id === sessionId);
    const base = activeSummary ?? persistedSummary;
    if (!base) {
      return undefined;
    }

    const next = hydrateSessionSummary(mutate(base));
    const record = options.sessions.get(sessionId);
    if (record) {
      record.summary = next;
    }
    options.sessionStore.upsert(next);
    persistRuntimeDescriptor(
      next,
      record?.agent ?? resolveProviderById(next.agentId, options.getAgents()),
      record?.runtime.sessionCapabilities,
    );
    return next;
  }

  function hydrateSessionSummary(summary: SessionSummary): SessionSummary {
    const aligned = alignSessionProjectBinding(summary, options.getProjects());
    const record = options.sessions.get(summary.id);
    const agent = record?.agent ?? resolveProviderById(aligned.agentId, options.getAgents());
    const descriptor = options.sessionRuntimeStore.get(summary.id);
    const capabilities = resolveSessionRestoreCapabilities(
      agent,
      descriptor,
      record?.runtime.sessionCapabilities,
    );
    return {
      ...aligned,
      imageInput: capabilities.imageInput,
      resume: buildResumeInfo(aligned, agent),
    };
  }

  function migrateStoredSessionSummary(summary: SessionSummary) {
    const hydrated = hydrateSessionSummary(summary);
    if (
      hydrated.projectId !== summary.projectId ||
      hydrated.projectName !== summary.projectName ||
      hydrated.helmId !== summary.helmId
    ) {
      options.sessionStore.upsert(hydrated);
    }
    return hydrated;
  }

  function buildResumeInfo(
    summary: SessionSummary,
    agent: AcpAgentProvider | undefined,
  ): SessionResumeInfo {
    return buildSessionResumeInfo(
      summary,
      agent,
      options.sessions.get(summary.id),
      options.sessionRuntimeStore.get(summary.id),
    );
  }

  async function importAuthoritativeOpenCodeHistory(
    sessionId: string,
    agent: AcpAgentProvider,
    runtimeSessionId: string,
    cwd: string,
  ) {
    try {
      const history = await loadProviderAuthoritativeHistory(agent, runtimeSessionId, cwd);
      if (!history) {
        return false;
      }
      if (!history.messages.length) {
        if (history.toolCalls.length) {
          options.sessionArtifactStore.replaceToolCalls(sessionId, history.toolCalls);
        }
        options.logInfo(
          `[tiller] opencode.export.history session=${sessionId} runtime=${runtimeSessionId} action=skip_empty providerMessages=0 localMessages=0 toolCalls=${history.toolCalls.length}`,
        );
        return true;
      }

      const descriptor = options.sessionRuntimeStore.get(sessionId);
      const syncDecision = planProviderHistorySync({
        currentState: descriptor?.providerHistory,
        providerMessages: history.messages,
      });

      let localMessageCount = syncDecision.action === "skip" ? 0 : syncDecision.messages.length;
      let logAction: "append" | "repair" | "replace" | "skip" = syncDecision.action;
      if (syncDecision.action === "replace") {
        if (syncDecision.messages.length) {
          options.sessionMessageStore.replace(sessionId, syncDecision.messages);
        }
      } else if (syncDecision.action === "append") {
        for (const message of syncDecision.messages) {
          options.sessionMessageStore.append(sessionId, message);
        }
      } else {
        const localMessages = options.sessionMessageStore.list(sessionId);
        if (shouldRepairProviderHistorySnapshot(localMessages, history.messages)) {
          const repairedMessages = toParagraphMessages(history.messages);
          options.sessionMessageStore.replace(sessionId, repairedMessages);
          localMessageCount = repairedMessages.length;
          logAction = "repair";
        }
      }

      persistProviderHistoryState(sessionId, agent, runtimeSessionId, syncDecision.nextState);
      if (history.toolCalls.length) {
        options.sessionArtifactStore.replaceToolCalls(sessionId, history.toolCalls);
      }
      options.logInfo(
        `[tiller] opencode.export.history session=${sessionId} runtime=${runtimeSessionId} action=${logAction} providerMessages=${history.messages.length} localMessages=${localMessageCount} toolCalls=${history.toolCalls.length}`,
      );
      return true;
    } catch (error) {
      options.logError(
        `[tiller] opencode.export.history failed session=${sessionId}: ${error instanceof Error ? error.message : "OpenCode export failed."}`,
      );
      return false;
    }
  }

  function persistProviderHistoryState(
    sessionId: string,
    agent: AcpAgentProvider,
    runtimeSessionId: string,
    providerHistory: StoredSessionRuntimeDescriptor["providerHistory"],
  ) {
    if (!providerHistory) {
      return;
    }

    const descriptor = options.sessionRuntimeStore.get(sessionId);
    if (descriptor) {
      options.sessionRuntimeStore.upsert({
        ...descriptor,
        providerHistory,
        lastSeenAt: providerHistory.syncedAt,
      });
      return;
    }

    const summary =
      options.sessions.get(sessionId)?.summary ??
      options.sessionStore.list().find((item) => item.id === sessionId);
    if (!summary) {
      return;
    }

    options.sessionRuntimeStore.upsert({
      sessionId,
      projectId: summary.projectId,
      helmId: summary.helmId,
      providerId: summary.agentId,
      runtimeSessionId,
      capabilities: resolveSessionRestoreCapabilities(agent, null),
      providerHistory,
      lastSeenAt: providerHistory.syncedAt,
      state: summary.status === "error" || summary.status === "cancelled" ? "stale" : "resumeable",
    });
  }

  async function refreshAuthoritativeSessionHistory(sessionId: string) {
    const lastRefresh = openCodeHistoryRefreshes.get(sessionId);
    if (lastRefresh && Date.now() - lastRefresh < 30_000) {
      return;
    }

    const activeRecord = options.sessions.get(sessionId);
    const summary =
      activeRecord?.summary ?? options.sessionStore.list().find((item) => item.id === sessionId);
    if (!summary) {
      return;
    }
    const agent = activeRecord?.agent ?? resolveProviderById(summary.agentId, options.getAgents());
    const workspace =
      activeRecord?.workspace ?? options.getWorkspaces().find((item) => item.id === summary.workspaceId);
    const runtimeSessionId =
      activeRecord?.runtime.runtimeSessionId ??
      summary.runtimeSessionId ??
      options.sessionRuntimeStore.get(sessionId)?.runtimeSessionId;
    if (!agent || !workspace || !runtimeSessionId) {
      return;
    }

    const refreshed = await importAuthoritativeOpenCodeHistory(
      sessionId,
      agent,
      runtimeSessionId,
      workspace.path,
    );
    if (refreshed) {
      openCodeHistoryRefreshes.set(sessionId, Date.now());
    }
  }

  function resolveWarmRuntimeKey(
    workspace: WorkspaceSummary,
    agent: AcpAgentProvider,
    sessionConfig?: SessionRuntimeConfig,
  ): WarmRuntimeKey {
    return {
      workspaceId: workspace.id,
      agentId: agent.id,
      configKey: JSON.stringify({
        agentMode: sessionConfig?.agentMode ?? "",
        model: sessionConfig?.model ?? "",
        reasoningEffort: sessionConfig?.reasoningEffort ?? "",
      }),
    };
  }

  async function prewarmRuntime(params: {
    workspace: WorkspaceSummary;
    agent: AcpAgentProvider;
    sessionConfig?: SessionRuntimeConfig;
  }) {
    const key = resolveWarmRuntimeKey(params.workspace, params.agent, params.sessionConfig);
    const existing = warmRuntimes.get(key);
    if (existing) {
      return {
        ok: true,
        warmed: false,
        providerId: params.agent.id,
        workspaceId: params.workspace.id,
        runtimeSessionId: existing.runtime.runtimeSessionId,
        message: "ACP runtime is already prewarmed.",
      };
    }

    const warmSessionId = `warm-${params.agent.id}-${Date.now()}`;
    let attachedSessionId: string | null = null;
    options.logInfo(
      `[tiller] 阶段=预热ACP开始 warm=${warmSessionId} provider=${params.agent.id} workspace=${params.workspace.id}`,
    );

    const runtime = await createAcpRuntime({
      sessionId: warmSessionId,
      workspace: params.workspace,
      agent: params.agent,
      sessionConfig: params.sessionConfig,
      onEvent: (event) => {
        if (attachedSessionId) {
          handleRuntimeEvent(attachedSessionId, event);
          return;
        }
        if (event.type === "error") {
          options.logError(
            `[tiller] 阶段=预热ACP错误 warm=${warmSessionId} provider=${params.agent.id} code=${event.code ?? "UNKNOWN"} message=${event.message}`,
          );
        }
      },
    });

    const expiresTimer = setTimeout(() => {
      const expired = warmRuntimes.take(key);
      if (!expired) {
        return;
      }
      expired.cancel();
      options.logInfo(
        `[tiller] 阶段=预热ACP过期 runtime=${runtime.runtimeSessionId} provider=${params.agent.id} workspace=${params.workspace.id}`,
      );
    }, WARM_RUNTIME_TTL_MS);
    expiresTimer.unref?.();

    warmRuntimes.set(key, {
      runtime,
      attach: (sessionId) => {
        attachedSessionId = sessionId;
      },
      cancel: () => runtime.cancel(),
      expiresTimer,
    });
    options.logInfo(
      `[tiller] 阶段=预热ACP完成 warm=${warmSessionId} runtime=${runtime.runtimeSessionId} provider=${params.agent.id} workspace=${params.workspace.id}`,
    );
    return {
      ok: true,
      warmed: true,
      providerId: params.agent.id,
      workspaceId: params.workspace.id,
      runtimeSessionId: runtime.runtimeSessionId,
      message: "ACP runtime prewarmed.",
    };
  }

  function takePrewarmedRuntime(params: {
    workspace: WorkspaceSummary;
    agent: AcpAgentProvider;
    sessionConfig?: SessionRuntimeConfig;
  }) {
    const warm = warmRuntimes.take(
      resolveWarmRuntimeKey(params.workspace, params.agent, params.sessionConfig),
    );
    if (warm) {
      clearTimeout(warm.expiresTimer);
      options.logInfo(
        `[tiller] 阶段=预热ACP复用 provider=${params.agent.id} workspace=${params.workspace.id} runtime=${warm.runtime.runtimeSessionId}`,
      );
    }
    return warm;
  }

  async function startSessionResume(sessionId: string) {
    const activeRecord = options.sessions.get(sessionId);
    if (activeRecord) {
      await refreshAuthoritativeSessionHistory(sessionId);
      const resume = buildResumeInfo(activeRecord.summary, activeRecord.agent);
      options.logInfo(
        `[tiller] client reconnect session=${sessionId} runtime=${resume.runtimeSessionId ?? "unknown"}`,
      );
      return {
        ok: true,
        resume,
        message: "Client reconnected to the still-running Helm session; no ACP restore was needed.",
      };
    }

    const summary = options.sessionStore.list().find((item) => item.id === sessionId);
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

    const agent = resolveProviderById(summary.agentId, options.getAgents());
    const workspace = options.getWorkspaces().find((item) => item.id === summary.workspaceId);
    const resume = buildResumeInfo(summary, agent);
    if (
      !agent ||
      !workspace ||
      !resume.runtimeSessionId ||
      (resume.restoreMethod !== "session/load" && resume.restoreMethod !== "session/resume")
    ) {
      return {
        ok: false,
        resume,
        message: resume.reason,
      };
    }

    try {
      options.logInfo(
        `[tiller] 阶段=恢复旧会话开始 session=${sessionId} runtime=${resume.runtimeSessionId} method=${resume.restoreMethod}`,
      );
      // ACP transcript is provider-owned. Helm stores metadata and a disposable view cache.
      // Restore replay is cache repair only; live events still use handleRuntimeEvent.
      const restoreReplayBuffer = createRestoreReplayBuffer(
        sessionId,
        options.createHandlerContext(),
      );
      options.logInfo(
        `[tiller] 阶段=恢复重放缓存打开 session=${sessionId}`,
      );
      const runtime = await createAcpRuntime({
        sessionId,
        workspace,
        agent,
        sessionConfig: {
          model: summary.model,
          reasoningEffort: summary.reasoningEffort,
        },
        restore: {
          runtimeSessionId: resume.runtimeSessionId,
          strategy: resume.restoreMethod === "session/load" ? "load" : "resume",
          replayBaselineMessages: options.sessionMessageStore.list(sessionId),
        },
        onEvent: (event) => handleRuntimeEvent(sessionId, event),
        onRestoreReplayEvent: (event) => {
          restoreReplayBuffer.add(event);
        },
      });
      const replayCounts = restoreReplayBuffer.flush();
      options.logInfo(
        `[tiller] 阶段=恢复重放缓存完成 session=${sessionId} messages=${replayCounts.messages} toolCalls=${replayCounts.toolCalls} outputs=${replayCounts.outputs} diffs=${replayCounts.diffs}`,
      );
      const restoredSummary = hydrateSessionSummary({
        ...summary,
        model: runtime.sessionConfigState?.model ?? summary.model,
        modelOptions: runtime.sessionModelState?.options ?? summary.modelOptions,
        reasoningEffort: runtime.sessionConfigState?.reasoningEffort ?? summary.reasoningEffort,
        runtimeSessionId: runtime.runtimeSessionId,
        status: "idle",
        updatedAt: new Date().toISOString(),
      });
      options.sessions.set(sessionId, { summary: restoredSummary, agent, workspace, runtime });
      options.sessionStore.upsert(restoredSummary);
      persistRuntimeDescriptor(restoredSummary, agent, runtime.sessionCapabilities);
      await importAuthoritativeOpenCodeHistory(
        sessionId,
        agent,
        runtime.runtimeSessionId,
        workspace.path,
      );
      options.logInfo(
        `[tiller] 阶段=恢复旧会话完成 session=${sessionId} runtime=${runtime.runtimeSessionId} method=${resume.restoreMethod}`,
      );
      return {
        ok: true,
        resume: buildResumeInfo(restoredSummary, agent),
        message: `ACP ${resume.restoreMethod} completed for this session.`,
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

  function persistRuntimeDescriptor(
    summary: SessionSummary,
    agent: AcpAgentProvider | undefined,
    capabilities?: StoredSessionRuntimeDescriptor["capabilities"],
  ) {
    const existingDescriptor = options.sessionRuntimeStore.get(summary.id);
    const resolvedCapabilities = resolveSessionRestoreCapabilities(
      agent,
      existingDescriptor,
      capabilities,
    );
    if (
      !summary.runtimeSessionId &&
      !resolvedCapabilities.sessionLoad &&
      !resolvedCapabilities.sessionResume &&
      !resolvedCapabilities.sessionList &&
      !resolvedCapabilities.sessionClose &&
      !resolvedCapabilities.sessionDelete &&
      !resolvedCapabilities.imageInput
    ) {
      return;
    }

    options.sessionRuntimeStore.upsert({
      sessionId: summary.id,
      projectId: summary.projectId,
      helmId: summary.helmId,
      providerId: summary.agentId,
      runtimeSessionId: summary.runtimeSessionId,
      capabilities: resolvedCapabilities,
      providerHistory: existingDescriptor?.providerHistory,
      lastSeenAt: summary.updatedAt,
      state: summary.status === "error" || summary.status === "cancelled" ? "stale" : "resumeable",
    });
  }

  async function publishDiffUpdate(sessionId: string, files: FileDiffSummary[]) {
    const diffs = await hydrateDiffsFromWorkspaceGit(sessionId, files);
    options.sessionArtifactStore.replaceDiffs(sessionId, diffs);
    broadcastSessionUpdate(options.createHandlerContext(), sessionId, {
      kind: "diff_update",
      files: diffs,
    });
  }

  async function hydrateDiffsFromWorkspaceGit(sessionId: string, files: FileDiffSummary[]) {
    const workspace = resolveSessionWorkspace(sessionId);
    if (!workspace) {
      return files;
    }

    const gitDiffs = await readWorkspaceGitDiffs(workspace.path);
    if (!gitDiffs.length) {
      return files;
    }

    if (!files.length) {
      return gitDiffs;
    }

    const gitByPath = new Map(gitDiffs.map((file) => [normalizeDiffPath(file.path), file]));
    return files.map((file) => {
      const fromGit = gitByPath.get(normalizeDiffPath(file.path));
      return fromGit
        ? {
            ...file,
            additions: fromGit.additions,
            deletions: fromGit.deletions,
            patch: file.patch ?? fromGit.patch,
          }
        : file;
    });
  }

  function resolveSessionWorkspace(sessionId: string) {
    const liveWorkspace = options.sessions.get(sessionId)?.workspace;
    if (liveWorkspace) {
      return liveWorkspace;
    }

    const summary = options.sessionStore.list().find((item) => item.id === sessionId);
    return summary
      ? (options.getWorkspaces().find((workspace) => workspace.id === summary.workspaceId) ?? null)
      : null;
  }

  return {
    buildResumeInfo,
    clearPermissionRequestsForSession,
    deleteLocalSessionData,
    handleRuntimeEvent,
    hydrateDiffsFromWorkspaceGit,
    hydrateSessionSummary,
    migrateStoredSessionSummary,
    persistRuntimeDescriptor,
    persistSessionMessage,
    prewarmRuntime,
    publishDiffUpdate,
    refreshAuthoritativeSessionHistory,
    startSessionResume,
    takePrewarmedRuntime,
    updateSessionSummary,
  };
}
