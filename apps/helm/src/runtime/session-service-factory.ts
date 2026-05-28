import {
  loadAdapterAuthoritativeHistory,
  type AcpConnectionLifecycleEvent,
  type SessionRuntimeEvent,
} from "@tiller/acp-runtime";
import { resolveProviderById } from "@tiller/agent-registry";
import type {
  AcpAgentProvider,
  AcpModelState,
  AgentToolCall,
  AvailableCommand,
  AgentPromptContent,
  FileDiffSummary,
  HelmSummary,
  PermissionRequest,
  SessionReasoningEffort,
  SessionResumeInfo,
  SessionHistoryReimportResult,
  SessionSummary,
  WorktreeSummary,
  SessionConfigOptionValue,
} from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import {
  alignSessionProjectBinding,
  alignSessionWorktreeBinding,
  createHelmSessionStores,
  normalizeDiffPath,
  readWorktreeGitDiffs,
  type StoredSessionRuntimeDescriptor,
} from "../sessions/facade";
import { createSessionEventPublisher } from "./session-event-publisher";
import { createProviderLifecycle, type HelmRuntimeHandle } from "./provider-lifecycle";
import { summarizeLargeDiffs } from "./diff-limits";
import { handleRuntimeEvent as dispatchRuntimeEvent } from "./events";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "./session-config-options";
import {
  buildSessionResumeInfo,
  markSessionResumeUnavailable,
  resolveSessionRestoreCapabilities,
} from "./resume-info";
import {
  resolveProviderHistorySnapshot,
  type ProviderHistorySnapshot,
  type ProviderHistorySnapshotContent,
} from "./provider-history-source";
import { createRestoreReplayBuffer } from "./replay-event-buffer";
import { createProviderHistoryService } from "./provider-history-service";
import { createSessionPersistenceService } from "./session-persistence-service";
import { createRuntimeDraftRegistry } from "./runtime-draft-registry";
import { createSessionResumeService } from "./session-resume-service";
import {
  chooseRecoverySummary,
  preservePreviousUserPromptsAfterReimport,
  readReimportedHistoryPage,
  recoverUserPromptFromSessionSummary,
} from "./session-history-reimport-helpers";
import {
  normalizeWorktreePath,
  resolveStoredSessionWorktree as resolveStoredSessionWorktreeFromSummary,
} from "./session-worktree-resolution";

type HelmSessionStores = ReturnType<typeof createHelmSessionStores>;



export type SessionRecord = {
  summary: SessionSummary;
  agent: AcpAgentProvider;
  worktree: WorktreeSummary;
  runtime: HelmRuntimeHandle;
};

export type SessionServicesOptions = {
  sessions: Map<string, SessionRecord>;
  permissionIndex: Map<string, { sessionId: string; request: PermissionRequest }>;
  sessionStore: HelmSessionStores["sessionStore"];
  sessionMessageStore: HelmSessionStores["sessionMessageStore"];
  sessionArtifactStore: HelmSessionStores["sessionArtifactStore"];
  sessionRuntimeStore: HelmSessionStores["sessionRuntimeStore"];
  getAgents: () => AcpAgentProvider[];
  getProjects: () => ProjectSummary[];
  getWorktrees: () => WorktreeSummary[];
  createHandlerContext: () => HelmHandlerContext;
  broadcastNotification: (method: string, params: unknown) => void;
  logInfo: (message: string) => void;
  logError: (message: string) => void;
};

type ProjectSummary = import("@tiller/shared").ProjectSummary;


export function createSessionServiceGraph(options: SessionServicesOptions) {

  function resolveStoredSessionWorktree(summary: SessionSummary) {
    return resolveStoredSessionWorktreeFromSummary({
      summary,
      projects: options.getProjects(),
      worktrees: options.getWorktrees(),
    });
  }

  function logConnectionLifecycle(event: AcpConnectionLifecycleEvent) {
    const phaseMap: Record<AcpConnectionLifecycleEvent["type"], string> = {
      "connection-open": "ACP连接新建",
      "connection-reuse": "ACP连接复用",
      "connection-pending": "ACP连接等待",
      "connection-replace": "ACP连接替换",
      "connection-reconnect": "ACP连接重连",
    };
    options.logInfo(
      `[tiller] 阶段=${phaseMap[event.type]} provider=${event.providerId} key=${event.key} session=${event.sessionId ?? "<none>"} cwd=${event.cwd}`,
    );
  }

  const providerLifecycle = createProviderLifecycle();
  const sessionPersistence = createSessionPersistenceService({
    sessionStore: options.sessionStore,
    sessionMessageStore: options.sessionMessageStore,
    sessionArtifactStore: options.sessionArtifactStore,
    sessionRuntimeStore: options.sessionRuntimeStore,
  });
  const providerHistory = createProviderHistoryService({
    sessions: options.sessions,
    sessionStore: options.sessionStore,
    sessionMessageStore: options.sessionMessageStore,
    sessionArtifactStore: options.sessionArtifactStore,
    sessionRuntimeStore: options.sessionRuntimeStore,
    getAgents: options.getAgents,
    getWorktrees: options.getWorktrees,
    logInfo: options.logInfo,
    logError: options.logError,
  });
  function handleRuntimeEvent(sessionId: string, event: SessionRuntimeEvent) {
    dispatchRuntimeEvent(sessionId, event, options.createHandlerContext());
  }

  const runtimeDraftRegistry = createRuntimeDraftRegistry({
    providerLifecycle,
    handleRuntimeEvent,
    logConnectionLifecycle,
    logInfo: options.logInfo,
    logError: options.logError,
  });
  const sessionResume = createSessionResumeService({
    sessions: options.sessions,
    sessionStore: options.sessionStore,
    sessionMessageStore: options.sessionMessageStore,
    sessionArtifactStore: options.sessionArtifactStore,
    sessionRuntimeStore: options.sessionRuntimeStore,
    providerLifecycle,
    providerHistory,
    getAgents: options.getAgents,
    getProjects: options.getProjects,
    createHandlerContext: options.createHandlerContext,
    resolveStoredSessionWorktree,
    buildResumeInfo,
    hydrateSessionSummary,
    persistRuntimeDescriptor,
    handleRuntimeEvent,
    logConnectionLifecycle,
    logInfo: options.logInfo,
    logError: options.logError,
  });

  function clearPermissionRequestsForSession(sessionId: string) {
    for (const [requestId, permission] of options.permissionIndex.entries()) {
      if (permission.sessionId === sessionId) {
        options.permissionIndex.delete(requestId);
      }
    }
  }


  async function reimportSessionHistory(
    sessionId: string,
    reimportOptions: { limit?: number } = {},
  ): Promise<SessionHistoryReimportResult> {
    const activeRecord = options.sessions.get(sessionId);
    const storedSummary = options.sessionStore.list().find((item) => item.id === sessionId);
    const summary = activeRecord?.summary ?? storedSummary;
    if (!summary) {
      throw new Error("Session not found");
    }
    const recoverySummary = chooseRecoverySummary(summary, storedSummary);

    const previousMessages = options.sessionMessageStore.list(sessionId);
    const previousArtifacts = options.sessionArtifactStore.get(sessionId);
    const restorePreviousLocalHistory = () => {
      options.sessionMessageStore.replace(sessionId, previousMessages);
      options.sessionArtifactStore.remove(sessionId);
      for (const output of previousArtifacts.outputs) {
        options.sessionArtifactStore.appendOutput(sessionId, output);
      }
      options.sessionArtifactStore.replaceDiffs(sessionId, previousArtifacts.diffs);
      options.sessionArtifactStore.replaceToolCalls(sessionId, previousArtifacts.toolCalls);
    };

    options.sessionMessageStore.replace(sessionId, []);
    options.sessionArtifactStore.remove(sessionId);
    providerHistory.resetRefresh(sessionId);

    try {
      const resume = await sessionResume.startSessionResume(sessionId, { forceReloadActive: true });
      if (!resume.ok) {
        if (!activeRecord) {
          throw new Error(resume.message);
        }
        const imported = await providerHistory.importAuthoritativeProviderHistory(
          sessionId,
          activeRecord.agent,
          activeRecord.runtime.runtimeSessionId,
          activeRecord.worktree.path,
        );
        if (!imported) {
          throw new Error(resume.message);
        }
      }
      preservePreviousUserPromptsAfterReimport({
        sessionId,
        previousMessages,
        sessionMessageStore: options.sessionMessageStore,
      });
      recoverUserPromptFromSessionSummary({
        sessionId,
        summary: recoverySummary,
        sessionMessageStore: options.sessionMessageStore,
      });

      const messages = options.sessionMessageStore.list(sessionId);
      const artifacts = options.sessionArtifactStore.get(sessionId);
      if (
        !messages.length &&
        !artifacts.outputs.length &&
        !artifacts.toolCalls.length &&
        !artifacts.diffs.length
      ) {
        throw new Error("ACP did not return any history content for this session.");
      }

      return readReimportedHistoryPage({
        sessionId,
        limit: reimportOptions.limit,
        message: "历史已从 ACP 重新导入。",
        sessionMessageStore: options.sessionMessageStore,
        sessionArtifactStore: options.sessionArtifactStore,
      });
    } catch (error) {
      restorePreviousLocalHistory();
      recoverUserPromptFromSessionSummary({
        sessionId,
        summary: recoverySummary,
        sessionMessageStore: options.sessionMessageStore,
      });
      const restoredMessages = options.sessionMessageStore.list(sessionId);
      const restoredArtifacts = options.sessionArtifactStore.get(sessionId);
      if (
        restoredMessages.length ||
        restoredArtifacts.outputs.length ||
        restoredArtifacts.toolCalls.length ||
        restoredArtifacts.diffs.length
      ) {
        return readReimportedHistoryPage({
          sessionId,
          limit: reimportOptions.limit,
          message: `ACP 历史重导入失败，已保留本地历史并恢复用户提示：${error instanceof Error ? error.message : "未知错误"}`,
          sessionMessageStore: options.sessionMessageStore,
          sessionArtifactStore: options.sessionArtifactStore,
        });
      }
      throw error;
    }
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
    const aligned = alignSessionWorktreeBinding(
      alignSessionProjectBinding(summary, options.getProjects()),
      options.getWorktrees(),
    );
    const record = options.sessions.get(summary.id);
    const agent = record?.agent ?? resolveProviderById(aligned.agentId, options.getAgents());
    const descriptor = options.sessionRuntimeStore.get(summary.id);
    const capabilities = resolveSessionRestoreCapabilities(
      agent,
      descriptor,
      record?.runtime.sessionCapabilities,
    );
    const hydratedModel = aligned.model ?? record?.runtime.sessionConfigState?.model;
    const resolvedHydratedConfigOptions = resolveConfigOptionsForSelection({
      incomingOptions: record?.runtime.sessionConfigOptions,
      previousOptions: aligned.configOptions,
      selectedModel: hydratedModel,
    });
    const hydratedConfigOptions = resolvedHydratedConfigOptions.options;
    const hydratedReasoningEffort = resolveConfigReasoningEffortForOptions(
      aligned.reasoningEffort ?? record?.runtime.sessionConfigState?.reasoningEffort,
      resolvedHydratedConfigOptions,
    );
    return {
      ...aligned,
      model: hydratedModel,
      reasoningEffort: hydratedReasoningEffort,
      configOptions: hydratedConfigOptions,
      imageInput: capabilities.imageInput,
      resume: buildResumeInfo(aligned, agent),
    };
  }

  function migrateStoredSessionSummary(summary: SessionSummary) {
    const hydrated = hydrateSessionSummary(summary);
    if (
      hydrated.projectId !== summary.projectId ||
      hydrated.projectName !== summary.projectName ||
      hydrated.helmId !== summary.helmId ||
      hydrated.cwd !== summary.cwd ||
      hydrated.worktreeName !== summary.worktreeName ||
      hydrated.cwd !== summary.cwd
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
    const diffs = summarizeLargeDiffs(await hydrateDiffsFromWorktreeGit(sessionId, files));
    options.sessionArtifactStore.replaceDiffs(sessionId, diffs);
    createSessionEventPublisher(options.createHandlerContext()).sessionUpdate(sessionId, {
      kind: "diff_update",
      files: diffs,
    });
  }

  async function hydrateDiffsFromWorktreeGit(sessionId: string, files: FileDiffSummary[]) {
    const worktree = resolveSessionWorktree(sessionId);
    if (!worktree) {
      return files;
    }

    const gitDiffs = await readWorktreeGitDiffs(worktree.path);
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

  function resolveSessionWorktree(sessionId: string) {
    const liveWorktree = options.sessions.get(sessionId)?.worktree;
    if (liveWorktree) {
      return liveWorktree;
    }

    const summary = options.sessionStore.list().find((item) => item.id === sessionId);
    return summary
      ? (options.getWorktrees().find((worktree) => normalizeWorktreePath(worktree.path) === normalizeWorktreePath(summary.cwd)) ?? null)
      : null;
  }

  return {
    buildResumeInfo,
    clearPermissionRequestsForSession,
    deleteLocalSessionData: sessionPersistence.deleteLocalSessionData,
    handleRuntimeEvent,
    hydrateDiffsFromWorktreeGit,
    hydrateSessionSummary,
    migrateStoredSessionSummary,
    configureRuntimeDraft: runtimeDraftRegistry.configureRuntimeDraft,
    createRuntimeDraft: runtimeDraftRegistry.createRuntimeDraft,
    discardRuntimeDraft: runtimeDraftRegistry.discardRuntimeDraft,
    discardRuntimeDraftsForDeckClient: runtimeDraftRegistry.discardRuntimeDraftsForDeckClient,
    persistRuntimeDescriptor,
    persistSessionMessage: sessionPersistence.persistSessionMessage,
    publishDiffUpdate,
    reimportSessionHistory,
    refreshAuthoritativeSessionHistory: providerHistory.refreshAuthoritativeSessionHistory,
    scheduleDeckClientDraftDiscard: runtimeDraftRegistry.scheduleDeckClientDraftDiscard,
    startSessionResume: sessionResume.startSessionResume,
    takeRuntimeDraft: runtimeDraftRegistry.takeRuntimeDraft,
    updateSessionSummary,
  };
}

