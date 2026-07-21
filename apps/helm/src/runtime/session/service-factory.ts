import type {
  AcpConnectionLifecycleEvent,
  SessionRuntimeEvent,
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
  SessionSummary,
  WorktreeSummary,
  SessionConfigOptionValue,
} from "@tiller/shared";
import type { HelmHandlerContext } from "../../handlers/context";
import {
  createHelmSessionStores,
  type StoredSessionRuntimeDescriptor,
} from "../../sessions/facade";
import { createSessionEventPublisher } from "./event/publisher";
import { createProviderLifecycle, type HelmRuntimeHandle } from "../provider-lifecycle";
import {
  cleanupRuntimeEventState,
  ensureLiveEventSequenceForSession,
  handleRuntimeEvent as dispatchRuntimeEvent,
} from "../events";
import { markSessionResumeUnavailable, } from "../resume-info";
import { createSessionPersistenceService } from "./persistence-service";
import { createRuntimeDraftRegistry } from "../draft-registry";
import { createSessionResumeService } from "./resume-service";
import { createSessionDiffHydrationService } from "./diff-hydration";
import { createSessionSummaryHydrationService } from "./summary-hydration";
import { createRuntimeDescriptorService } from "../descriptor-service";
import { createSessionTimelineDispatcher } from "../session-timeline/dispatcher";
import { createSessionTimelineFlushScheduler } from "../session-timeline/flush-scheduler";
import { createSessionLiveStateStore } from "../session-timeline/live-state-store";
import { createSessionApprovalStateStore } from "./event/approval-store";
import { createSessionRuntimeEventState } from "./event/runtime-state";
import { broadcastNotificationRaised } from "../../rpc/notifications";
import { expirePersistedApprovalsOnStartup } from "./event/approval-recovery";
import { createSessionTimelineWorkerRegistry } from "../session-timeline/worker-registry";
import { resolveStoredSessionWorktree as resolveStoredSessionWorktreeFromSummary } from "./worktree-resolution";
import type { TillerLogger } from "../../logging/logger";
import type { AcpProtocolLoggingOptions } from "@tiller/acp-runtime";

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
  sessionAttachmentStore: HelmSessionStores["sessionAttachmentStore"];
  sessionDiffBodyStore: HelmSessionStores["sessionDiffBodyStore"];
  sessionOutputBodyStore: HelmSessionStores["sessionOutputBodyStore"];
  sessionRuntimeStore: HelmSessionStores["sessionRuntimeStore"];
  sessionPlanStore: HelmSessionStores["sessionPlanStore"];
  sessionTimelineStore: HelmSessionStores["sessionTimelineStore"];
  sessionUpdateStore: HelmSessionStores["sessionUpdateStore"];
  sessionStateStore: HelmSessionStores["sessionStateStore"];
  sessionApprovalStore: HelmSessionStores["sessionApprovalStore"];
  getAgents: () => AcpAgentProvider[];
  getProjects: () => ProjectSummary[];
  getWorktrees: () => WorktreeSummary[];
  createHandlerContext: () => HelmHandlerContext;
  broadcastNotification: (method: string, params: unknown) => void;
  logInfo: (message: string) => void;
  logError: (message: string) => void;
  logger?: TillerLogger;
  protocolLogging?: AcpProtocolLoggingOptions;
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
    if (options.logger) {
      options.logger.debug("acp.connection.lifecycle", {
        type: event.type,
        providerId: event.providerId,
        key: event.key,
        sessionId: event.sessionId ?? "<none>",
        cwd: event.cwd,
      });
      return;
    }
    options.logInfo(`[tiller] acp.connection.lifecycle type=${event.type} provider=${event.providerId} key=${event.key} session=${event.sessionId ?? "<none>"} cwd=${event.cwd}`);
  }

  const providerLifecycle = createProviderLifecycle();
  const sessionPersistence = createSessionPersistenceService({
    sessionStore: options.sessionStore,
    sessionMessageStore: options.sessionMessageStore,
    sessionArtifactStore: options.sessionArtifactStore,
    sessionDiffBodyStore: options.sessionDiffBodyStore,
    sessionOutputBodyStore: options.sessionOutputBodyStore,
    sessionAttachmentStore: options.sessionAttachmentStore,
    sessionRuntimeStore: options.sessionRuntimeStore,
    sessionPlanStore: options.sessionPlanStore,
    sessionTimelineStore: options.sessionTimelineStore,
    sessionUpdateStore: options.sessionUpdateStore,
  });
  const diffHydration = createSessionDiffHydrationService({
    sessions: options.sessions,
    sessionStore: options.sessionStore,
    sessionArtifactStore: options.sessionArtifactStore,
    sessionDiffBodyStore: options.sessionDiffBodyStore,
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
  const sessionTimelineWorkers = createSessionTimelineWorkerRegistry();
  const sessionRuntimeEventState = createSessionRuntimeEventState();
  const sessionLiveStateStore = createSessionLiveStateStore(options.sessionStateStore);
  const sessionApprovalStateStore = createSessionApprovalStateStore(
    options.sessionApprovalStore,
  );
  try {
    const expiredApprovalIds = expirePersistedApprovalsOnStartup({
      sessions: options.sessionStore.list(),
      approvals: sessionApprovalStateStore,
      liveStates: sessionLiveStateStore,
    });
    if (expiredApprovalIds.length > 0) {
      options.logInfo(
        `[tiller] approval.recovery.expired count=${expiredApprovalIds.length}`,
      );
    }
  } catch (error) {
    options.logError(
      `[tiller] approval.recovery.failed message=${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const sessionTimelineDispatcher = createSessionTimelineDispatcher({
    store: options.sessionTimelineStore,
    publish: (sessionId, batch) => {
      createSessionEventPublisher(options.createHandlerContext()).sessionUpdate(sessionId, {
        kind: "timeline_batch",
        batch,
      });
    },
  });
  const sessionTimelineFlushScheduler = createSessionTimelineFlushScheduler({
    workers: sessionTimelineWorkers,
    dispatcher: sessionTimelineDispatcher,
  });
  const sessionTimelineIdleEvictionTimer = setInterval(() => {
    sessionTimelineWorkers.evictIdle();
  }, 60_000);
  sessionTimelineIdleEvictionTimer.unref?.();
  function resetSessionTimelineRuntimeState(sessionId: string) {
    const context = options.createHandlerContext();
    context.promptQueue.remove(sessionId);
    context.liveMessageBuffer.remove(sessionId);
    context.runtimeMetrics?.removeSession(sessionId);
    cleanupRuntimeEventState(sessionId, context);
    diffHydration.remove(sessionId);
    sessionTimelineFlushScheduler.remove(sessionId);
    sessionTimelineWorkers.remove(sessionId);
    sessionLiveStateStore.remove(sessionId);
    sessionApprovalStateStore.remove(sessionId);
  }
  function handleRuntimeEvent(sessionId: string, event: SessionRuntimeEvent) {
    dispatchRuntimeEvent(sessionId, event, options.createHandlerContext());
  }

  const runtimeDraftRegistry = createRuntimeDraftRegistry({
    providerLifecycle,
    handleRuntimeEvent,
    logConnectionLifecycle,
    logInfo: options.logInfo,
    logError: options.logError,
    logger: options.logger,
    protocolLogging: options.protocolLogging,
  });
  const sessionResume = createSessionResumeService({
    sessions: options.sessions,
    sessionStore: options.sessionStore,
    sessionRuntimeStore: options.sessionRuntimeStore,
    providerLifecycle,
    getAgents: options.getAgents,
    getProjects: options.getProjects,
    resolveStoredSessionWorktree,
    buildResumeInfo,
    hydrateSessionSummary,
    persistRuntimeDescriptor,
    handleRuntimeEvent,
    logConnectionLifecycle,
    logger: options.logger,
    logInfo: options.logInfo,
    logError: options.logError,
    notify: (notification) => broadcastNotificationRaised(
      { broadcastNotification: options.broadcastNotification },
      notification,
    ),
    protocolLogging: options.protocolLogging,
  });

  function clearPermissionRequestsForSession(sessionId: string) {
    for (const [requestId, permission] of options.permissionIndex.entries()) {
      if (permission.sessionId === sessionId) {
        options.permissionIndex.delete(requestId);
      }
    }
  }


  function updateSessionSummary(
    sessionId: string,
    mutate: (summary: SessionSummary) => SessionSummary,
  ) {
    const activeSummary = options.sessions.get(sessionId)?.summary;
    const persistedSummary = options.sessionStore.get(sessionId);
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

  function deleteLocalSessionData(sessionId: string) {
    resetSessionTimelineRuntimeState(sessionId);
    sessionPersistence.deleteLocalSessionData(sessionId);
  }

  async function startSessionResume(
    sessionId: string,
    resumeOptions: { forceReloadActive?: boolean } = {},
  ) {
    const result = await sessionResume.startSessionResume(sessionId, resumeOptions);
    if (result.ok) {
      ensureLiveEventSequenceForSession(sessionId, options.createHandlerContext());
    }
    return result;
  }

  return {
    buildResumeInfo,
    clearPermissionRequestsForSession,
    deleteLocalSessionData,
    handleRuntimeEvent,
    hydrateDiffsFromWorktreeGit,
    hydrateSessionSummary,
    configureRuntimeDraft: runtimeDraftRegistry.configureRuntimeDraft,
    createRuntimeDraft: runtimeDraftRegistry.createRuntimeDraft,
    discardRuntimeDraft: runtimeDraftRegistry.discardRuntimeDraft,
    discardRuntimeDraftsForDeckClient: runtimeDraftRegistry.discardRuntimeDraftsForDeckClient,
    persistRuntimeDescriptor,
    persistSessionMessage: sessionPersistence.persistSessionMessage,
    publishDiffUpdate,
    readSessionLiveState: sessionLiveStateStore.get,
    scheduleDeckClientDraftDiscard: runtimeDraftRegistry.scheduleDeckClientDraftDiscard,
    sessionLiveStateStore,
    sessionApprovalStateStore,
    sessionRuntimeEventState,
    sessionTimelineDispatcher,
    sessionTimelineFlushScheduler,
    sessionTimelineWorkers,
    dispose() {
      clearInterval(sessionTimelineIdleEvictionTimer);
      const context = options.createHandlerContext();
      const transientSessionIds = new Set([
        ...options.sessions.keys(),
        ...sessionRuntimeEventState.sessionIds(),
        ...context.promptQueue.sessionIds(),
        ...context.liveMessageBuffer.sessionIds(),
      ]);
      for (const sessionId of transientSessionIds) {
        options.sessionUpdateStore.compactTail(sessionId);
        context.promptQueue.remove(sessionId);
        context.liveMessageBuffer.remove(sessionId);
        context.runtimeMetrics?.removeSession(sessionId);
        cleanupRuntimeEventState(sessionId, context);
        sessionTimelineFlushScheduler.remove(sessionId);
        sessionTimelineWorkers.remove(sessionId);
      }
      sessionTimelineFlushScheduler.dispose();
      diffHydration.dispose();
    },
    startSessionResume,
    takeRuntimeDraft: runtimeDraftRegistry.takeRuntimeDraft,
    updateSessionSummary,
  };
}
