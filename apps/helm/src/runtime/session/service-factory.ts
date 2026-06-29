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
  SessionHistoryReimportResult,
  SessionSummary,
  WorktreeSummary,
  SessionConfigOptionValue,
} from "@tiller/shared";
import { buildSessionTimelineFromLegacy } from "@tiller/shared";
import type { HelmHandlerContext } from "../../handlers/context";
import {
  createHelmSessionStores,
  type StoredSessionRuntimeDescriptor,
} from "../../sessions/facade";
import { createSessionEventPublisher } from "./event/publisher";
import { createProviderLifecycle, type HelmRuntimeHandle } from "../provider-lifecycle";
import { handleRuntimeEvent as dispatchRuntimeEvent } from "../events";
import { markSessionResumeUnavailable, } from "../resume-info";
import { createProviderHistoryService } from "../provider-history/service";
import { createRestoreReplayBuffer } from "../replay/event-buffer";
import { createSessionPersistenceService } from "./persistence-service";
import { createRuntimeDraftRegistry } from "../draft-registry";
import { createSessionResumeService } from "./resume-service";
import { createSessionDiffHydrationService } from "./diff-hydration";
import { createSessionSummaryHydrationService } from "./summary-hydration";
import { createRuntimeDescriptorService } from "../descriptor-service";
import {
  clearRecoveredArtifactTimelineSequences,
  chooseRecoverySummary,
  findAcpReplayCoverageGap,
  preservePreviousUserPromptsAfterReimport,
  readReimportedHistoryPage,
  recoverUserPromptFromSessionSummary,
  sanitizeRecoveredHistorySequenceResets,
} from "../history-reimport/helpers";
import { resolveStoredSessionWorktree as resolveStoredSessionWorktreeFromSummary } from "./worktree-resolution";
import {
  readAdapterTranscriptPlanRepair,
  appendTranscriptRepairPlanUpdate,
} from "../history-reimport/plan-repair";
import {
  applyLocalMessageRepair,
  applyTranscriptMessageRepair,
  readAdapterTranscriptMessageRepair,
} from "../history-reimport/message-repair";
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
  sessionRuntimeStore: HelmSessionStores["sessionRuntimeStore"];
  sessionTimelineStore: HelmSessionStores["sessionTimelineStore"];
  sessionUpdateStore: HelmSessionStores["sessionUpdateStore"];
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
  function sanitizeRecoveredHistoryOrdering(sessionId: string) {
    const messages = options.sessionMessageStore.list(sessionId);
    const artifacts = options.sessionArtifactStore.get(sessionId);
    const currentTimeline = options.sessionTimelineStore.list(sessionId);
    const baseTimeline = currentTimeline.length
      ? currentTimeline
      : buildSessionTimelineFromLegacy({
        messages,
        outputs: artifacts.outputs,
        toolCalls: artifacts.toolCalls,
      });
    const sanitized = sanitizeRecoveredHistorySequenceResets(baseTimeline);
    if (!sanitized.clearedMessageIds.size && !sanitized.clearedToolCallIds.size) {
      return;
    }

    const sanitizedMessages = messages.map((message) =>
      sanitized.clearedMessageIds.has(message.id) && typeof message.sequence === "number"
        ? { ...message, sequence: undefined }
        : message
    );
    const sanitizedArtifacts = clearRecoveredArtifactTimelineSequences({
      outputs: artifacts.outputs,
      toolCalls: artifacts.toolCalls,
      clearedToolCallIds: sanitized.clearedToolCallIds,
    });

    options.sessionMessageStore.replace(sessionId, sanitizedMessages);
    options.sessionArtifactStore.replaceOutputs(sessionId, sanitizedArtifacts.outputs);
    options.sessionArtifactStore.replaceToolCalls(sessionId, sanitizedArtifacts.toolCalls);
    options.sessionTimelineStore.replace(sessionId, sanitized.entries);
  }

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
    sessionAttachmentStore: options.sessionAttachmentStore,
    sessionRuntimeStore: options.sessionRuntimeStore,
    sessionTimelineStore: options.sessionTimelineStore,
    sessionUpdateStore: options.sessionUpdateStore,
  });
  const providerHistory = createProviderHistoryService({
    sessions: options.sessions,
    sessionStore: options.sessionStore,
    sessionMessageStore: options.sessionMessageStore,
    sessionArtifactStore: options.sessionArtifactStore,
    sessionAttachmentStore: options.sessionAttachmentStore,
    sessionRuntimeStore: options.sessionRuntimeStore,
    sessionTimelineStore: options.sessionTimelineStore,
    sessionUpdateStore: options.sessionUpdateStore,
    getAgents: options.getAgents,
    getWorktrees: options.getWorktrees,
    logger: options.logger,
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
    logger: options.logger,
    protocolLogging: options.protocolLogging,
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
    logger: options.logger,
    logInfo: options.logInfo,
    logError: options.logError,
    protocolLogging: options.protocolLogging,
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
    const previousPlan = providerHistory.readSessionPlan(sessionId);
    const previousTimeline = options.sessionTimelineStore.list(sessionId);
    const restorePreviousLocalHistory = () => {
      options.sessionMessageStore.replace(sessionId, previousMessages);
      options.sessionArtifactStore.remove(sessionId);
      for (const output of previousArtifacts.outputs) {
        options.sessionArtifactStore.appendOutput(sessionId, output);
      }
      options.sessionArtifactStore.replaceDiffs(sessionId, previousArtifacts.diffs);
      options.sessionArtifactStore.replaceToolCalls(sessionId, previousArtifacts.toolCalls);
      if (previousTimeline.length) {
        options.sessionTimelineStore.replace(sessionId, previousTimeline);
      } else {
        options.sessionTimelineStore.remove(sessionId);
      }
      providerHistory.recordSessionPlan(sessionId, previousPlan);
    };

    options.sessionMessageStore.replace(sessionId, []);
    options.sessionArtifactStore.remove(sessionId);
    options.sessionTimelineStore.remove(sessionId);
    providerHistory.resetRefresh(sessionId);

    try {
      const resume = await sessionResume.startSessionResume(sessionId, { forceReloadActive: true });
      if (!resume.ok) {
        throw new Error(resume.message);
      }
      // A successful resume has already applied ACP replay. Do not overwrite it here.
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

      let messages = options.sessionMessageStore.list(sessionId);
      const artifacts = options.sessionArtifactStore.get(sessionId);
      let plan = providerHistory.readSessionPlan(sessionId);
      const repairAgent = activeRecord?.agent ?? resolveProviderById(recoverySummary.agentId, options.getAgents());
      if (!plan) {
        const repairedPlan = readAdapterTranscriptPlanRepair({
          summary: recoverySummary,
          agent: repairAgent,
          logger: options.logger,
        });
        if (repairedPlan) {
          providerHistory.recordSessionPlan(sessionId, repairedPlan);
          appendTranscriptRepairPlanUpdate({
            sessionId,
            summary: recoverySummary,
            agent: repairAgent,
            plan: repairedPlan,
            sessionUpdateStore: options.sessionUpdateStore,
          });
          plan = repairedPlan;
        }
      }
      const didRepairFromLocalMessages = applyLocalMessageRepair({
        sessionId,
        summary: recoverySummary,
        agent: repairAgent,
        previousMessages,
        sessionMessageStore: options.sessionMessageStore,
        sessionArtifactStore: options.sessionArtifactStore,
        sessionTimelineStore: options.sessionTimelineStore,
        sessionUpdateStore: options.sessionUpdateStore,
      });
      if (didRepairFromLocalMessages) {
        messages = options.sessionMessageStore.list(sessionId);
      } else {
        const repairedMessages = readAdapterTranscriptMessageRepair({
          summary: recoverySummary,
          agent: repairAgent,
          logger: options.logger,
        });
        if (repairedMessages.length) {
          const didRepairMessages = applyTranscriptMessageRepair({
            sessionId,
            summary: recoverySummary,
            agent: repairAgent,
            transcriptMessages: repairedMessages,
            sessionMessageStore: options.sessionMessageStore,
            sessionArtifactStore: options.sessionArtifactStore,
            sessionTimelineStore: options.sessionTimelineStore,
            sessionUpdateStore: options.sessionUpdateStore,
          });
          if (didRepairMessages) {
            messages = options.sessionMessageStore.list(sessionId);
          }
        }
      }
      const coverageGap = findAcpReplayCoverageGap({
        previousMessages,
        replayMessages: messages,
        previousTimeline,
        replayTimeline: options.sessionTimelineStore?.list(sessionId),
        previousPlan,
        replayPlan: plan,
      });
      if (coverageGap) {
        throw new Error(coverageGap);
      }
      if (
        !messages.length &&
        !artifacts.outputs.length &&
        !artifacts.toolCalls.length &&
        !artifacts.diffs.length &&
        !plan
      ) {
        throw new Error("ACP did not return any history content for this session.");
      }

      sanitizeRecoveredHistoryOrdering(sessionId);
      return readReimportedHistoryPage({
        sessionId,
        limit: reimportOptions.limit,
        message: "历史已从 ACP 重新导入。",
        plan,
        sessionMessageStore: options.sessionMessageStore,
        sessionArtifactStore: options.sessionArtifactStore,
        sessionTimelineStore: options.sessionTimelineStore,
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
          plan: providerHistory.readSessionPlan(sessionId),
          sessionMessageStore: options.sessionMessageStore,
          sessionArtifactStore: options.sessionArtifactStore,
          sessionTimelineStore: options.sessionTimelineStore,
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
    readSessionPlan: providerHistory.readSessionPlan,
    scheduleDeckClientDraftDiscard: runtimeDraftRegistry.scheduleDeckClientDraftDiscard,
    startSessionResume: sessionResume.startSessionResume,
    takeRuntimeDraft: runtimeDraftRegistry.takeRuntimeDraft,
    updateSessionSummary,
  };
}
