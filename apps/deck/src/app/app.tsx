import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import "highlight.js/styles/github-dark.css";
import { useDeckStore } from "../store";
import type { ClientToHelm, HelmToClient } from "@tiller/sync-protocol";
import { sortProjectFileSummaries } from "@tiller/shared";
import type {
  AcpAgentProvider,
  AgentMessage,
  AgentPromptContent,
  AgentToolCall,
  ProjectFileSummary,
  ProjectSummary,
  SessionConfigOption,
  SessionReasoningEffort,
  SessionStatus,
  SessionSummary,
  TrustedDeviceSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import {
  daemonProfileKey,
  formatConnectionStatus,
  formatDaemonProfileLine,
  formatPairingState,
  type DaemonProfile,
} from "../features/helm-connection/daemon-profiles";
import { useHelmConnection } from "../features/helm-connection/hooks/use-helm-connection";
import { useReconnectEffects } from "../features/helm-connection/hooks/use-reconnect-effects";
import type { ConnectionState } from "../store/slices/connection-slice";
import type { HelmInventoryBucket } from "../store/slices/helms-slice";
import type { DeckLanguage, DeckTheme } from "../features/preferences/storage";
import { UI_COPY, type Locale } from "../shared/utils/copy";
import { usePreferencesEffects } from "../features/preferences/hooks/use-preferences-effects";
import { resolveTechnicalPanelPreferences } from "../features/preferences/utils/helpers";
import {
  agentModelOptionsKey,
  readAgentModelOptionsCache,
  writeAgentModelOptionsCache,
  type AgentModelOptionsEntry,
} from "../features/agents/utils/agent-model-options-cache";
import {
  createProjectId,
  slugify,
  splitArgs,
} from "../features/agents/utils/agent-identity";
import {
  MODEL_OPTIONS,
  defaultAgentId,
  normalizeModelSelection,
  resolveAgentModeOptions,
  resolveBaseModelOptions,
  resolveCombinedModelValue,
  resolveCurrentAgentMode,
  resolveDraftConfigOptions,
  resolveModelInputPlaceholder,
  resolveModelOptions,
  resolvePreferredModel,
  resolveReasoningLabel,
  resolveReasoningOptionsForModel,
  resolveSessionConfigHint,
  splitModelReasoning,
} from "../features/mission/utils/composer-options";
import { projectFilesKey } from "../features/mission/utils/project-files-key";
import {
  formatProjectSummaryForDisplay,
  resolveProjectDisplayId,
  resolveProjectWorkspaceLabel,
} from "../features/mission/utils/project-display";
import {
  formatResumeLabel,
  isSessionExecutionPending,
} from "../features/mission/utils/session-state";
import {
  dedupeHelmCards,
  resolveHelmConnectionState,
} from "../features/helm-connection/utils/connection-helpers";
import {
  formatRelativeTime,
  formatSessionTime,
} from "../shared/utils/format-time";
import {
  handleActivityServerEvent,
  handleDeviceServerEvent,
  handleInventoryServerEvent,
  handleSessionServerEvent,
} from "../features/server-events/index";
import { AgentsPage } from "../features/agents/ui/page";
import { TrustedDevicesPanel } from "../features/agents/ui/trusted-devices-panel";
import { NAV_LABELS } from "./routes";
import { useRouteView } from "./use-route-view";
import { useActiveConversationUpdateKey } from "./use-active-conversation-key";
import { useConfiguredHelms } from "./use-configured-helms";
import { useDaemonProfileActions } from "./use-daemon-profile-actions";
import { useDeckPreferenceActions } from "./use-deck-preference-actions";
import { usePromptEnhanceAction } from "./use-prompt-enhance-action";
import { useFleetAddHelmActions } from "./use-fleet-add-helm-actions";
import { useSessionCommandActions } from "./use-session-command-actions";
import { useSessionMessageActions } from "./use-session-message-actions";
import { TopNav } from "../shared/ui/layout/top-nav";
import {
  createMissionVisualFixture,
  shouldUseMissionVisualFixture,
} from "../features/mission/utils/visual-fixture";
import { OverviewPage } from "../features/overview/ui/page";
import { SettingsPage } from "../features/settings/ui/page";
import { MissionAgentIcon } from "../features/mission/ui/agent-icon";
import { MissionDisplayPanel } from "../features/mission/ui/display-panel";
import { MissionMessageTimeline } from "../features/mission/ui/message-timeline";
import { MissionPaneResizer } from "../features/mission/ui/pane-resizer";
import { MissionPermissionDrawer } from "../features/mission/ui/permission-drawer";
import { MissionToolLoading } from "../features/mission/ui/tool-loading";
import { ProjectFileList } from "../features/mission/ui/project-file-list";
import { MissionSidebar } from "../features/mission/ui/sidebar";
import { MissionInspector } from "../features/mission/ui/inspector";
import { MissionComposer } from "../features/mission/ui/composer";
import { SessionCleanupConfirmDialog } from "../features/mission/ui/session-cleanup-confirm-dialog";
import { LogbookPanel } from "../features/mission/ui/logbook-panel";
import { useHistoryPagination } from "../features/mission/hooks/use-history-pagination";
import { useMissionLayout } from "../features/mission/hooks/use-layout";
import { usePanelPages } from "../features/mission/hooks/use-panel-pages";
import { usePromptAutosize } from "../features/mission/hooks/use-prompt-autosize";
import { usePromptImages } from "../features/mission/hooks/use-prompt-images";
import {
  useSelection,
  type SessionDraftPreferencePatch,
} from "../features/mission/hooks/use-selection";
import { useSessionTitles } from "../features/mission/hooks/use-session-titles";
import { useSlashCommands } from "../features/mission/hooks/use-slash-commands";
import { useSnapshotCache } from "../features/mission/hooks/use-snapshot-cache";
import { usePromptEnhancerSettings } from "../features/prompt-enhancer/hooks/use-settings";
import {
  resolveDraftSelectionId,
  resolveMissionHelms,
  resolveMissionSelectedProjectId,
  resolveModelOptionsFromConfig,
  resolveProjectFilesScope,
  resolvePromptPlaceholder,
  resolveSessionProjectId,
} from "../features/mission/utils/session-derivations";
import {
  clearTrustedDeviceCache,
  getOrCreateDeviceId,
  readTrustedDeviceCache,
  writeTrustedDeviceCache,
} from "../features/auth/beacon-cache";
import {
  mergeToolCallHistory,
  resolvePendingToolActivity,
} from "../features/logbook/timeline";
import {
  createHelmWebSocketUrl,
  DAEMON_HOST_KEY,
  DAEMON_PORT_KEY,
  resolveDefaultHelmEndpoint,
} from "../features/helm-connection/helm-endpoint";
import {
  connectHelmSocket as connectHelmSocketImpl,
  connectToDaemon as connectToDaemonImpl,
  type ConnectToDaemonOptions,
} from "../features/helm-connection/sockets";
import {
  dispatchWithTrace,
  nextRequestId,
  requestInitialSync as requestInitialSyncImpl,
} from "../features/helm-connection/request-dispatch";
import { useCodeActions } from "../features/pairing/hooks/use-code-actions";
import {
  saveDraft as saveDraftImpl,
  testAgent as testAgentImpl,
  writeDraftToConfig as writeDraftToConfigImpl,
} from "../features/agents/actions/config-actions";
const DEFAULT_DAEMON_HOST = "127.0.0.1";
const DEFAULT_DAEMON_PORT = "47631";
const IS_EMBEDDED_HELM_DECK =
  import.meta.env.VITE_TILLER_EMBEDDED_HELM === "true";
const AGENT_DRAFT_STORAGE_KEY = "tiller.agent-draft";
const DECK_DEVICE_NAME = "Tiller Deck";
const DEFAULT_PROMPT = "";
const DEFAULT_SESSION_PAGE_LIMIT = 25;
const DEFAULT_MESSAGE_PAGE_LIMIT = 20;
const DEFAULT_ACTIVITY_PAGE_LIMIT = 50;
const DEFAULT_LOGBOOK_VISIBLE_LIMIT = 25;
type AgentDraft = { name: string; command: string; args: string };
type ProjectFilesEntry = {
  loading?: boolean;
  message?: string;
  files: ProjectFileSummary[];
};
type AgentModelOptionsCache = Record<
  string,
  AgentModelOptionsEntry & { cachedAt: number }
>;
export function App() {
  const socketRef = useRef<WebSocket | null>(null);
  const helmSocketRefs = useRef<Map<string, WebSocket>>(new Map());
  const requestCounter = useRef(0);
  const pairInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const lastPairingAttemptRef = useRef<string | null>(null);
  const pendingPromptRef = useRef<string | null>(null);
  const pendingPromptContentRef = useRef<AgentPromptContent[] | undefined>(
    undefined,
  );
  const promptModelPickerRef = useRef<HTMLDivElement | null>(null);
  const missionPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const chatMainRef = useRef<HTMLDivElement | null>(null);
  const preserveChatScrollRef = useRef<{
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);
  const stickChatToBottomRef = useRef(true);
  const lastAutoScrollSessionIdRef = useRef<string | null>(null);
  const pendingSessionScrollToBottomRef = useRef<string | null>(null);
  const worktreePickerRef = useRef<HTMLDivElement | null>(null);
  const agentPickerRef = useRef<HTMLDivElement | null>(null);
  const pendingAddHelmProfileRef = useRef<DaemonProfile | null>(null);
  const primaryHelmKeyRef = useRef<string | null>(null);
  const resumeStartRequestsRef = useRef<Set<string>>(new Set());
  const missionVisualMode = useMemo(() => shouldUseMissionVisualFixture(), []);
  const missionVisualFixture = useMemo(
    () =>
      missionVisualMode
        ? createMissionVisualFixture({
            defaultDaemonHost: DEFAULT_DAEMON_HOST,
            defaultDaemonPort: DEFAULT_DAEMON_PORT,
          })
        : null,
    [missionVisualMode],
  );
  const deckDeviceId = useMemo(
    () => getOrCreateDeviceId(window.localStorage),
    [],
  );
  const locale: Locale = "zh-CN";
  const defaultHelmEndpoint = useMemo(
    () =>
      resolveDefaultHelmEndpoint({
        embedded: IS_EMBEDDED_HELM_DECK,
        location: window.location,
        storage: window.localStorage,
        fallbackHost: DEFAULT_DAEMON_HOST,
        fallbackPort: DEFAULT_DAEMON_PORT,
      }),
    [],
  );
  const {
    autoConnectAttemptRef,
    manualDisconnectRef,
    connection,
    setConnection,
    pairingState,
    setPairingState,
    pairingCodeInput,
    setPairingCodeInput,
    pairingFeedback,
    setPairingFeedback,
    connectFeedback,
    setConnectFeedback,
    daemonHost,
    setDaemonHost,
    daemonPort,
    setDaemonPort,
    debugTrace,
    setDebugTrace,
  } = useHelmConnection({
    defaultHelmEndpoint,
    fixtureConnected: Boolean(missionVisualFixture),
  });
  const {
    updatePairingDigit,
    pastePairingDigits,
    handlePairingKeyDown,
    sendPairingRequest,
    submitPairingCode,
  } = useCodeActions({
    socketRef,
    pairingCodeInput,
    setPairingCodeInput,
    pairInputRefs,
    pairingState,
    setPairingState,
    setPairingFeedback,
    setDebugTrace,
    dispatch,
    requestCounter,
    deckDeviceId,
    deckDeviceName: DECK_DEVICE_NAME,
  });
  const storedHelms = useDeckStore((state) => state.helms);
  const helms = missionVisualFixture?.helms ?? storedHelms;
  const setHelms = useDeckStore((state) => state.setHelms);
  const helmConnectionStates = useDeckStore(
    (state) => state.helmConnectionStates,
  );
  const helmInventories = useDeckStore((state) => state.helmInventories);
  const applyHelmInventory = useDeckStore((state) => state.applyHelmInventory);
  const setHelmConnection = useDeckStore((state) => state.setHelmConnection);
  const removeHelm = useDeckStore((state) => state.removeHelm);
  const storedWorkspaces = useDeckStore((state) => state.workspaces);
  const workspaces = missionVisualFixture?.workspaces ?? storedWorkspaces;
  const setWorkspaces = useDeckStore((state) => state.setWorkspaces);
  const storedProjects = useDeckStore((state) => state.projects);
  const projects = missionVisualFixture?.projects ?? storedProjects;
  const setProjects = useDeckStore((state) => state.setProjects);
  const storedAgents = useDeckStore((state) => state.agents);
  const agents = missionVisualFixture?.agents ?? storedAgents;
  const setAgents = useDeckStore((state) => state.setAgents);
  const storedSessions = useDeckStore((state) => state.sessions);
  const sessions = missionVisualFixture?.sessions ?? storedSessions;
  const setSessions = useDeckStore((state) => state.setSessions);
  const sessionHistoryState = useDeckStore(
    (state) => state.sessionHistoryState,
  );
  const setSessionHistoryState = useDeckStore(
    (state) => state.setSessionHistoryState,
  );
  const storedStatuses = useDeckStore((state) => state.statuses);
  const statuses = missionVisualFixture?.statuses ?? storedStatuses;
  const setStatuses = useDeckStore((state) => state.setStatuses);
  const storedMessages = useDeckStore((state) => state.messages);
  const messages = missionVisualFixture?.messages ?? storedMessages;
  const setMessages = useDeckStore((state) => state.setMessages);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [sessionOpenScrollTick, setSessionOpenScrollTick] = useState(0);
  const messageHistoryState = useDeckStore(
    (state) => state.messageHistoryState,
  );
  const setMessageHistoryState = useDeckStore(
    (state) => state.setMessageHistoryState,
  );
  const permissionRequests = useDeckStore((state) => state.permissionRequests);
  const setPermissionRequests = useDeckStore(
    (state) => state.setPermissionRequests,
  );
  const storedOutputs = useDeckStore((state) => state.outputs);
  const outputs = missionVisualFixture?.outputs ?? storedOutputs;
  const setOutputs = useDeckStore((state) => state.setOutputs);
  const storedToolCalls = useDeckStore((state) => state.toolCalls);
  const toolCalls = missionVisualFixture?.toolCalls ?? storedToolCalls;
  const setToolCalls = useDeckStore((state) => state.setToolCalls);
  const toolCallsRef = useRef<Record<string, AgentToolCall[]>>(
    missionVisualFixture?.toolCalls ?? {},
  );
  const agentModelOptionsHydratedRef = useRef(false);
  const activityHistoryState = useDeckStore(
    (state) => state.activityHistoryState,
  );
  const setActivityHistoryState = useDeckStore(
    (state) => state.setActivityHistoryState,
  );
  const activityVisibleCounts = useDeckStore(
    (state) => state.activityVisibleCounts,
  );
  const setActivityVisibleCounts = useDeckStore(
    (state) => state.setActivityVisibleCounts,
  );
  const sessionTitles = useDeckStore((state) => state.sessionTitles);
  const setSessionTitles = useDeckStore((state) => state.setSessionTitles);
  const storedDiffs = useDeckStore((state) => state.diffs);
  const diffs = missionVisualFixture?.diffs ?? storedDiffs;
  const setDiffs = useDeckStore((state) => state.setDiffs);
  const sessionConfigOptions = useDeckStore(
    (state) => state.sessionConfigOptions,
  );
  const setSessionConfigOptions = useDeckStore(
    (state) => state.setSessionConfigOptions,
  );
  const sessionAvailableCommands = useDeckStore(
    (state) => state.sessionAvailableCommands,
  );
  const setSessionAvailableCommands = useDeckStore(
    (state) => state.setSessionAvailableCommands,
  );
  const agentModelOptions = useDeckStore((state) => state.agentModelOptions);
  const setAgentModelOptions = useDeckStore(
    (state) => state.setAgentModelOptions,
  );
  const [projectFilesByScope, setProjectFilesByScope] = useState<
    Record<string, ProjectFilesEntry>
  >({});
  const lastFilesScopeKeyRef = useRef<string | null>(null);
  const [projectFileFilter, setProjectFileFilter] = useState("");
  const [collapsedProjectFileDirectories, setCollapsedProjectFileDirectories] =
    useState<Set<string>>(() => new Set());
  const deckPreferences = useDeckStore((state) => state.preferences);
  const updatePreferences = useDeckStore((state) => state.updatePreferences);
  const { resolveDisplaySessionTitle, assignSessionTitleFromPrompt } =
    useSessionTitles({
      messages,
      sessionTitles,
      setSessionTitles,
      promptEnhancerLlm: deckPreferences.promptEnhancer.llm,
    });
  const {
    busy: promptEnhancerBusy,
    setBusy: setPromptEnhancerBusy,
    status: promptEnhancerStatus,
    setStatus: setPromptEnhancerStatus,
    models: promptEnhancerModels,
    modelFilter: promptEnhancerModelFilter,
    setModelFilter: setPromptEnhancerModelFilter,
    modelPickerOpen: promptEnhancerModelPickerOpen,
    setModelPickerOpen: setPromptEnhancerModelPickerOpen,
    updateLlmPreference: updatePromptEnhancerLlmPreference,
    resetDefaults: resetPromptEnhancerDefaults,
    testSelectedModel: testPromptEnhancerSelectedModel,
    refreshModels: refreshPromptEnhancerModels,
    updateModelInput: updatePromptEnhancerModelInput,
    selectModel: selectPromptEnhancerModel,
  } = usePromptEnhancerSettings({
    preferences: deckPreferences,
    pickerRef: promptModelPickerRef,
    updatePreferences,
  });
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const storedActiveSessionId = useDeckStore((state) => state.activeSessionId);
  const activeSessionId =
    missionVisualFixture?.activeSessionId ?? storedActiveSessionId;
  const setActiveSessionId = useDeckStore((state) => state.setActiveSessionId);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    missionVisualFixture?.selectedProjectId ?? null,
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    missionVisualFixture?.selectedWorkspaceId ?? null,
  );
  const [worktreePickerOpen, setWorktreePickerOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const worktreeGitByProject = useDeckStore(
    (state) => state.worktreeGitByProject,
  );
  const setWorktreeGitByProject = useDeckStore(
    (state) => state.setWorktreeGitByProject,
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    missionVisualFixture?.selectedAgentId ?? null,
  );
  const [selectedAgentMode, setSelectedAgentMode] = useState<string>(
    missionVisualFixture?.sessions[0]?.agentMode ?? "",
  );
  const [selectedModel, setSelectedModel] = useState<string>(
    missionVisualFixture?.sessions[0]?.model ?? MODEL_OPTIONS[0],
  );
  const [selectedReasoningEffort, setSelectedReasoningEffort] =
    useState<SessionReasoningEffort>("medium");
  const [agentTestResult, setAgentTestResult] = useState<string>("尚未测试");
  const [resumeFeedback, setResumeFeedback] = useState<string>("");
  const {
    customPages: customMissionPanelPages,
    selectedPageId: selectedMissionPanelPageId,
    setSelectedPageId: setSelectedMissionPanelPageId,
    selectedDiffFilePath: selectedMissionDiffFilePath,
    setSelectedDiffFilePath: setSelectedMissionDiffFilePath,
    collapsedDiffDirectories: collapsedMissionDiffDirectories,
    setDraggedPageId: setDraggedMissionPanelPageId,
    toggleDiffDirectory: toggleMissionDiffDirectory,
    addPage: addMissionPanelPage,
    dropPage: dropMissionPanelPage,
    renamePage: renameMissionPanelPage,
    movePage: moveMissionPanelPage,
    deletePage: deleteMissionPanelPage,
  } = usePanelPages();
  const { activeView, navigateToView } = useRouteView();
  const {
    missionLayoutRef,
    missionSidebarCollapsed,
    setMissionSidebarCollapsed,
    setMissionInspectorCollapsed,
    effectiveSidebarCollapsed,
    effectiveInspectorCollapsed,
    paneStyles: {
      layout: missionLayoutStyle,
      sidebar: missionSidebarPaneStyle,
      chat: missionChatPaneStyle,
      display: missionDisplayPaneStyle,
      inspector: missionInspectorPaneStyle,
    },
    startMissionPaneResize,
    nudgeMissionPane,
  } = useMissionLayout(activeView);
  usePreferencesEffects();
  useEffect(() => {
    if (
      agentModelOptionsHydratedRef.current ||
      Object.keys(agentModelOptions).length > 0
    ) {
      return;
    }
    agentModelOptionsHydratedRef.current = true;
    const cachedOptions = readAgentModelOptionsCache();
    if (Object.keys(cachedOptions).length > 0) {
      setAgentModelOptions(cachedOptions);
    }
  }, [agentModelOptions, setAgentModelOptions]);
  const [selectedMissionHelmId, setSelectedMissionHelmId] = useState<
    string | null
  >(missionVisualFixture?.sessions[0]?.helmId ?? null);
  const [expandedMissionHelmIds, setExpandedMissionHelmIds] = useState<
    Set<string>
  >(() => new Set());
  const [expandedMissionProjectIds, setExpandedMissionProjectIds] = useState<
    Set<string>
  >(() => new Set());
  const {
    toggleHelmNode: toggleMissionHelmNode,
    toggleProjectNode: toggleMissionProjectNode,
    selectDraftWorkspace,
    selectDraftAgent,
    selectHelm: selectMissionHelm,
    selectProject,
    openSession,
  } = useSelection({
    projects,
    agents,
    sessions,
    requestChatScrollToBottom,
    setSelectedMissionHelmId,
    setExpandedMissionHelmIds,
    setExpandedMissionProjectIds,
    setSelectedProjectId,
    setSelectedWorkspaceId,
    setSelectedAgentId,
    setActiveSessionId,
    setWorktreePickerOpen,
    setAgentPickerOpen,
  });
  const [missionConfigPicker, setMissionConfigPicker] = useState<
    "agentMode" | "model" | "reasoning" | null
  >(null);
  const [agentDraft, setAgentDraft] = useState<AgentDraft>({
    name: "OpenCode",
    command: "opencode",
    args: "acp --pure",
  });
  const [draftSaveMessage, setDraftSaveMessage] =
    useState<string>("草稿未保存");
  const [configSaveMessage, setConfigSaveMessage] =
    useState<string>("尚未写入 Helm 配置");
  const daemonProfiles = useDeckStore((state) =>
    IS_EMBEDDED_HELM_DECK ? [] : state.daemonProfiles,
  );
  const addDaemonProfile = useDeckStore((state) => state.addDaemonProfile);
  const removeDaemonProfileFromStore = useDeckStore(
    (state) => state.removeDaemonProfile,
  );
  const selectedHelmKey = useDeckStore((state) => state.selectedHelmKey);
  const selectHelmKey = useDeckStore((state) => state.selectHelmKey);
  const [agentConfigExpanded, setAgentConfigExpanded] = useState(false);
  const [fleetAddHelmModalOpen, setFleetAddHelmModalOpen] = useState(false);
  const [fleetAddHelmStage, setFleetAddHelmStage] = useState<
    "connect" | "connecting" | "pair"
  >("connect");
  const [fleetAddHelmName, setFleetAddHelmName] = useState<string>("");
  const [fleetAddHelmHost, setFleetAddHelmHost] =
    useState<string>(DEFAULT_DAEMON_HOST);
  const [fleetAddHelmPort, setFleetAddHelmPort] =
    useState<string>(DEFAULT_DAEMON_PORT);
  const [fleetProjectFormOpen, setFleetProjectFormOpen] = useState(false);
  const [fleetProjectDraft, setFleetProjectDraft] = useState({
    name: "",
    path: "",
  });
  const [fleetProjectSaveMessage, setFleetProjectSaveMessage] = useState("");
  const [fleetAgentFormOpen, setFleetAgentFormOpen] = useState(false);
  const [fleetAgentDraft, setFleetAgentDraft] = useState({
    name: "",
    command: "",
    args: [""],
  });
  const [pendingHelmDeleteProfile, setPendingHelmDeleteProfile] =
    useState<DaemonProfile | null>(null);
  const [pendingSessionCleanup, setPendingSessionCleanup] =
    useState<SessionSummary | null>(null);
  const [daemonProfileName, setDaemonProfileName] = useState<string>("");
  const [daemonProfileMessage, setDaemonProfileMessage] = useState<string>("");
  const trustedDevice = useDeckStore((state) => state.trustedDevice);
  const setTrustedDevice = useDeckStore((state) => state.setTrustedDevice);
  const trustedDevices = useDeckStore((state) => state.trustedDevices);
  const setTrustedDevices = useDeckStore((state) => state.setTrustedDevices);
  const copy = UI_COPY[locale];
  useEffect(() => {
    toolCallsRef.current = toolCalls;
  }, [toolCalls]);
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );
  const {
    promptImages,
    setPromptImages,
    imagePasteNotice,
    setImagePasteNotice,
    handlePromptPaste: handleMissionPromptPaste,
    removePromptImage,
  } = usePromptImages({ activeSession });
  const activeSessionMessages = activeSession
    ? (messages[activeSession.id] ?? [])
    : [];
  const activeConversationUpdateKey = useActiveConversationUpdateKey(
    activeSessionId,
    activeSessionMessages,
  );
  const draftProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const configuredHelms = useConfiguredHelms({
    daemonHost,
    daemonPort,
    defaultDaemonHost: DEFAULT_DAEMON_HOST,
    defaultDaemonPort: DEFAULT_DAEMON_PORT,
    daemonProfiles,
    helms,
    embedded: IS_EMBEDDED_HELM_DECK,
  });
  const activeHelm = useMemo(() => {
    const helmId = activeSession?.helmId ?? draftProject?.helmId;
    return configuredHelms.find((helm) => helm.id === helmId) ?? null;
  }, [activeSession?.helmId, configuredHelms, draftProject?.helmId]);
  const effectiveMissionHelmId =
    selectedMissionHelmId ??
    activeSession?.helmId ??
    draftProject?.helmId ??
    projects[0]?.helmId ??
    configuredHelms[0]?.id ??
    null;
  const missionHelms = useMemo(
    () =>
      resolveMissionHelms(configuredHelms, effectiveMissionHelmId, activeHelm),
    [activeHelm, configuredHelms, effectiveMissionHelmId],
  );
  const missionProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          !effectiveMissionHelmId || project.helmId === effectiveMissionHelmId,
      ),
    [effectiveMissionHelmId, projects],
  );
  const filteredWorkspaces = useMemo(() => {
    const workspaceIds = draftProject?.workspaceIds;
    if (!workspaceIds?.length) {
      return workspaces;
    }
    return workspaces.filter((workspace) =>
      workspaceIds.includes(workspace.id),
    );
  }, [draftProject?.workspaceIds, workspaces]);
  const selectedWorkspace =
    filteredWorkspaces.find(
      (workspace) => workspace.id === selectedWorkspaceId,
    ) ??
    filteredWorkspaces[0] ??
    null;
  const draftWorkspaceOptions = filteredWorkspaces;
  const selectedWorkspaceName = selectedWorkspace?.name ?? "";
  const filteredAgents = agents;
  const projectSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          !selectedProjectId ||
          resolveSessionProjectId(session, projects) === selectedProjectId,
      ),
    [projects, selectedProjectId, sessions],
  );
  const sessionCountsByProject = useMemo(
    () =>
      sessions.reduce<Record<string, number>>((counts, session) => {
        const projectId = resolveSessionProjectId(session, projects);
        return { ...counts, [projectId]: (counts[projectId] ?? 0) + 1 };
      }, {}),
    [projects, sessions],
  );
  const activeSessionProjectId = activeSession
    ? resolveSessionProjectId(activeSession, projects)
    : null;
  const missionSelectedProjectId = resolveMissionSelectedProjectId({
    activeSessionProjectId,
    selectedProjectId,
  });
  const activeSessionProject = activeSessionProjectId
    ? (projects.find((project) => project.id === activeSessionProjectId) ??
      null)
    : null;
  const activeStatus = activeSession
    ? copy.status[statuses[activeSession.id] ?? activeSession.status]
    : copy.status.idle;
  const activeResumeLabel = formatResumeLabel(activeSession?.resume, locale);
  const technicalPanels = resolveTechnicalPanelPreferences(deckPreferences);
  const pendingPermission = activeSession
    ? (permissionRequests[activeSession.id] ?? null)
    : null;
  const selectedDraftAgent =
    filteredAgents.find((agent) => agent.id === selectedAgentId) ??
    filteredAgents[0] ??
    null;
  const draftAgent =
    agents.find(
      (agent) => agent.id === (activeSession?.agentId ?? selectedAgentId),
    ) ?? null;
  const draftAgentMode = activeSession
    ? (activeSession.agentMode ?? "")
    : selectedAgentMode;
  const draftModel = activeSession
    ? (activeSession.model ?? MODEL_OPTIONS[0])
    : selectedModel;
  const draftReasoningEffort = activeSession
    ? (activeSession.reasoningEffort ?? "medium")
    : selectedReasoningEffort;
  const draftPromptPlaceholder = resolvePromptPlaceholder(draftAgent);
  const draftConfigHint = resolveSessionConfigHint(
    activeSession,
    agents,
    activeSession?.agentId ?? selectedAgentId,
  );
  const draftModelPlaceholder = resolveModelInputPlaceholder(
    activeSession,
    agents,
    activeSession?.agentId ?? selectedAgentId,
  );
  const draftAgentModelOptionsKey =
    !activeSession && selectedAgentId && selectedWorkspaceId
      ? agentModelOptionsKey(selectedAgentId, selectedWorkspaceId)
      : null;
  const draftAgentModelOptions = draftAgentModelOptionsKey
    ? agentModelOptions[draftAgentModelOptionsKey]
    : undefined;
  const draftConfigOptions = activeSession
    ? resolveDraftConfigOptions(
        activeSession,
        sessions,
        sessionConfigOptions,
        selectedAgentId,
      )
    : (draftAgentModelOptions?.configOptions ??
      resolveDraftConfigOptions(
        activeSession,
        sessions,
        sessionConfigOptions,
        selectedAgentId,
      ));
  const cachedModelSession = activeSession
    ? null
    : sessions.find(
        (session) =>
          session.agentId === selectedAgentId &&
          (session.modelOptions?.length ?? 0) > 0,
      );
  const draftNativeModelOptions =
    activeSession?.modelOptions ??
    draftAgentModelOptions?.modelOptions ??
    cachedModelSession?.modelOptions ??
    [];
  const draftAgentModeOptions = resolveAgentModeOptions(draftConfigOptions);
  const effectiveDraftAgentMode = resolveCurrentAgentMode(
    draftAgentMode,
    draftConfigOptions,
    draftAgentModelOptions?.state.agentMode,
  );
  const showDraftAgentModeSelect = draftAgentModeOptions.length > 0;
  const draftAgentModePickerLabel = showDraftAgentModeSelect
    ? (draftAgentModeOptions.find(
        (option) => option.value === effectiveDraftAgentMode,
      )?.label ??
      effectiveDraftAgentMode ??
      "选择 Agent")
    : draftAgentModelOptions?.loading
      ? "加载 Agents..."
      : "暂无 Agent 列表";
  const draftModelOptions = resolveModelOptions(
    draftModel,
    draftConfigOptions,
    draftNativeModelOptions,
  );
  const draftAllModelOptions = Array.from(
    new Set([
      ...draftModelOptions,
      ...draftNativeModelOptions.map((option) => option.id),
    ]),
  );
  const draftModelParts = splitModelReasoning(draftModel);
  const draftModelBase = draftModelParts.model || draftModel;
  const draftModelBaseOptions = resolveBaseModelOptions(draftModelOptions);
  const draftModelBaseValid = draftModelBaseOptions.includes(draftModelBase);
  const effectiveDraftModelBase = draftModelBaseValid
    ? draftModelBase
    : (draftModelBaseOptions[0] ?? draftModelBase);
  const draftModelPickerLabel = draftModelBaseOptions.length
    ? effectiveDraftModelBase
    : draftAgentModelOptions?.loading
      ? "加载模型..."
      : "暂无模型列表";
  const draftModelPickerDisabled = draftModelBaseOptions.length === 0;
  const draftReasoningOptions = resolveReasoningOptionsForModel(
    effectiveDraftModelBase,
    draftAllModelOptions,
    draftConfigOptions,
  );
  const effectiveDraftReasoningEffort =
    draftModelParts.reasoning ?? draftReasoningEffort;
  const showDraftReasoningSelect = draftReasoningOptions.length > 0;
  const daemonInventory = daemonProfiles.map((profile) =>
    formatDaemonProfileLine(
      profile,
      daemonHost.trim() || DEFAULT_DAEMON_HOST,
      daemonPort.trim() || DEFAULT_DAEMON_PORT,
      connection,
    ),
  );
  const activeProfileId = `${daemonHost.trim() || DEFAULT_DAEMON_HOST}:${daemonPort.trim() || DEFAULT_DAEMON_PORT}`;
  const viewLabels = NAV_LABELS[deckPreferences.language];
  const shellClassName = [
    "shell",
    `view-${activeView}`,
    `theme-${deckPreferences.theme}`,
    deckPreferences.reduceMotion ? "motion-reduced" : "",
  ]
    .filter(Boolean)
    .join(" ");
  function requestChatScrollToBottom(sessionId: string | null) {
    pendingSessionScrollToBottomRef.current = sessionId;
    stickChatToBottomRef.current = true;
    setSessionOpenScrollTick((current) => current + 1);
  }
  function updateSessionDraftPreferences(next: SessionDraftPreferencePatch) {
    if (activeSession && socketRef.current) {
      dispatch(socketRef.current, {
        type: "session.configure",
        requestId: nextRequestId(requestCounter),
        sessionId: activeSession.id,
        agentMode:
          next.agentMode ?? activeSession.agentMode ?? effectiveDraftAgentMode,
        model: normalizeModelSelection(
          next.model ?? activeSession.model ?? draftModel,
        ),
        reasoningEffort:
          next.reasoningEffort ??
          activeSession.reasoningEffort ??
          selectedReasoningEffort,
      });
      return;
    }
    if (typeof next.agentMode === "string") {
      setSelectedAgentMode(next.agentMode);
    }
    if (typeof next.model === "string") {
      setSelectedModel(next.model);
    }
    if (next.reasoningEffort) {
      setSelectedReasoningEffort(next.reasoningEffort);
    }
  }
  const agentLocked = Boolean(
    activeSession?.runtimeSessionId ?? activeSession?.resume?.runtimeSessionId,
  );
  useEffect(() => {
    if (!worktreePickerOpen && !agentPickerOpen) {
      return;
    }
    function closeDraftPickersFromPointer(event: MouseEvent) {
      const target = event.target as Node | null;
      if (
        target &&
        (worktreePickerRef.current?.contains(target) ||
          agentPickerRef.current?.contains(target))
      ) {
        return;
      }
      setWorktreePickerOpen(false);
      setAgentPickerOpen(false);
    }
    function closeDraftPickersFromKeyboard(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      setWorktreePickerOpen(false);
      setAgentPickerOpen(false);
    }
    document.addEventListener("mousedown", closeDraftPickersFromPointer);
    document.addEventListener("keydown", closeDraftPickersFromKeyboard);
    return () => {
      document.removeEventListener("mousedown", closeDraftPickersFromPointer);
      document.removeEventListener("keydown", closeDraftPickersFromKeyboard);
    };
  }, [agentPickerOpen, worktreePickerOpen]);
  useEffect(() => {
    if (
      !selectedMissionHelmId &&
      (activeSession?.helmId ||
        draftProject?.helmId ||
        projects[0]?.helmId ||
        helms[0]?.id)
    ) {
      setSelectedMissionHelmId(
        activeSession?.helmId ??
          draftProject?.helmId ??
          projects[0]?.helmId ??
          helms[0]?.id ??
          null,
      );
    }
  }, [
    activeSession?.helmId,
    draftProject?.helmId,
    helms,
    projects,
    selectedMissionHelmId,
  ]);
  useEffect(() => {
    if (!selectedProjectId && missionProjects.length) {
      const nextProject = missionProjects[0];
      if (!nextProject) {
        return;
      }
      setSelectedProjectId(nextProject.id);
      requestChatScrollToBottom(null);
      setActiveSessionId(null);
    }
  }, [missionProjects, selectedProjectId]);
  useEffect(() => {
    if (effectiveMissionHelmId) {
      setExpandedMissionHelmIds((current) =>
        current.has(effectiveMissionHelmId)
          ? current
          : new Set([...current, effectiveMissionHelmId]),
      );
    }
  }, [effectiveMissionHelmId]);
  useEffect(() => {
    if (!draftProject) {
      return;
    }
    const defaultWorkspaceId = draftProject.defaultWorkspaceId;
    const nextWorkspaceId = resolveDraftSelectionId(
      selectedWorkspaceId,
      filteredWorkspaces,
      defaultWorkspaceId,
    );
    if (nextWorkspaceId && nextWorkspaceId !== selectedWorkspaceId) {
      setSelectedWorkspaceId(nextWorkspaceId);
    }
  }, [draftProject, filteredWorkspaces, selectedWorkspaceId]);
  useEffect(() => {
    if (
      !selectedProjectId ||
      pairingState !== "paired" ||
      !socketRef.current ||
      socketRef.current.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    setWorktreeGitByProject((current) => ({
      ...current,
      [selectedProjectId]: {
        ...(current[selectedProjectId] ?? { branches: [] }),
        loading: true,
        message: "正在加载 worktree...",
      },
    }));
    dispatch(socketRef.current, {
      type: "workspace.git.list",
      requestId: nextRequestId(requestCounter),
      projectId: selectedProjectId,
    });
  }, [pairingState, selectedProjectId]);
  useEffect(() => {
    const scope = resolveProjectFilesScope({
      activeSession,
      activeSessionProjectId: activeSession
        ? resolveSessionProjectId(activeSession, projects)
        : null,
    });
    if (
      !scope.projectId ||
      !scope.workspaceId ||
      pairingState !== "paired" ||
      !socketRef.current ||
      socketRef.current.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const key = projectFilesKey(scope.projectId, scope.workspaceId);
    if (lastFilesScopeKeyRef.current === key) {
      // 同一 project+workspace,只是切换会话 — 复用现有文件列表,避免 loading 闪烁与重复请求。
      return;
    }
    lastFilesScopeKeyRef.current = key;
    setProjectFilesByScope((current) => ({
      ...current,
      [key]: {
        loading: true,
        files: current[key]?.files ?? [],
        message: "正在加载项目文件...",
      },
    }));
    dispatch(socketRef.current, {
      type: "project.files.list",
      requestId: nextRequestId(requestCounter),
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
    });
  }, [
    activeSession?.id,
    activeSession?.projectId,
    activeSession?.workspaceId,
    pairingState,
    projects,
  ]);
  useEffect(() => {
    if (!draftProject) {
      return;
    }
    const defaultProjectAgentId = draftProject.defaultAgentId;
    const fallbackAgentId = resolveDraftSelectionId(
      selectedAgentId,
      filteredAgents,
      defaultProjectAgentId ?? defaultAgentId(filteredAgents),
    );
    if (fallbackAgentId && fallbackAgentId !== selectedAgentId) {
      setSelectedAgentId(fallbackAgentId);
    }
  }, [draftProject, filteredAgents, selectedAgentId]);
  useEffect(() => {
    if (
      activeSession ||
      pairingState !== "paired" ||
      !selectedAgentId ||
      !selectedWorkspaceId ||
      !socketRef.current ||
      socketRef.current.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const key = agentModelOptionsKey(selectedAgentId, selectedWorkspaceId);
    const cached = agentModelOptions[key];
    if (cached && !cached.loading) {
      const realOptions = resolveModelOptions(
        cached.state.model,
        cached.configOptions,
        cached.modelOptions,
      );
      const allOptions = Array.from(
        new Set([
          ...realOptions,
          ...cached.modelOptions.map((option) => option.id),
        ]),
      );
      const nextModel = resolvePreferredModel(cached.state.model, allOptions);
      if (
        nextModel &&
        (!selectedModel ||
          selectedModel === "provider-default" ||
          !allOptions.includes(selectedModel))
      ) {
        setSelectedModel(nextModel);
      }
      if (cached.state.agentMode) {
        setSelectedAgentMode(cached.state.agentMode);
      }
      if (cached.state.reasoningEffort) {
        setSelectedReasoningEffort(cached.state.reasoningEffort);
      }
      return;
    }
    if (cached?.loading) {
      return;
    }
    setAgentModelOptions((current) => ({
      ...current,
      [key]: {
        loading: true,
        modelOptions: [],
        configOptions: [],
        state: {},
        message: "正在加载模型列表...",
      },
    }));
    dispatch(socketRef.current, {
      type: "agent.model.options.get",
      requestId: nextRequestId(requestCounter),
      providerId: selectedAgentId,
      workspaceId: selectedWorkspaceId,
      projectId: selectedProjectId ?? undefined,
    });
  }, [
    activeSession,
    agentModelOptions,
    pairingState,
    selectedAgentId,
    selectedModel,
    selectedProjectId,
    selectedWorkspaceId,
  ]);
  useEffect(() => {
    if (activeView !== "sessions") {
      return;
    }
    const chatMain = chatMainRef.current;
    if (!chatMain) {
      return;
    }
    requestAnimationFrame(() => {
      const preserve = preserveChatScrollRef.current;
      if (preserve) {
        chatMain.scrollTop =
          chatMain.scrollHeight - preserve.scrollHeight + preserve.scrollTop;
        preserveChatScrollRef.current = null;
        return;
      }
      const sessionChanged =
        lastAutoScrollSessionIdRef.current !== activeSessionId;
      const shouldForceSessionBottom = Boolean(
        activeSessionId &&
          pendingSessionScrollToBottomRef.current === activeSessionId,
      );
      lastAutoScrollSessionIdRef.current = activeSessionId;
      if (
        !sessionChanged &&
        !shouldForceSessionBottom &&
        !stickChatToBottomRef.current
      ) {
        return;
      }
      chatMain.scrollTop = chatMain.scrollHeight;
      requestAnimationFrame(() => {
        chatMain.scrollTop = chatMain.scrollHeight;
      });
      if (
        shouldForceSessionBottom &&
        activeSessionId &&
        activeSessionMessages.length > 0 &&
        !messageHistoryState[activeSessionId]?.loading
      ) {
        pendingSessionScrollToBottomRef.current = null;
      }
    });
  }, [
    activeConversationUpdateKey,
    activeView,
    activeSessionId,
    activeSessionMessages.length,
    messageHistoryState,
    sessionOpenScrollTick,
  ]);
  useEffect(() => {
    if (
      !activeSessionId ||
      pairingState !== "paired" ||
      !socketRef.current ||
      socketRef.current.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    setMessageHistoryState((current) => ({
      ...current,
      [activeSessionId]: { hasMore: false, loading: true },
    }));
    setActivityHistoryState((current) => ({
      ...current,
      [activeSessionId]: { hasMore: false, loading: true },
    }));
    dispatch(socketRef.current, {
      type: "session.messages.list",
      requestId: nextRequestId(requestCounter),
      sessionId: activeSessionId,
      limit: DEFAULT_MESSAGE_PAGE_LIMIT,
    });
    dispatch(socketRef.current, {
      type: "session.artifacts.get",
      requestId: nextRequestId(requestCounter),
      sessionId: activeSessionId,
      limit: DEFAULT_ACTIVITY_PAGE_LIMIT,
    });
    dispatch(socketRef.current, {
      type: "session.resume.check",
      requestId: nextRequestId(requestCounter),
      sessionId: activeSessionId,
    });
  }, [activeSessionId, pairingState]);
  usePromptAutosize({
    activeView,
    activeSessionId,
    imagePasteNotice,
    prompt,
    promptImageCount: promptImages.length,
    promptRef: missionPromptRef,
  });
  useEffect(() => {
    if (
      fleetAddHelmModalOpen &&
      fleetAddHelmStage === "connecting" &&
      connection === "connected"
    ) {
      setFleetAddHelmStage("pair");
    }
  }, [connection, fleetAddHelmModalOpen, fleetAddHelmStage]);
  useEffect(() => {
    if (
      !fleetProjectSaveMessage ||
      fleetProjectSaveMessage.startsWith("正在")
    ) {
      return;
    }
    const timer = window.setTimeout(() => setFleetProjectSaveMessage(""), 3600);
    return () => window.clearTimeout(timer);
  }, [fleetProjectSaveMessage]);
  useEffect(() => {
    setTrustedDevice(
      readTrustedDeviceCache(
        window.localStorage,
        daemonHost.trim() || DEFAULT_DAEMON_HOST,
        daemonPort.trim() || DEFAULT_DAEMON_PORT,
      ),
    );
    setTrustedDevices([]);
  }, [daemonHost, daemonPort]);
  useSnapshotCache({
    activeProfileId,
    missionVisualMode,
    pairingState,
    projects,
    sessions,
    workspaces,
    agents,
    setProjects,
    setSessions,
    setWorkspaces,
    setAgents,
    setStatuses,
    setSelectedProjectId,
  });
  useReconnectEffects({
    activeProfileId,
    activeView,
    connection,
    daemonHost,
    daemonPort,
    embedded: IS_EMBEDDED_HELM_DECK,
    missionVisualMode,
    tokenPresent: Boolean(trustedDevice?.token),
    autoConnectAttemptRef,
    manualDisconnectRef,
    connectToDaemon,
  });
  const {
    handleChatMainScroll,
    handleMissionTreeScroll,
    loadOlderActivities,
    loadOlderMessages,
  } = useHistoryPagination({
    activeSessionId,
    activityHistoryState,
    chatMainRef,
    dispatch,
    messageHistoryState,
    preserveChatScrollRef,
    requestCounter,
    sessionHistoryState,
    setActivityHistoryState,
    setMessageHistoryState,
    setSessionHistoryState,
    socketRef,
    stickChatToBottomRef,
    nextRequestId,
    sessionPageLimit: DEFAULT_SESSION_PAGE_LIMIT,
    messagePageLimit: DEFAULT_MESSAGE_PAGE_LIMIT,
    activityPageLimit: DEFAULT_ACTIVITY_PAGE_LIMIT,
  });
  const {
    resetDeckPreferences,
    updateDeckPreference,
    updateTechnicalPanelPreference,
  } = useDeckPreferenceActions({ deckPreferences, updatePreferences });
  const enhancePromptDraft = usePromptEnhanceAction({
    prompt,
    setPrompt,
    promptEnhancer: deckPreferences.promptEnhancer,
    setPromptEnhancerBusy,
    setPromptEnhancerStatus,
    filteredWorkspaces,
    selectedWorkspaceId,
    activeSession,
    draftProject,
    messages,
  });
  function requestInitialSync(socket: WebSocket) {
    requestInitialSyncImpl(socket, {
      dispatch,
      requestCounter,
      setSessionHistoryState,
      sessionPageLimit: DEFAULT_SESSION_PAGE_LIMIT,
    });
  }
  function setHelmConnectionState(helmKey: string, state: ConnectionState) {
    setHelmConnection(helmKey, state);
  }
  function updateHelmInventory(
    helmKey: string,
    patch: Partial<HelmInventoryBucket>,
  ) {
    applyHelmInventory(helmKey, patch);
  }
  const {
    appendSystemMessage,
    appendUserMessage,
    createClientUserMessageId,
  } = useSessionMessageActions({ setMessages });
  function mergeSessionToolCalls(sessionId: string, incoming: AgentToolCall[]) {
    setToolCalls((current) => {
      const next = {
        ...current,
        [sessionId]: mergeToolCallHistory(current[sessionId] ?? [], incoming),
      };
      toolCallsRef.current = next;
      return next;
    });
  }
  function connectHelmSocket(profile: DaemonProfile) {
    connectHelmSocketImpl(profile, {
      embedded: IS_EMBEDDED_HELM_DECK,
      location: window.location,
      helmSocketRefs,
      setHelmConnectionState,
      setDaemonProfileMessage,
      readTrustedDeviceCache,
      requestInitialSync,
      dispatch,
      nextRequestId,
      requestCounter,
      handleServerEvent,
    });
  }
  function connectToDaemon(
    event?: FormEvent<HTMLFormElement>,
    options?: ConnectToDaemonOptions,
  ) {
    connectToDaemonImpl(event, options, {
      embedded: IS_EMBEDDED_HELM_DECK,
      location: window.location,
      daemonHost,
      daemonPort,
      defaultDaemonHost: DEFAULT_DAEMON_HOST,
      defaultDaemonPort: DEFAULT_DAEMON_PORT,
      primaryHelmKeyRef,
      manualDisconnectRef,
      socketRef,
      setSessions,
      setStatuses,
      setMessages,
      setPermissionRequests,
      setOutputs,
      toolCallsRef,
      setToolCalls,
      setDiffs,
      setSessionConfigOptions,
      setTrustedDevices,
      setActiveSessionId,
      setSelectedProjectId,
      setResumeFeedback,
      setDebugTrace,
      setHelmConnectionState,
      setConnection,
      setConnectFeedback,
      copy,
      setPairingState,
      setPairingCodeInput,
      setPairingFeedback,
      pairingState,
      setTrustedDevice,
      readTrustedDeviceCache,
      dispatch,
      nextRequestId,
      requestCounter,
      requestInitialSync,
      lastFilesScopeKeyRef,
      handleServerEvent,
    });
  }
  function dispatch(socket: WebSocket, payload: ClientToHelm) {
    dispatchWithTrace(socket, payload, setDebugTrace);
  }
  const {
    cancelSession,
    cleanupSession,
    createSession,
    requestSessionResumeStart,
    respondToPermission,
    shouldAutoStartSessionResume,
    startResume,
    submitPrompt,
    submitPromptFromKeyboard,
  } = useSessionCommandActions({
    prompt,
    promptImages,
    socketRef,
    setImagePasteNotice,
    activeSessionId,
    selectedProjectId,
    projects,
    selectedWorkspace,
    filteredWorkspaces,
    selectedAgentId,
    filteredAgents,
    pendingPromptRef,
    pendingPromptContentRef,
    dispatch,
    requestCounter,
    effectiveDraftAgentMode,
    normalizeModelSelection,
    selectedModel,
    selectedReasoningEffort,
    navigateToView,
    setPrompt,
    setPromptImages,
    createClientUserMessageId,
    appendUserMessage,
    permissionRequests,
    resumeStartRequestsRef,
    setResumeFeedback,
  });
  function handleServerEvent(
    payload: HelmToClient,
    sourceHelmKey = daemonProfileKey(
      daemonHost.trim() || DEFAULT_DAEMON_HOST,
      daemonPort.trim() || DEFAULT_DAEMON_PORT,
    ),
  ) {
    const currentEventHelmKey =
      primaryHelmKeyRef.current ??
      daemonProfileKey(
        daemonHost.trim() || DEFAULT_DAEMON_HOST,
        daemonPort.trim() || DEFAULT_DAEMON_PORT,
      );
    const sourceIsCurrentHelm = sourceHelmKey === currentEventHelmKey;
    if (
      handleDeviceServerEvent(payload, sourceHelmKey, {
        primaryHelmKeyRef,
        daemonProfileKey,
        daemonHost,
        daemonPort,
        defaultDaemonHost: DEFAULT_DAEMON_HOST,
        defaultDaemonPort: DEFAULT_DAEMON_PORT,
        deckDeviceId,
        pendingAddHelmProfileRef,
        writeTrustedDeviceCache,
        persistDaemonProfile,
        daemonHostStorageKey: DAEMON_HOST_KEY,
        daemonPortStorageKey: DAEMON_PORT_KEY,
        setSelectedHelmKey: selectHelmKey,
        setFleetAddHelmModalOpen,
        setFleetAddHelmStage,
        autoConnectAttemptRef,
        socketRef,
        requestInitialSync,
        readTrustedDeviceCache,
        clearTrustedDeviceCache,
      })
    ) {
      return;
    }
    if (
      handleInventoryServerEvent(payload, sourceHelmKey, sourceIsCurrentHelm, {
        projectFilesKey,
        setProjectFilesByScope,
        setSelectedWorkspaceId,
        setWorktreePickerOpen,
        setAgentTestResult,
        agentModelOptionsKey,
        writeAgentModelOptionsCache,
        selectedAgentId,
        selectedWorkspaceId,
        resolveModelOptions,
        resolvePreferredModel,
        selectedModel,
        setSelectedModel,
        setSelectedAgentMode,
        setSelectedReasoningEffort,
        setConfigSaveMessage,
        setFleetProjectSaveMessage,
        setSelectedProjectId,
        socketRef,
        helmSocketRefs,
        dispatch,
        nextRequestId,
        requestCounter,
      })
    ) {
      return;
    }
    if (
      handleSessionServerEvent(payload, sourceHelmKey, sourceIsCurrentHelm, {
        setSelectedProjectId,
        pendingPromptRef,
        pendingPromptContentRef,
        socketRef,
        assignSessionTitleFromPrompt,
        createClientUserMessageId,
        appendUserMessage,
        dispatch,
        nextRequestId,
        requestCounter,
        toolCallsRef,
        mergeSessionToolCalls,
        shouldAutoStartSessionResume,
        requestSessionResumeStart,
        setResumeFeedback,
        resumeStartRequestsRef,
      })
    ) {
      return;
    }
    if (
      handleActivityServerEvent(payload, {
        toolCallsRef,
        mergeSessionToolCalls,
        appendSystemMessage,
      })
    ) {
      return;
    }
  }
  function testAgent() {
    testAgentImpl({
      selectedAgentId,
      filteredAgents,
      agents,
      socketRef,
      setAgentTestResult,
      copy,
      dispatch,
      requestCounter,
    });
  }
  function saveDraft(event: FormEvent<HTMLFormElement>) {
    saveDraftImpl(event, {
      storageKey: AGENT_DRAFT_STORAGE_KEY,
      agentDraft,
      setDraftSaveMessage,
      copy,
    });
  }
  function writeDraftToConfig() {
    writeDraftToConfigImpl({
      socketRef,
      slugify,
      agentDraft,
      setConfigSaveMessage,
      copy,
      dispatch,
      requestCounter,
      splitArgs,
    });
  }
  const {
    applyDaemonProfile,
    connectDaemonProfile,
    createDaemonProfile,
    persistDaemonProfile,
    removeDaemonProfile,
    saveDaemonProfile,
  } = useDaemonProfileActions({
    daemonProfileName,
    daemonHost,
    daemonPort,
    defaultDaemonHost: DEFAULT_DAEMON_HOST,
    defaultDaemonPort: DEFAULT_DAEMON_PORT,
    daemonProfiles,
    selectedHelmKey,
    helmSocketRefs,
    manualDisconnectRef,
    socketRef,
    lastFilesScopeKeyRef,
    addDaemonProfile,
    removeDaemonProfileFromStore,
    removeHelm,
    selectHelmKey,
    setDaemonHost,
    setDaemonPort,
    setDaemonProfileName,
    setDaemonProfileMessage,
    setConnection,
    connectToDaemon,
  });
  const {
    closeFleetAddHelmModal,
    connectFromFleetAddHelmModal,
    openFleetAddHelmModal,
  } = useFleetAddHelmActions({
    fleetAddHelmName,
    fleetAddHelmHost,
    fleetAddHelmPort,
    defaultDaemonHost: DEFAULT_DAEMON_HOST,
    defaultDaemonPort: DEFAULT_DAEMON_PORT,
    pendingAddHelmProfileRef,
    setFleetAddHelmModalOpen,
    setFleetAddHelmStage,
    setFleetAddHelmName,
    setFleetAddHelmHost,
    setFleetAddHelmPort,
    createDaemonProfile,
    connectToDaemon,
  });
  function revokeTrustedDevice(
    deviceId: string,
    targetSocket: WebSocket | null = socketRef.current,
  ) {
    if (!targetSocket || targetSocket.readyState !== WebSocket.OPEN) {
      setPairingFeedback("请先连接 Helm 后再管理信标。");
      return;
    }
    dispatch(targetSocket, {
      type: "device.revoke",
      requestId: nextRequestId(requestCounter),
      deviceId,
    });
  }
  function renderTrustedDevicesPanel(
    devices: TrustedDeviceSummary[],
    targetSocket: WebSocket | null,
    helmName: string,
  ) {
    return (
      <TrustedDevicesPanel
        devices={devices}
        targetSocket={targetSocket}
        helmName={helmName}
        language={deckPreferences.language}
        deckDeviceId={deckDeviceId}
        onRevokeDevice={revokeTrustedDevice}
      />
    );
  }
  const {
    wrapperRef: slashWrapperRef,
    popupOpen: slashPopupOpen,
    filteredCommands: filteredSlashCommands,
    selectedIndex: slashSelectedIndex,
    setSelectedIndex: setSlashSelectedIndex,
    applyCommand: applySlashCommand,
    handlePromptKeyDown: handleMissionPromptKeyDown,
  } = useSlashCommands({
    prompt,
    setPrompt,
    activeSessionId,
    sessionAvailableCommands,
    promptRef: missionPromptRef,
    onFallbackKeyDown: submitPromptFromKeyboard,
  });
  function toggleProjectFileDirectory(path: string) {
    setCollapsedProjectFileDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }
  function openDiffDetail(path: string) {
    setSelectedMissionDiffFilePath(path);
    setSelectedMissionPanelPageId("diff-detail");
  }
  function toggleExpandedMessage(messageId: string) {
    setExpandedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }
  function renderMissionAgentIcon(agentName: string) {
    return <MissionAgentIcon agentName={agentName} />;
  }
  function renderOverview() {
    return (
      <OverviewPage
        copy={copy}
        connection={connection}
        activeHelm={activeHelm}
        daemonHost={daemonHost}
        daemonPort={daemonPort}
        defaultDaemonHost={DEFAULT_DAEMON_HOST}
        defaultDaemonPort={DEFAULT_DAEMON_PORT}
        projects={projects}
        workspaces={workspaces}
        agents={agents}
        sessions={sessions}
        onNavigate={navigateToView}
        onOpenSession={openSession}
        resolveDisplaySessionTitle={resolveDisplaySessionTitle}
        formatRelativeTime={formatRelativeTime}
      />
    );
  }
  function renderSessions() {
    const canSend = Boolean(
      (prompt.trim() || promptImages.length) &&
        socketRef.current &&
        (activeSessionId ||
          (selectedProjectId && selectedWorkspaceId && selectedAgentId)) &&
        (!promptImages.length ||
          !activeSession ||
          activeSession.imageInput !== false),
    );
    const activeMissionHelm =
      missionHelms.find((helm) => helm.id === effectiveMissionHelmId) ??
      activeHelm;
    const activeMissionHelmProjectCount = missionProjects.length;
    const activeDiffs = activeSession ? (diffs[activeSession.id] ?? []) : [];
    const activeOutputs = activeSession
      ? (outputs[activeSession.id] ?? [])
      : [];
    const activeToolCalls = activeSession
      ? (toolCalls[activeSession.id] ?? [])
      : [];
    const activeSessionStatus = activeSession
      ? (statuses[activeSession.id] ?? activeSession.status)
      : "idle";
    const pendingToolActivity =
      activeSession && isSessionExecutionPending(activeSessionStatus)
        ? resolvePendingToolActivity(activeToolCalls)
        : null;
    const missionActivityLoading =
      activeSession && isSessionExecutionPending(activeSessionStatus)
        ? (pendingToolActivity ?? {
            title: "Agent 响应",
            status: activeSessionStatus,
          })
        : null;
    const missionDiffCount = activeDiffs.length;
    const missionLogCount = activeToolCalls.length || activeOutputs.length;
    const missionStatusLabel = activeSession
      ? copy.status[statuses[activeSession.id] ?? activeSession.status]
      : "待创建";
    const missionPanelPages = [
      { id: "overview", title: "概览" },
      { id: "changes", title: `Git Diff (${missionDiffCount})` },
      { id: "diff-detail", title: "Diff 详情" },
      { id: "logbook", title: `航行日志 (${missionLogCount})` },
      ...customMissionPanelPages,
    ];
    const selectedMissionPanelPage =
      missionPanelPages.find(
        (page) => page.id === selectedMissionPanelPageId,
      ) ?? missionPanelPages[0]!;
    const projectFilesScope = resolveProjectFilesScope({
      activeSession,
      activeSessionProjectId,
    });
    const projectFilesEntry =
      projectFilesScope.projectId && projectFilesScope.workspaceId
        ? projectFilesByScope[
            projectFilesKey(
              projectFilesScope.projectId,
              projectFilesScope.workspaceId,
            )
          ]
        : undefined;
    const projectFiles = [...(projectFilesEntry?.files ?? [])].sort(
      sortProjectFileSummaries,
    );
    const overviewProject = activeSessionProject ?? draftProject;
    const overviewProjectName = overviewProject?.name ?? "未选项目";
    const overviewWorkspaceName =
      activeSession?.workspaceName ?? selectedWorkspace?.name ?? "未选择";
    const overviewAgentName =
      activeSession?.agentName ?? selectedDraftAgent?.name ?? "未选舰员";
    const projectOverviewItems = overviewProject
      ? [
          `Helm · ${activeMissionHelm?.name ?? overviewProject.helmId ?? "未选择"}`,
          `Project · ${overviewProjectName}`,
          `Workspace · ${overviewWorkspaceName}`,
          `ACP · ${overviewAgentName}`,
          overviewProject.path
            ? `路径 · ${overviewProject.path}`
            : "路径 · 等待 Helm 返回",
          `摘要 · ${formatProjectSummaryForDisplay(overviewProject.summary, overviewProjectName)}`,
        ]
      : [];
    const projectFileFilterText = projectFileFilter.trim().toLowerCase();
    const visibleProjectFiles = projectFiles.filter((file) => {
      if (projectFileFilterText) {
        return file.path.toLowerCase().includes(projectFileFilterText);
      }
      const parts = file.path.split("/");
      return !parts
        .slice(1)
        .some((_, index) =>
          collapsedProjectFileDirectories.has(
            parts.slice(0, index + 1).join("/"),
          ),
        );
    });
    const renderProjectFileList = () => (
      <ProjectFileList
        activeSessionPresent={Boolean(activeSession)}
        loading={projectFilesEntry?.loading}
        message={projectFilesEntry?.message}
        projectFiles={projectFiles}
        visibleProjectFiles={visibleProjectFiles}
        collapsedDirectories={collapsedProjectFileDirectories}
        onToggleDirectory={toggleProjectFileDirectory}
      />
    );
    const chatPaneClassName = [
      "chat-conversation",
      "mission-pane",
      "mission-pane-chat",
      !activeSession ? "mission-draft-chat" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const missionLayoutClassName = [
      "card surface-card chat-layout chat-layout-sidebar",
      effectiveSidebarCollapsed ? "mission-sidebar-collapsed" : "",
      effectiveInspectorCollapsed ? "mission-inspector-collapsed" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const renderMissionDisplayPanel = () => (
      <MissionDisplayPanel
        style={missionDisplayPaneStyle}
        pages={missionPanelPages}
        selectedPage={selectedMissionPanelPage}
        selectedDiffFilePath={selectedMissionDiffFilePath}
        diffs={activeDiffs}
        diffCount={missionDiffCount}
        logCount={missionLogCount}
        overviewItems={projectOverviewItems}
        noDiffSummary={copy.noDiffSummary}
        logbookContent={
          <LogbookPanel
            activeSession={activeSession}
            statusLabel={missionStatusLabel}
            diffCount={missionDiffCount}
            logCount={missionLogCount}
            sessionToolCalls={activeToolCalls}
            commandChunks={activeOutputs}
            sessionMessages={
              activeSession ? (messages[activeSession.id] ?? []) : []
            }
            historyState={
              activeSession ? activityHistoryState[activeSession.id] : undefined
            }
            visibleCount={
              activeSession
                ? (activityVisibleCounts[activeSession.id] ??
                  DEFAULT_LOGBOOK_VISIBLE_LIMIT)
                : DEFAULT_LOGBOOK_VISIBLE_LIMIT
            }
            visibleLimit={DEFAULT_LOGBOOK_VISIBLE_LIMIT}
            copy={copy}
            onShowMore={(targetSessionId, nextVisibleCount) =>
              setActivityVisibleCounts((current) => ({
                ...current,
                [targetSessionId]: nextVisibleCount,
              }))
            }
            onLoadOlder={loadOlderActivities}
          />
        }
        collapsedDiffDirectories={collapsedMissionDiffDirectories}
        onAddPage={addMissionPanelPage}
        onSelectPage={setSelectedMissionPanelPageId}
        onDragStart={setDraggedMissionPanelPageId}
        onDrop={dropMissionPanelPage}
        onOpenDiffDetail={openDiffDetail}
        onRenamePage={renameMissionPanelPage}
        onMovePage={moveMissionPanelPage}
        onDeletePage={deleteMissionPanelPage}
        onToggleDiffDirectory={toggleMissionDiffDirectory}
      />
    );
    return (
      <section
        ref={missionLayoutRef}
        className={missionLayoutClassName}
        style={missionLayoutStyle}
      >
        {" "}
        <>
          {" "}
          <MissionSidebar
            effectiveSidebarCollapsed={effectiveSidebarCollapsed}
            missionSidebarCollapsed={missionSidebarCollapsed}
            missionSidebarPaneStyle={missionSidebarPaneStyle}
            handleMissionTreeScroll={handleMissionTreeScroll}
            setMissionSidebarCollapsed={setMissionSidebarCollapsed}
            missionHelms={missionHelms}
            effectiveMissionHelmId={effectiveMissionHelmId}
            expandedMissionHelmIds={expandedMissionHelmIds}
            projects={projects}
            helmConnectionStates={helmConnectionStates}
            activeProfileId={activeProfileId}
            connection={connection}
            toggleMissionHelmNode={toggleMissionHelmNode}
            missionSelectedProjectId={missionSelectedProjectId}
            expandedMissionProjectIds={expandedMissionProjectIds}
            sessions={sessions}
            sessionCountsByProject={sessionCountsByProject}
            agents={agents}
            setSelectedMissionHelmId={setSelectedMissionHelmId}
            setSelectedProjectId={setSelectedProjectId}
            setSelectedWorkspaceId={setSelectedWorkspaceId}
            setSelectedAgentId={setSelectedAgentId}
            setExpandedMissionProjectIds={setExpandedMissionProjectIds}
            setActiveSessionId={setActiveSessionId}
            statuses={statuses}
            copy={copy}
            activeSessionId={activeSessionId}
            openSession={openSession}
            renderMissionAgentIcon={renderMissionAgentIcon}
            resolveDisplaySessionTitle={resolveDisplaySessionTitle}
            formatRelativeTime={formatRelativeTime}
            setPendingSessionCleanup={setPendingSessionCleanup}
            sessionHistoryState={sessionHistoryState}
            toggleMissionProjectNode={toggleMissionProjectNode}
            resizer={
              !effectiveSidebarCollapsed ? (
                <MissionPaneResizer
                  handle="sidebar"
                  label="调整任务列表宽度"
                  onResizeStart={startMissionPaneResize}
                  onNudge={nudgeMissionPane}
                />
              ) : null
            }
          />{" "}
          <div className={chatPaneClassName} style={missionChatPaneStyle}>
            {" "}
            <div
              className="chat-main"
              ref={chatMainRef}
              onScroll={handleChatMainScroll}
            >
              {" "}
              {pairingState !== "paired" ? (
                <div className="note-box compact-note mission-session-feedback">
                  <strong>Helm 未连接</strong>{" "}
                  <p>
                    {" "}
                    任务页会继续展示本地缓存；连接 Helm
                    后即可刷新项目、任务与文件。{" "}
                  </p>{" "}
                </div>
              ) : null}{" "}
              {activeSession ? (
                <>
                  {" "}
                  <MissionMessageTimeline
                    items={activeSessionMessages}
                    sessionId={activeSession.id}
                    assistantLabel={activeSession.agentName}
                    copy={copy}
                    expandedMessageIds={expandedMessageIds}
                    historyStateBySession={messageHistoryState}
                    onLoadOlderMessages={loadOlderMessages}
                    onToggleExpandedMessage={toggleExpandedMessage}
                  />{" "}
                  {missionActivityLoading ? (
                    <MissionToolLoading
                      activity={missionActivityLoading}
                      pendingToolPresent={Boolean(pendingToolActivity)}
                    />
                  ) : null}{" "}
                </>
              ) : null}{" "}
            </div>{" "}
            {activeSession && pendingPermission ? (
              <MissionPermissionDrawer
                request={pendingPermission}
                copy={copy}
                showWorkspace={technicalPanels.showPermissionWorkspace}
                onRespond={respondToPermission}
              />
            ) : null}
            <MissionComposer
              activeSession={activeSession}
              worktreePickerRef={worktreePickerRef}
              worktreePickerOpen={worktreePickerOpen}
              setWorktreePickerOpen={setWorktreePickerOpen}
              agentPickerRef={agentPickerRef}
              agentPickerOpen={agentPickerOpen}
              setAgentPickerOpen={setAgentPickerOpen}
              selectedWorkspaceName={selectedWorkspaceName}
              draftWorkspaceOptions={draftWorkspaceOptions}
              selectedWorkspaceId={selectedWorkspaceId}
              selectDraftWorkspace={selectDraftWorkspace}
              copy={copy}
              agentLocked={agentLocked}
              selectedDraftAgent={selectedDraftAgent}
              filteredAgents={filteredAgents}
              selectedAgentId={selectedAgentId}
              selectDraftAgent={selectDraftAgent}
              submitPrompt={submitPrompt}
              slashWrapperRef={slashWrapperRef}
              promptImages={promptImages}
              removePromptImage={removePromptImage}
              imagePasteNotice={imagePasteNotice}
              missionPromptRef={missionPromptRef}
              prompt={prompt}
              setPrompt={setPrompt}
              handleMissionPromptKeyDown={handleMissionPromptKeyDown}
              handleMissionPromptPaste={handleMissionPromptPaste}
              draftPromptPlaceholder={draftPromptPlaceholder}
              slashPopupOpen={slashPopupOpen}
              filteredSlashCommands={filteredSlashCommands}
              slashSelectedIndex={slashSelectedIndex}
              applySlashCommand={applySlashCommand}
              setSlashSelectedIndex={setSlashSelectedIndex}
              showDraftAgentModeSelect={showDraftAgentModeSelect}
              missionConfigPicker={missionConfigPicker}
              setMissionConfigPicker={setMissionConfigPicker}
              draftAgentModePickerLabel={draftAgentModePickerLabel}
              draftAgentModeOptions={draftAgentModeOptions}
              effectiveDraftAgentMode={effectiveDraftAgentMode}
              updateSessionDraftPreferences={updateSessionDraftPreferences}
              draftModelPlaceholder={draftModelPlaceholder}
              draftModelPickerDisabled={draftModelPickerDisabled}
              draftModelPickerLabel={draftModelPickerLabel}
              draftModelBaseOptions={draftModelBaseOptions}
              resolveReasoningOptionsForModel={resolveReasoningOptionsForModel}
              draftAllModelOptions={draftAllModelOptions}
              draftConfigOptions={draftConfigOptions}
              effectiveDraftReasoningEffort={effectiveDraftReasoningEffort}
              effectiveDraftModelBase={effectiveDraftModelBase}
              resolveCombinedModelValue={resolveCombinedModelValue}
              showDraftReasoningSelect={showDraftReasoningSelect}
              resolveReasoningLabel={resolveReasoningLabel}
              draftReasoningOptions={draftReasoningOptions}
              deckPreferences={deckPreferences}
              enhancePromptDraft={enhancePromptDraft}
              promptEnhancerBusy={promptEnhancerBusy}
              sessionExecutionPending={Boolean(
                activeSession && isSessionExecutionPending(activeSessionStatus),
              )}
              cancelSession={cancelSession}
              canSend={canSend}
            />{" "}
          </div>{" "}
          <MissionPaneResizer
            handle="display"
            label="调整任务展示宽度"
            onResizeStart={startMissionPaneResize}
            onNudge={nudgeMissionPane}
          />{" "}
          {renderMissionDisplayPanel()}{" "}
          <MissionInspector
            collapsed={effectiveInspectorCollapsed}
            style={missionInspectorPaneStyle}
            activeSessionPresent={Boolean(activeSession)}
            projectFileCount={projectFiles.length}
            loading={projectFilesEntry?.loading}
            message={projectFilesEntry?.message}
            filter={projectFileFilter}
            projectFileList={renderProjectFileList()}
            resizer={
              <MissionPaneResizer
                handle="inspector"
                label="调整检视器宽度"
                onResizeStart={startMissionPaneResize}
                onNudge={nudgeMissionPane}
              />
            }
            onFilterChange={setProjectFileFilter}
            onExpand={() => setMissionInspectorCollapsed(false)}
          />{" "}
        </>{" "}
      </section>
    );
  }
  function renderAgents() {
    return (
      <AgentsPage
        daemonHost={daemonHost}
        daemonPort={daemonPort}
        defaultDaemonHost={DEFAULT_DAEMON_HOST}
        defaultDaemonPort={DEFAULT_DAEMON_PORT}
        isEmbeddedHelmDeck={IS_EMBEDDED_HELM_DECK}
        daemonProfiles={daemonProfiles}
        selectedHelmKey={selectedHelmKey}
        connection={connection}
        helmConnectionStates={helmConnectionStates}
        helmInventories={helmInventories}
        trustedDevices={trustedDevices}
        projects={projects}
        agents={agents}
        workspaces={workspaces}
        socketRef={socketRef}
        helmSocketRefs={helmSocketRefs}
        configuredHelms={configuredHelms}
        fleetAddHelmStage={fleetAddHelmStage}
        fleetAddHelmModalOpen={fleetAddHelmModalOpen}
        closeFleetAddHelmModal={closeFleetAddHelmModal}
        connectFromFleetAddHelmModal={connectFromFleetAddHelmModal}
        fleetAddHelmName={fleetAddHelmName}
        setFleetAddHelmName={setFleetAddHelmName}
        fleetAddHelmHost={fleetAddHelmHost}
        setFleetAddHelmHost={setFleetAddHelmHost}
        fleetAddHelmPort={fleetAddHelmPort}
        setFleetAddHelmPort={setFleetAddHelmPort}
        submitPairingCode={submitPairingCode}
        pairInputRefs={pairInputRefs}
        pairingCodeInput={pairingCodeInput}
        pairingState={pairingState}
        updatePairingDigit={updatePairingDigit}
        handlePairingKeyDown={handlePairingKeyDown}
        pastePairingDigits={pastePairingDigits}
        sendPairingRequest={sendPairingRequest}
        connectToDaemon={connectToDaemon}
        pendingHelmDeleteProfile={pendingHelmDeleteProfile}
        setPendingHelmDeleteProfile={setPendingHelmDeleteProfile}
        removeDaemonProfile={removeDaemonProfile}
        setSelectedHelmKey={selectHelmKey}
        openFleetAddHelmModal={openFleetAddHelmModal}
        manualDisconnectRef={manualDisconnectRef}
        setConnection={setConnection}
        lastFilesScopeKeyRef={lastFilesScopeKeyRef}
        setHelmConnectionState={setHelmConnectionState}
        connectDaemonProfile={connectDaemonProfile}
        fleetProjectFormOpen={fleetProjectFormOpen}
        setFleetProjectFormOpen={setFleetProjectFormOpen}
        fleetProjectDraft={fleetProjectDraft}
        setFleetProjectDraft={setFleetProjectDraft}
        setFleetProjectSaveMessage={setFleetProjectSaveMessage}
        fleetProjectSaveMessage={fleetProjectSaveMessage}
        fleetAgentFormOpen={fleetAgentFormOpen}
        setFleetAgentFormOpen={setFleetAgentFormOpen}
        fleetAgentDraft={fleetAgentDraft}
        setFleetAgentDraft={setFleetAgentDraft}
        requestCounter={requestCounter}
        copy={copy}
        renderTrustedDevicesPanel={renderTrustedDevicesPanel}
      />
    );
  }
  function renderSettings() {
    return (
      <SettingsPage
        deckPreferences={deckPreferences}
        technicalPanels={technicalPanels}
        promptModelPickerRef={promptModelPickerRef}
        promptEnhancerBusy={promptEnhancerBusy}
        promptEnhancerModelPickerOpen={promptEnhancerModelPickerOpen}
        promptEnhancerModelFilter={promptEnhancerModelFilter}
        promptEnhancerModels={promptEnhancerModels}
        promptEnhancerStatus={promptEnhancerStatus}
        resetDeckPreferences={resetDeckPreferences}
        updateDeckPreference={updateDeckPreference}
        updateTechnicalPanelPreference={updateTechnicalPanelPreference}
        updatePromptEnhancerLlmPreference={updatePromptEnhancerLlmPreference}
        updatePromptEnhancerModelInput={updatePromptEnhancerModelInput}
        setPromptEnhancerModelPickerOpen={setPromptEnhancerModelPickerOpen}
        refreshPromptEnhancerModels={refreshPromptEnhancerModels}
        setPromptEnhancerModelFilter={setPromptEnhancerModelFilter}
        selectPromptEnhancerModel={selectPromptEnhancerModel}
        resetPromptEnhancerDefaults={resetPromptEnhancerDefaults}
        testPromptEnhancerSelectedModel={testPromptEnhancerSelectedModel}
      />
    );
  }
  return (
    <main className={shellClassName}>
      {" "}
      <TopNav
        activeView={activeView}
        onNavigate={navigateToView}
        connection={connection}
        language={deckPreferences.language}
      />{" "}
      <div className="page-content stack-gap">
        {" "}
        {activeView === "overview" && renderOverview()}{" "}
        {activeView === "sessions" && renderSessions()}{" "}
        {activeView === "agents" && renderAgents()}
        {activeView === "settings" && renderSettings()}{" "}
      </div>{" "}
      <SessionCleanupConfirmDialog
        session={pendingSessionCleanup}
        resolveSessionTitle={resolveDisplaySessionTitle}
        onCancel={() => setPendingSessionCleanup(null)}
        onConfirm={(sessionId) => {
          cleanupSession(sessionId);
          setPendingSessionCleanup(null);
        }}
      />
    </main>
  );
}
