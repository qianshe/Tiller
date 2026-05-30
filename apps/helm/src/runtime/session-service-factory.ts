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
  createHelmSessionStores,
  type StoredSessionRuntimeDescriptor,
} from "../sessions/facade";
import { createSessionEventPublisher } from "./session-event-publisher";
import { createProviderLifecycle, type HelmRuntimeHandle } from "./provider-lifecycle";
import { handleRuntimeEvent as dispatchRuntimeEvent } from "./events";
import { markSessionResumeUnavailable, } from "./resume-info";
import {
  resolveProviderHistorySnapshot,
  type ProviderHistorySnapshot,
  type ProviderHistorySnapshotContent,
} from "./provider-history-source";
import { createRestoreReplayBuffer } from "./replay-event-buffer";
import { createProviderHistoryService } from "./provider-history-service";
import { createSessionPersistenceService } from "./session-persistence-service";
import { createRuntimeDraftRegistry } from "./draft-registry";
import { createSessionResumeService } from "./session-resume-service";
import { createSessionDiffHydrationService } from "./session-diff-hydration";
import { createSessionSummaryHydrationService } from "./session-summary-hydration";
import { createRuntimeDescriptorService } from "./descriptor-service";
import {
  chooseRecoverySummary,
  preservePreviousUserPromptsAfterReimport,
  readReimportedHistoryPage,
  recoverUserPromptFromSessionSummary,
} from "./session-history-reimport-helpers";
import { resolveStoredSessionWorktree as resolveStoredSessionWorktreeFromSummary } from "./session-worktree-resolution";

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
  sessionTimelineStore: HelmSessionStores["sessionTimelineStore"];
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
    sessionTimelineStore: options.sessionTimelineStore,
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
  const diffHydration = createSessionDiffHydrationService({
    sessions: options.sessions,
    sessionStore: options.sessionStore,
    sessionArtifactStore: options.sessionArtifactStore,
    getProjects: options.getProjects,
    getWorktrees: options.getWorktrees,
    createHandlerContext: options.createHandlerContext,
  });
  const sessionSummaryHydration = createSessionSummaryHydrationService({
    sessions: options.sessions,
    getProjects: options.getProjects,
    getWorktrees: options.getWorktrees,
    getAgents: options.getAgents,
    sessionRuntimeStore: options.sessionRuntimeStore,
  });
  const runtimeDescriptorService = createRuntimeDescriptorService({
    sessionRuntimeStore: options.sessionRuntimeStore,
    getAgents: options.getAgents,
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
    return sessionSummaryHydration.hydrateSessionSummary(summary);
  }

  function migrateStoredSessionSummary(summary: SessionSummary) {
    const hydrated = sessionSummaryHydration.migrateStoredSessionSummary(summary);
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
    return sessionSummaryHydration.buildResumeInfo(summary, agent);
  }

  function persistRuntimeDescriptor(
    summary: SessionSummary,
    agent: AcpAgentProvider | undefined,
    capabilities?: StoredSessionRuntimeDescriptor["capabilities"],
  ) {
    runtimeDescriptorService.persistRuntimeDescriptor(summary, agent, capabilities);
  }

  async function publishDiffUpdate(sessionId: string, files: FileDiffSummary[]) {
    await diffHydration.publishDiffUpdate(sessionId, files);
  }

  async function hydrateDiffsFromWorktreeGit(sessionId: string, files: FileDiffSummary[]) {
    return diffHydration.hydrateDiffsFromWorktreeGit(sessionId, files);
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

