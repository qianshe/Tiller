import { useDeckStore } from "../../store";
import type {
  AcpAgentProvider,
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  ProjectSummary,
  SessionStatus,
  SessionSummary,
  WorkspaceSummary,
} from "@tiller/shared";

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

  const storedWorkspaces = useDeckStore((state) => state.workspaces);
  const workspaces = (missionVisualFixture?.workspaces ?? storedWorkspaces) as WorkspaceSummary[];
  const setWorkspaces = useDeckStore((state) => state.setWorkspaces);

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

  const storedMessages = useDeckStore((state) => state.messages);
  const messages = (missionVisualFixture?.messages ?? storedMessages) as Record<string, AgentMessage[]>;
  const setMessages = useDeckStore((state) => state.setMessages);
  const messageHistoryState = useDeckStore((state) => state.messageHistoryState);
  const setMessageHistoryState = useDeckStore((state) => state.setMessageHistoryState);

  const permissionRequests = useDeckStore((state) => state.permissionRequests);
  const setPermissionRequests = useDeckStore((state) => state.setPermissionRequests);

  const storedOutputs = useDeckStore((state) => state.outputs);
  const outputs = (missionVisualFixture?.outputs ?? storedOutputs) as Record<string, CommandChunk[]>;
  const setOutputs = useDeckStore((state) => state.setOutputs);

  const storedToolCalls = useDeckStore((state) => state.toolCalls);
  const toolCalls = (missionVisualFixture?.toolCalls ?? storedToolCalls) as Record<string, AgentToolCall[]>;
  const setToolCalls = useDeckStore((state) => state.setToolCalls);

  const activityHistoryState = useDeckStore((state) => state.activityHistoryState);
  const setActivityHistoryState = useDeckStore((state) => state.setActivityHistoryState);
  const activityVisibleCounts = useDeckStore((state) => state.activityVisibleCounts);
  const setActivityVisibleCounts = useDeckStore((state) => state.setActivityVisibleCounts);

  const sessionTitles = useDeckStore((state) => state.sessionTitles);
  const setSessionTitles = useDeckStore((state) => state.setSessionTitles);

  const storedDiffs = useDeckStore((state) => state.diffs);
  const diffs = (missionVisualFixture?.diffs ?? storedDiffs) as Record<string, FileDiffSummary[]>;
  const setDiffs = useDeckStore((state) => state.setDiffs);

  const sessionConfigOptions = useDeckStore((state) => state.sessionConfigOptions);
  const setSessionConfigOptions = useDeckStore((state) => state.setSessionConfigOptions);
  const sessionAvailableCommands = useDeckStore((state) => state.sessionAvailableCommands);
  const setSessionAvailableCommands = useDeckStore((state) => state.setSessionAvailableCommands);

  const agentModelOptions = useDeckStore((state) => state.agentModelOptions);
  const setAgentModelOptions = useDeckStore((state) => state.setAgentModelOptions);

  const deckPreferences = useDeckStore((state) => state.preferences);
  const updatePreferences = useDeckStore((state) => state.updatePreferences);

  const storedActiveSessionId = useDeckStore((state) => state.activeSessionId);
  const activeSessionId = missionVisualFixture?.activeSessionId ?? storedActiveSessionId;
  const setActiveSessionId = useDeckStore((state) => state.setActiveSessionId);

  const worktreeGitByProject = useDeckStore((state) => state.worktreeGitByProject);
  const setWorktreeGitByProject = useDeckStore((state) => state.setWorktreeGitByProject);

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
    workspaces,
    setWorkspaces,
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
    setMessages,
    messageHistoryState,
    setMessageHistoryState,
    permissionRequests,
    setPermissionRequests,
    outputs,
    setOutputs,
    toolCalls,
    setToolCalls,
    activityHistoryState,
    setActivityHistoryState,
    activityVisibleCounts,
    setActivityVisibleCounts,
    sessionTitles,
    setSessionTitles,
    diffs,
    setDiffs,
    sessionConfigOptions,
    setSessionConfigOptions,
    sessionAvailableCommands,
    setSessionAvailableCommands,
    agentModelOptions,
    setAgentModelOptions,
    deckPreferences,
    updatePreferences,
    activeSessionId,
    setActiveSessionId,
    worktreeGitByProject,
    setWorktreeGitByProject,
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
