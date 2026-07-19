import { useMemo } from "react";
import { useDeckStore, type DeckNotification } from "../../store";
import type {
  AcpAgentProvider,
  AgentMessage,
  AgentPlan,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  PermissionRequest,
  ProjectSummary,
  SessionStatus,
  SessionSummary,
  SessionTimelineEntry,
  SessionPromptQueueSnapshot,
  WorktreeSummary,
} from "@tiller/shared";
type DeckApprovalItem = {
  request: PermissionRequest;
};

type DaemonProfilesState<TProfile> = {
  daemonProfiles: TProfile[];
};

const EMBEDDED_DAEMON_PROFILES: never[] = [];

export function selectDaemonProfilesForDeckData<TProfile>(
  state: DaemonProfilesState<TProfile>,
  embedded: boolean,
): TProfile[] {
  return embedded ? EMBEDDED_DAEMON_PROFILES : state.daemonProfiles;
}

/**
 * Centralizes Deck store selectors and visual fixture fallbacks for App.
 */
export function useDeckData(missionVisualFixture: any) {
  const storedHelms = useDeckStore((state) => state.helms);
  const helms = (missionVisualFixture?.helms ?? storedHelms) as any[];
  const setHelms = useDeckStore((state) => state.setHelms);
  const helmConnectionStates = useDeckStore((state) => state.helmConnectionStates);
  const helmInventories = useDeckStore((state) => state.helmInventories);
  const applyHelmInventory = useDeckStore((state) => state.applyHelmInventory);
  const setHelmConnection = useDeckStore((state) => state.setHelmConnection);
  const removeHelm = useDeckStore((state) => state.removeHelm);

  const storedWorktrees = useDeckStore((state) => state.worktrees);
  const worktrees = (missionVisualFixture?.worktrees ?? storedWorktrees) as WorktreeSummary[];
  const setWorktrees = useDeckStore((state) => state.setWorktrees);

  const storedProjects = useDeckStore((state) => state.projects);
  const projects = (missionVisualFixture?.projects ?? storedProjects) as ProjectSummary[];
  const setProjects = useDeckStore((state) => state.setProjects);

  const storedAgents = useDeckStore((state) => state.agents);
  const agents = (missionVisualFixture?.agents ?? storedAgents) as AcpAgentProvider[];
  const setAgents = useDeckStore((state) => state.setAgents);

  const storedSessions = useDeckStore((state) => state.sessions);
  const sessions = (missionVisualFixture?.sessions ?? storedSessions) as SessionSummary[];
  const setSessions = useDeckStore((state) => state.setSessions);
  const sessionHistoryState = useDeckStore((state) => state.sessionHistoryState);
  const setSessionHistoryState = useDeckStore((state) => state.setSessionHistoryState);

  const storedStatuses = useDeckStore((state) => state.statuses);
  const statuses = (missionVisualFixture?.statuses ?? storedStatuses) as Record<string, SessionStatus>;
  const setStatuses = useDeckStore((state) => state.setStatuses);

  const setMessages = useDeckStore((state) => state.setMessages);
  const storedMessages = useDeckStore((state) => state.messages);
  const messages = (missionVisualFixture?.messages ?? storedMessages) as Record<string, AgentMessage[]>;
  const storedSessionTimeline = useDeckStore((state) => state.sessionTimeline);
  const sessionTimeline = (missionVisualFixture?.sessionTimeline ?? storedSessionTimeline) as Record<string, SessionTimelineEntry[]>;
  const messageHistoryState = useDeckStore((state) => state.messageHistoryState);
  const setMessageHistoryState = useDeckStore((state) => state.setMessageHistoryState);

  const storedApprovalItemsById = useDeckStore((state) => state.approvalItemsById);
  const approvalItemsById = (missionVisualFixture?.approvalItemsById ?? storedApprovalItemsById) as Record<
    string,
    DeckApprovalItem
  >;
  const storedPendingApprovalIdsBySession = useDeckStore(
    (state) => state.pendingApprovalIdsBySession,
  );
  const pendingApprovalIdsBySession = (missionVisualFixture?.pendingApprovalIdsBySession ??
    storedPendingApprovalIdsBySession) as Record<string, string[]>;
  const derivedPermissionRequests = useMemo<Record<string, PermissionRequest | null>>(() => {
    const result: Record<string, PermissionRequest | null> = {};
    for (const [sessionId, ids] of Object.entries(pendingApprovalIdsBySession)) {
      const headId = ids?.[0];
      if (!headId) continue;
      const head = approvalItemsById[headId];
      if (head) {
        result[sessionId] = head.request;
      }
    }
    return result;
  }, [approvalItemsById, pendingApprovalIdsBySession]);
  const permissionRequests = (missionVisualFixture?.permissionRequests ?? derivedPermissionRequests) as Record<string, any>;

  const storedOutputs = useDeckStore((state) => state.outputs);
  const outputs = (missionVisualFixture?.outputs ?? storedOutputs) as Record<string, CommandChunk[]>;
  const setOutputs = useDeckStore((state) => state.setOutputs);

  const storedToolCalls = useDeckStore((state) => state.toolCalls);
  const toolCalls = (missionVisualFixture?.toolCalls ?? storedToolCalls) as Record<string, AgentToolCall[]>;
  const setToolCalls = useDeckStore((state) => state.setToolCalls);
  const storedSessionPlans = useDeckStore((state) => state.sessionPlans);
  const sessionPlans = (missionVisualFixture?.sessionPlans ?? storedSessionPlans) as Record<string, AgentPlan>;
  const setSessionPlans = useDeckStore((state) => state.setSessionPlans);
  const dismissedCompletedSessionPlanKeys = useDeckStore(
    (state) => state.dismissedCompletedSessionPlanKeys,
  );
  const setDismissedCompletedSessionPlanKeys = useDeckStore(
    (state) => state.setDismissedCompletedSessionPlanKeys,
  );

  const activityHistoryState = useDeckStore((state) => state.activityHistoryState);
  const setActivityHistoryState = useDeckStore((state) => state.setActivityHistoryState);
  const activityVisibleCounts = useDeckStore((state) => state.activityVisibleCounts);
  const setActivityVisibleCounts = useDeckStore((state) => state.setActivityVisibleCounts);
  const storedNotifications = useDeckStore((state) => state.notifications);
  const notifications = (missionVisualFixture?.notifications ?? storedNotifications) as DeckNotification[];
  const addNotification = useDeckStore((state) => state.addNotification);
  const clearNotifications = useDeckStore((state) => state.clearNotifications);

  const sessionTitles = useDeckStore((state) => state.sessionTitles);
  const setSessionTitles = useDeckStore((state) => state.setSessionTitles);

  const storedDiffs = useDeckStore((state) => state.diffs);
  const diffs = (missionVisualFixture?.diffs ?? storedDiffs) as Record<string, FileDiffSummary[]>;
  const setDiffs = useDeckStore((state) => state.setDiffs);
  const historicalDiffIncompleteBySession = useDeckStore(
    (state) => state.historicalDiffIncompleteBySession,
  );

  const sessionConfigOptions = useDeckStore((state) => state.sessionConfigOptions);
  const setSessionConfigOptions = useDeckStore((state) => state.setSessionConfigOptions);
  const sessionAvailableCommands = useDeckStore((state) => state.sessionAvailableCommands);
  const setSessionAvailableCommands = useDeckStore((state) => state.setSessionAvailableCommands);
  const storedPromptQueues = useDeckStore((state) => state.promptQueues) as Record<
    string,
    SessionPromptQueueSnapshot
  >;
  const promptQueues = (missionVisualFixture?.promptQueues ?? storedPromptQueues) as Record<
    string,
    SessionPromptQueueSnapshot
  >;
  const setPromptQueue = useDeckStore((state) => state.setPromptQueue);
  const agentAvailableCommands = useDeckStore((state) => state.agentAvailableCommands);
  const setAgentAvailableCommands = useDeckStore((state) => state.setAgentAvailableCommands);
  const refreshAgentAvailableCommands = useDeckStore((state) => state.refreshAgentAvailableCommands);

  const agentModelOptions = useDeckStore((state) => state.agentModelOptions);
  const setAgentModelOptions = useDeckStore((state) => state.setAgentModelOptions);
  const agentConnectionInventory = useDeckStore((state) => state.agentConnectionInventory);
  const setAgentConnectionInventory = useDeckStore((state) => state.setAgentConnectionInventory);

  const deckPreferences = useDeckStore((state) => state.preferences);
  const updatePreferences = useDeckStore((state) => state.updatePreferences);

  const storedActiveSessionId = useDeckStore((state) => state.activeSessionId);
  const activeSessionId = missionVisualFixture?.activeSessionId ?? storedActiveSessionId;
  const setActiveSessionId = useDeckStore((state) => state.setActiveSessionId);
  const storedOpenChatSessionIds = useDeckStore((state) => state.openChatSessionIds);
  const openChatSessionIds = missionVisualFixture?.openChatSessionIds ?? storedOpenChatSessionIds;
  const setOpenChatSessionIds = useDeckStore((state) => state.setOpenChatSessionIds);
  const storedFocusedChatWindowId = useDeckStore((state) => state.focusedChatWindowId);
  const focusedChatWindowId = missionVisualFixture?.focusedChatWindowId ?? storedFocusedChatWindowId;
  const setFocusedChatWindowId = useDeckStore((state) => state.setFocusedChatWindowId);
  const draftChatWindow = useDeckStore((state) => state.draftChatWindow);
  const setDraftChatWindow = useDeckStore((state) => state.setDraftChatWindow);

  const worktreeGitByProject = useDeckStore((state) => state.worktreeGitByProject);
  const setWorktreeGitByProject = useDeckStore((state) => state.setWorktreeGitByProject);

  const gitStatusByWorktree = useDeckStore((state) => state.gitStatusByWorktree);
  const setGitStatusByWorktree = useDeckStore((state) => state.setGitStatusByWorktree);
  const gitGraphByWorktree = useDeckStore((state) => state.gitGraphByWorktree);
  const setGitGraphByWorktree = useDeckStore((state) => state.setGitGraphByWorktree);

  const daemonProfiles = useDeckStore((state) =>
    selectDaemonProfilesForDeckData(
      state,
      import.meta.env.VITE_TILLER_EMBEDDED_HELM === "true",
    ),
  );
  const addDaemonProfile = useDeckStore((state) => state.addDaemonProfile);
  const removeDaemonProfileFromStore = useDeckStore((state) => state.removeDaemonProfile);
  const selectedHelmKey = useDeckStore((state) => state.selectedHelmKey);
  const selectHelmKey = useDeckStore((state) => state.selectHelmKey);

  const trustedDevice = useDeckStore((state) => state.trustedDevice);
  const setTrustedDevice = useDeckStore((state) => state.setTrustedDevice);
  const trustedDevices = useDeckStore((state) => state.trustedDevices);
  const setTrustedDevices = useDeckStore((state) => state.setTrustedDevices);

  return {
    helms,
    setHelms,
    helmConnectionStates,
    helmInventories,
    applyHelmInventory,
    setHelmConnection,
    removeHelm,
    worktrees,
    setWorktrees,
    projects,
    setProjects,
    agents,
    setAgents,
    sessions,
    setSessions,
    sessionHistoryState,
    setSessionHistoryState,
    statuses,
    setStatuses,
    messages,
    sessionTimeline,
    setMessages,
    messageHistoryState,
    setMessageHistoryState,
    permissionRequests,
    approvalItemsById,
    pendingApprovalIdsBySession,
    outputs,
    setOutputs,
    toolCalls,
    setToolCalls,
    sessionPlans,
    setSessionPlans,
    dismissedCompletedSessionPlanKeys,
    setDismissedCompletedSessionPlanKeys,
    activityHistoryState,
    setActivityHistoryState,
    activityVisibleCounts,
    setActivityVisibleCounts,
    notifications,
    addNotification,
    clearNotifications,
    sessionTitles,
    setSessionTitles,
    diffs,
    setDiffs,
    historicalDiffIncompleteBySession,
    sessionConfigOptions,
    setSessionConfigOptions,
    sessionAvailableCommands,
    setSessionAvailableCommands,
    promptQueues,
    setPromptQueue,
    agentAvailableCommands,
    setAgentAvailableCommands,
    refreshAgentAvailableCommands,
    agentModelOptions,
    setAgentModelOptions,
    agentConnectionInventory,
    setAgentConnectionInventory,
    deckPreferences,
    updatePreferences,
    activeSessionId,
    setActiveSessionId,
    openChatSessionIds,
    setOpenChatSessionIds,
    focusedChatWindowId,
    setFocusedChatWindowId,
    draftChatWindow,
    setDraftChatWindow,
    worktreeGitByProject,
    setWorktreeGitByProject,
    gitStatusByWorktree,
    setGitStatusByWorktree,
    gitGraphByWorktree,
    setGitGraphByWorktree,
    daemonProfiles,
    addDaemonProfile,
    removeDaemonProfileFromStore,
    selectedHelmKey,
    selectHelmKey,
    trustedDevice,
    setTrustedDevice,
    trustedDevices,
    setTrustedDevices,
  };
}
