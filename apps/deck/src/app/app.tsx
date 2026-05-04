import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type FormEvent,
  type UIEvent as ReactUIEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import "highlight.js/styles/github-dark.css";
import codexProviderIconUrl from "../shared/assets/provider-icons/codex.svg";
import claudeProviderIconUrl from "../shared/assets/provider-icons/claude-code.svg";
import geminiProviderIconUrl from "../shared/assets/provider-icons/gemini.svg";
import type { ClientToHelm, HelmToClient } from "@tiller/sync-protocol";
import {
  resolveSessionConfigSupport,
  sortProjectFileSummaries,
} from "@tiller/shared";
import type {
  AcpAgentProvider,
  AcpModelOption,
  AgentMessage,
  AgentPromptContent,
  AgentPromptImageContent,
  AgentToolCall,
  AvailableCommand,
  CommandChunk,
  FileDiffSummary,
  HelmSummary,
  PermissionDecision,
  PermissionRequest,
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
  DAEMON_PROFILE_STORAGE_KEY,
  daemonProfileKey,
  formatConnectionStatus,
  formatDaemonProfileLine,
  formatPairingState,
  readDaemonProfiles,
  type DaemonProfile,
} from "../features/helm-connection/daemon-profiles";
import {
  useHelmConnectionState,
  type ConnectionState,
  type HelmInventoryBucket,
} from "../features/helm-connection/use-helm-connection-state";
import {
  DEFAULT_DECK_PREFERENCES,
  DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
  DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
  DECK_PREFERENCES_STORAGE_KEY,
  isRecord,
  readDeckPreferences,
  type DeckLanguage,
  type DeckPreferences,
  type DeckTheme,
  type TechnicalPanelPreferences,
} from "../features/preferences/preferences-storage";
import { UI_COPY, type Locale } from "../shared/utils/copy";
import {
  handleActivityServerEvent,
  handleDeviceServerEvent,
  handleInventoryServerEvent,
  handleSessionServerEvent,
} from "../features/server-events/index";
import { AgentsPage } from "../features/agents/ui/agents-page";
import { NAV_LABELS, VIEW_PATHS, type AppView } from "./routes";
import { TopNav } from "../shared/ui/layout/top-nav";
import {
  createMissionVisualFixture,
  shouldUseMissionVisualFixture,
} from "../features/mission/utils/mission-visual-fixture";
import { OverviewPage } from "../features/overview/ui/overview-page";
import { SettingsPage } from "../features/settings/ui/settings-page";
import { MissionDisplayPanel } from "../features/mission/ui/mission-display-panel";
import { PlainMessages } from "../features/mission/ui/plain-messages";
import { MissionSidebar } from "../features/mission/ui/mission-sidebar";
import { MissionInspector } from "../features/mission/ui/mission-inspector";
import { MissionComposer } from "../features/mission/ui/mission-composer";
import { resolveToolCallTone } from "../features/logbook/tool-call-tone";
import {
  useMissionLayout,
  type MissionResizeHandle,
} from "../features/mission/hooks/use-mission-layout";
import {
  shouldAttemptSilentReconnect,
  shouldEnsureLiveConnection,
} from "../features/helm-connection/reconnect-policy";
import {
  enhancePromptWithLlm,
  listPromptEnhancerModels,
  testPromptEnhancerConnectivity,
  type PromptEnhancerModelOption,
  type PromptEnhancerPreferences,
} from "../features/prompt-enhancer/enhancer";
import { readDeckSnapshot, writeDeckSnapshot } from "../state/snapshot-cache";
import {
  createSessionStatusMap,
  resolveDraftSelectionId,
  resolveMissionHelms,
  resolveMissionSelectedProjectId,
  resolveModelOptionsFromConfig,
  resolveProjectFilesScope,
  resolvePromptPlaceholder,
  resolveSessionProjectId,
  resolveSessionTitle,
  toggleExpandedIdSet,
} from "../features/mission/utils/session-derivations";
import {
  clearTrustedDeviceCache,
  getOrCreateDeviceId,
  readTrustedDeviceCache,
  writeTrustedDeviceCache,
  type TrustedDeviceCache,
} from "../features/auth/beacon-cache";
import { type MissionPanelPage } from "../features/mission/ui/panels";
import {
  createClipboardImageContent,
  extractClipboardImageItems,
} from "../features/mission/utils/clipboard";
import {
  commandChunkToToolCall,
  groupToolCalls,
  mergeMessageHistory,
  mergeToolCallHistory,
  resolvePendingToolActivity,
} from "../features/logbook/timeline";
import { MarkdownMessage } from "../shared/ui/markdown";
import {
  CommandOutput,
  DiffSummary,
  PairingBoxes,
  StatCard,
} from "../shared/ui/primitives";
import { toast } from "../features/toast/toast";
import {
  DAEMON_HOST_KEY,
  DAEMON_PORT_KEY,
  normalizeEmbeddedHelmSummaries,
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
import {
  createSession as createSessionImpl,
  requestSessionResumeStart as requestSessionResumeStartImpl,
  startResume as startResumeImpl,
  submitPrompt as submitPromptImpl,
} from "../features/mission/actions/session-actions";
import {
  handlePairingKeyDown as handlePairingKeyDownImpl,
  pastePairingDigits as pastePairingDigitsImpl,
  sendPairingRequest as sendPairingRequestImpl,
  submitPairingCode as submitPairingCodeImpl,
  updatePairingDigit as updatePairingDigitImpl,
} from "../features/pairing/actions/pairing-actions";
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
const MISSION_PANEL_PAGES_STORAGE_KEY = "tiller.mission-panel-pages";
const AGENT_MODEL_OPTIONS_CACHE_KEY = "tiller.agent-model-options-cache";
const SESSION_TITLES_STORAGE_KEY = "tiller.session-titles";
const AGENT_MODEL_OPTIONS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DECK_DEVICE_NAME = "Tiller Deck";
const DEFAULT_PROMPT = "";
const DEFAULT_SESSION_PAGE_LIMIT = 25;
const DEFAULT_MESSAGE_PAGE_LIMIT = 20;
const DEFAULT_ACTIVITY_PAGE_LIMIT = 50;
const DEFAULT_LOGBOOK_VISIBLE_LIMIT = 25;
const MODEL_OPTIONS = [
  "provider-default",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.2",
  "openai/gpt-5.4",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.2",
  "anthropic/claude-sonnet-4",
] as const;
const REASONING_OPTIONS: Array<{
  value: SessionReasoningEffort;
  label: string;
}> = [
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
];
type AgentDraft = {
  name: string;
  command: string;
  args: string;
};



type AgentModelOptionsEntry = {
  loading?: boolean;
  message?: string;
  modelOptions: AcpModelOption[];
  configOptions: SessionConfigOption[];
  state: {
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  };
};

type ProjectFilesEntry = {
  loading?: boolean;
  message?: string;
  files: ProjectFileSummary[];
};

const DEFAULT_TECHNICAL_PANEL_PREFERENCES: TechnicalPanelPreferences =
  DEFAULT_DECK_PREFERENCES.technicalPanels;

function resolveTechnicalPanelPreferences(
  preferences: DeckPreferences,
): TechnicalPanelPreferences {
  const legacy =
    (
      preferences as DeckPreferences & {
        technicalPanels?: Partial<TechnicalPanelPreferences>;
      }
    ).technicalPanels ?? {};
  return { ...DEFAULT_TECHNICAL_PANEL_PREFERENCES, ...legacy };
}

function agentModelOptionsKey(providerId: string, workspaceId: string) {
  return `${providerId}::${workspaceId}`;
}

function projectFilesKey(
  projectId: string | null | undefined,
  workspaceId: string | null | undefined,
) {
  return `${projectId ?? "none"}::${workspaceId ?? "none"}`;
}

function readSessionTitles(): Record<string, string> {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(SESSION_TITLES_STORAGE_KEY) ?? "{}",
    );
    return parsed && typeof parsed === "object"
      ? Object.fromEntries(
          Object.entries(parsed).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : {};
  } catch {
    return {};
  }
}

function writeSessionTitles(titles: Record<string, string>) {
  window.localStorage.setItem(
    SESSION_TITLES_STORAGE_KEY,
    JSON.stringify(titles),
  );
}

function createFallbackSessionTitle(prompt: string) {
  return prompt.replace(/[\p{P}\p{S}\s]+/gu, "").slice(0, 5) || "新任务";
}

function normalizeGeneratedSessionTitle(value: string) {
  return value.replace(/["'“”‘’`#：:，,。.!！?？\s]+/gu, "").slice(0, 12);
}

async function generateSessionTitleWithLlm(
  prompt: string,
  llm: PromptEnhancerPreferences["llm"],
) {
  const response = await fetch(
    resolveSessionTitleChatCompletionsUrl(llm.baseUrl),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(llm.apiKey.trim()
          ? { Authorization: `Bearer ${llm.apiKey.trim()}` }
          : {}),
      },
      body: JSON.stringify({
        model: llm.model.trim(),
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "你是会话命名器。根据用户输入生成一个中文短标题，只输出标题本身，5到10个字，不要标点。",
          },
          { role: "user", content: prompt },
        ],
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Session title LLM failed: ${response.status}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return normalizeGeneratedSessionTitle(
    data.choices?.[0]?.message?.content ?? "",
  );
}

function resolveSessionTitleChatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/u, "");
  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }
  if (normalized.endsWith("/v1")) {
    return `${normalized}/chat/completions`;
  }
  return `${normalized}/v1/chat/completions`;
}

function daemonProfileToHelmSummary(profile: DaemonProfile): HelmSummary {
  return {
    id: profile.id,
    name: profile.name,
    host: profile.host,
    port: Number(profile.port),
  };
}

function mergeHelmSummariesByEndpoint(items: HelmSummary[]) {
  const byEndpoint = new Map<string, HelmSummary>();
  for (const item of items) {
    byEndpoint.set(daemonProfileKey(item.host, String(item.port)), item);
  }
  return Array.from(byEndpoint.values());
}

function formatProjectSummaryForDisplay(
  summary: string | undefined,
  projectName: string,
) {
  const normalized = summary?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "暂无项目摘要";
  }

  const generatedPrefix = `Project: ${projectName} Configured summary:`;
  const withoutGeneratedPrefix = normalized.includes(generatedPrefix)
    ? (normalized
        .split(generatedPrefix)
        .map((part) => part.trim())
        .filter(Boolean)[0] ??
      normalized.replaceAll(generatedPrefix, "").trim())
    : normalized;
  const compact = withoutGeneratedPrefix || normalized;
  return compact.length > 360 ? `${compact.slice(0, 360)}…` : compact;
}

type AgentModelOptionsCache = Record<
  string,
  AgentModelOptionsEntry & { cachedAt: number }
>;

function readAgentModelOptionsCache(): Record<string, AgentModelOptionsEntry> {
  try {
    const raw = window.localStorage.getItem(AGENT_MODEL_OPTIONS_CACHE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as AgentModelOptionsCache;
    const now = Date.now();
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(
          ([, entry]) =>
            now - entry.cachedAt < AGENT_MODEL_OPTIONS_CACHE_TTL_MS,
        )
        .map(([key, entry]) => [
          key,
          {
            loading: false,
            message: entry.message,
            modelOptions: entry.modelOptions ?? [],
            configOptions: entry.configOptions ?? [],
            state: entry.state ?? {},
          } satisfies AgentModelOptionsEntry,
        ]),
    );
  } catch {
    return {};
  }
}

function writeAgentModelOptionsCache(
  nextEntries: Record<string, AgentModelOptionsEntry>,
) {
  try {
    const now = Date.now();
    const cache = Object.fromEntries(
      Object.entries(nextEntries)
        .filter(
          ([, entry]) =>
            !entry.loading &&
            ((entry.modelOptions?.length ?? 0) > 0 ||
              (entry.configOptions?.length ?? 0) > 0),
        )
        .map(([key, entry]) => [key, { ...entry, cachedAt: now }]),
    );
    window.localStorage.setItem(
      AGENT_MODEL_OPTIONS_CACHE_KEY,
      JSON.stringify(cache),
    );
  } catch {
    // localStorage can be unavailable in private contexts; ignore cache failures.
  }
}

function resolvePreferredModel(
  currentModel: string | undefined,
  modelOptions: string[],
) {
  if (currentModel && modelOptions.includes(currentModel)) {
    return currentModel;
  }

  if (currentModel) {
    const currentBase = splitModelReasoning(currentModel).model;
    const matchingBase = modelOptions.find(
      (option) => splitModelReasoning(option).model === currentBase,
    );
    if (matchingBase) {
      return matchingBase;
    }
  }

  return modelOptions[0];
}



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
  const initialPreferences = useMemo(() => readDeckPreferences(), []);
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
    helmConnectionStates,
    setHelmConnectionStates,
    helmInventories,
    setHelmInventories,
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
  } = useHelmConnectionState({
    defaultHelmEndpoint,
    fixtureConnected: Boolean(missionVisualFixture),
  });
  const [helms, setHelms] = useState<HelmSummary[]>(
    missionVisualFixture?.helms ?? [],
  );
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>(
    missionVisualFixture?.workspaces ?? [],
  );
  const [projects, setProjects] = useState<ProjectSummary[]>(
    missionVisualFixture?.projects ?? [],
  );
  const [agents, setAgents] = useState<AcpAgentProvider[]>(
    missionVisualFixture?.agents ?? [],
  );
  const [sessions, setSessions] = useState<SessionSummary[]>(
    missionVisualFixture?.sessions ?? [],
  );
  const [sessionHistoryState, setSessionHistoryState] = useState<{
    nextCursor?: string;
    hasMore: boolean;
    loading: boolean;
  }>({ hasMore: false, loading: false });
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>(
    missionVisualFixture?.statuses ?? {},
  );
  const [messages, setMessages] = useState<Record<string, AgentMessage[]>>(
    missionVisualFixture?.messages ?? {},
  );
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [sessionOpenScrollTick, setSessionOpenScrollTick] = useState(0);
  const [messageHistoryState, setMessageHistoryState] = useState<
    Record<string, { nextCursor?: string; hasMore: boolean; loading: boolean }>
  >({});
  const [permissionRequests, setPermissionRequests] = useState<
    Record<string, PermissionRequest | null>
  >({});
  const [outputs, setOutputs] = useState<Record<string, CommandChunk[]>>(
    missionVisualFixture?.outputs ?? {},
  );
  const [toolCalls, setToolCalls] = useState<Record<string, AgentToolCall[]>>(
    missionVisualFixture?.toolCalls ?? {},
  );
  const toolCallsRef = useRef<Record<string, AgentToolCall[]>>(
    missionVisualFixture?.toolCalls ?? {},
  );
  const [activityHistoryState, setActivityHistoryState] = useState<
    Record<string, { nextCursor?: string; hasMore: boolean; loading: boolean }>
  >({});
  const [activityVisibleCounts, setActivityVisibleCounts] = useState<
    Record<string, number>
  >({});
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>(
    () => readSessionTitles(),
  );
  const [diffs, setDiffs] = useState<Record<string, FileDiffSummary[]>>(
    missionVisualFixture?.diffs ?? {},
  );
  const [sessionConfigOptions, setSessionConfigOptions] = useState<
    Record<string, SessionConfigOption[]>
  >({});
  const [sessionAvailableCommands, setSessionAvailableCommands] = useState<
    Record<string, AvailableCommand[]>
  >({});
  const [agentModelOptions, setAgentModelOptions] = useState<
    Record<string, AgentModelOptionsEntry>
  >(() => readAgentModelOptionsCache());
  const [projectFilesByScope, setProjectFilesByScope] = useState<
    Record<string, ProjectFilesEntry>
  >({});
  const lastFilesScopeKeyRef = useRef<string | null>(null);
  const [projectFileFilter, setProjectFileFilter] = useState("");
  const [collapsedProjectFileDirectories, setCollapsedProjectFileDirectories] =
    useState<Set<string>>(() => new Set());
  const [deckPreferences, setDeckPreferences] =
    useState<DeckPreferences>(initialPreferences);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [promptImages, setPromptImages] = useState<AgentPromptImageContent[]>(
    [],
  );
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [slashSuppressedFor, setSlashSuppressedFor] = useState<string | null>(
    null,
  );
  const slashWrapperRef = useRef<HTMLDivElement | null>(null);
  const [imagePasteNotice, setImagePasteNotice] = useState("");
  const [promptEnhancerStatus, setPromptEnhancerStatus] = useState("");
  const [promptEnhancerModels, setPromptEnhancerModels] = useState<
    PromptEnhancerModelOption[]
  >([]);
  const [promptEnhancerModelFilter, setPromptEnhancerModelFilter] =
    useState("");
  const [promptEnhancerModelPickerOpen, setPromptEnhancerModelPickerOpen] =
    useState(false);
  const [promptEnhancerBusy, setPromptEnhancerBusy] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    missionVisualFixture?.activeSessionId ?? null,
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    missionVisualFixture?.selectedProjectId ?? null,
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    missionVisualFixture?.selectedWorkspaceId ?? null,
  );
  const [worktreePickerOpen, setWorktreePickerOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [worktreeGitByProject, setWorktreeGitByProject] = useState<
    Record<
      string,
      {
        branches: string[];
        currentBranch?: string;
        message?: string;
        loading?: boolean;
      }
    >
  >({});
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
  const [customMissionPanelPages, setCustomMissionPanelPages] = useState<
    MissionPanelPage[]
  >(() => readMissionPanelPages());
  const [selectedMissionPanelPageId, setSelectedMissionPanelPageId] =
    useState("overview");
  const [selectedMissionDiffFilePath, setSelectedMissionDiffFilePath] =
    useState<string | null>(null);
  const [collapsedMissionDiffDirectories, setCollapsedMissionDiffDirectories] =
    useState<Set<string>>(() => new Set());
  const [draggedMissionPanelPageId, setDraggedMissionPanelPageId] = useState<
    string | null
  >(null);
  const [activeView, setActiveView] = useState<AppView>(() =>
    resolveViewFromPath(window.location.pathname),
  );
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
  const [selectedMissionHelmId, setSelectedMissionHelmId] = useState<
    string | null
  >(missionVisualFixture?.sessions[0]?.helmId ?? null);
  const [expandedMissionHelmIds, setExpandedMissionHelmIds] = useState<
    Set<string>
  >(() => new Set());
  const [expandedMissionProjectIds, setExpandedMissionProjectIds] = useState<
    Set<string>
  >(() => new Set());
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
  const [daemonProfiles, setDaemonProfiles] = useState<DaemonProfile[]>(() =>
    IS_EMBEDDED_HELM_DECK ? [] : readDaemonProfiles(),
  );
  const [selectedHelmKey, setSelectedHelmKey] = useState<string>("");
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
  const [trustedDevice, setTrustedDevice] = useState<TrustedDeviceCache | null>(
    () =>
      readTrustedDeviceCache(
        window.localStorage,
        window.localStorage.getItem(DAEMON_HOST_KEY) ?? DEFAULT_DAEMON_HOST,
        window.localStorage.getItem(DAEMON_PORT_KEY) ?? DEFAULT_DAEMON_PORT,
      ),
  );
  const [trustedDevices, setTrustedDevices] = useState<TrustedDeviceSummary[]>(
    [],
  );

  const copy = UI_COPY[locale];

  useEffect(() => {
    toolCallsRef.current = toolCalls;
  }, [toolCalls]);

  useEffect(() => {
    writeSessionTitles(sessionTitles);
  }, [sessionTitles]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );
  const activeSessionMessages = activeSession
    ? (messages[activeSession.id] ?? [])
    : [];
  const activeConversationUpdateKey = useMemo(() => {
    const lastMessage = activeSessionMessages.at(-1);
    return [
      activeSessionId ?? "",
      activeSessionMessages.length,
      lastMessage?.timestamp ?? "",
      lastMessage?.text.length ?? 0,
    ].join("|");
  }, [activeSessionId, activeSessionMessages]);
  const draftProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const configuredHelms = useMemo(() => {
    const currentHost = daemonHost.trim() || DEFAULT_DAEMON_HOST;
    const currentPort = daemonPort.trim() || DEFAULT_DAEMON_PORT;
    const currentSavedProfile = daemonProfiles.find(
      (profile) =>
        daemonProfileKey(profile.host, profile.port) ===
        daemonProfileKey(currentHost, currentPort),
    );
    const currentProfile: DaemonProfile = {
      id: currentSavedProfile?.id ?? "current-helm",
      name: currentSavedProfile?.name || "Local Helm",
      host: currentHost,
      port: currentPort,
    };
    return mergeHelmSummariesByEndpoint(
      [currentProfile, ...daemonProfiles]
        .map(daemonProfileToHelmSummary)
        .concat(
          normalizeEmbeddedHelmSummaries({
            embedded: IS_EMBEDDED_HELM_DECK,
            host: currentHost,
            port: currentPort,
            helms,
          }),
        ),
    );
  }, [daemonHost, daemonPort, daemonProfiles, helms]);
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

  function navigateToView(view: AppView) {
    const nextPath = VIEW_PATHS[view];
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    setActiveView(view);
  }

  function toggleMissionHelmNode(helmId: string) {
    setExpandedMissionHelmIds((current) => {
      const next = new Set(current);
      if (next.has(helmId)) {
        next.delete(helmId);
      } else {
        next.add(helmId);
      }
      return next;
    });
  }

  function toggleMissionProjectNode(projectId: string) {
    setExpandedMissionProjectIds((current) =>
      toggleExpandedIdSet(current, projectId),
    );
  }

  function selectDraftWorkspace(workspaceId: string) {
    setSelectedWorkspaceId(workspaceId);
    setWorktreePickerOpen(false);
  }

  function selectDraftAgent(agentId: string) {
    setSelectedAgentId(agentId);
    setAgentPickerOpen(false);
  }

  function requestChatScrollToBottom(sessionId: string | null) {
    pendingSessionScrollToBottomRef.current = sessionId;
    stickChatToBottomRef.current = true;
    setSessionOpenScrollTick((current) => current + 1);
  }

  function selectMissionHelm(helmId: string) {
    setSelectedMissionHelmId(helmId);
    setExpandedMissionHelmIds((current) => new Set([...current, helmId]));
    const nextProject =
      projects.find((project) => project.helmId === helmId) ?? null;
    requestChatScrollToBottom(null);
    setSelectedProjectId(nextProject?.id ?? null);
    setActiveSessionId(null);
  }

  function selectProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (project) {
      setSelectedMissionHelmId(project.helmId);
      setExpandedMissionHelmIds(
        (current) => new Set([...current, project.helmId]),
      );
      setExpandedMissionProjectIds(
        (current) => new Set([...current, projectId]),
      );
      setSelectedWorkspaceId((current) =>
        project.workspaceIds?.includes(current ?? "")
          ? current
          : (project.defaultWorkspaceId ?? project.workspaceIds?.[0] ?? null),
      );
      setSelectedAgentId((current) =>
        agents.some((agent) => agent.id === current)
          ? current
          : (project.defaultAgentId ?? agents[0]?.id ?? null),
      );
    }
    setSelectedProjectId(projectId);
    requestChatScrollToBottom(null);
    setActiveSessionId(null);
  }

  function openSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }

    setSelectedMissionHelmId(session.helmId);
    const projectId = resolveSessionProjectId(session, projects);
    setSelectedProjectId(projectId);
    setExpandedMissionHelmIds(
      (current) => new Set([...current, session.helmId]),
    );
    setExpandedMissionProjectIds((current) => new Set([...current, projectId]));
    requestChatScrollToBottom(sessionId);
    setActiveSessionId(sessionId);
  }

  function updateSessionDraftPreferences(next: {
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  }) {
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

  useEffect(() => {
    const handlePopState = () => {
      setActiveView(resolveViewFromPath(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (window.location.pathname.replace(/\/+$/g, "") === "/sessions") {
      window.history.replaceState({}, "", VIEW_PATHS.sessions);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      DECK_PREFERENCES_STORAGE_KEY,
      JSON.stringify(deckPreferences),
    );
    document.documentElement.dataset.deckTheme = deckPreferences.theme;
    document.documentElement.dataset.deckReduceMotion = String(
      deckPreferences.reduceMotion,
    );
  }, [deckPreferences]);

  useEffect(() => {
    if (activeView !== "sessions" || !missionPromptRef.current) {
      return;
    }

    const textarea = missionPromptRef.current;
    let maxHeight = Math.max(160, Math.floor(window.innerHeight * 0.5));
    const draftForm = textarea.closest<HTMLFormElement>(
      ".mission-draft-chat .mission-order-editor",
    );

    if (draftForm) {
      const formStyles = window.getComputedStyle(draftForm);
      const rowGap =
        Number.parseFloat(formStyles.rowGap || formStyles.gap || "0") || 0;
      const visibleSiblings = Array.from(draftForm.children).filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          !element.contains(textarea) &&
          window.getComputedStyle(element).display !== "none",
      );
      const visibleSiblingHeight = visibleSiblings.reduce(
        (total, element) => total + element.getBoundingClientRect().height,
        0,
      );
      const availableDraftHeight = Math.floor(
        draftForm.clientHeight -
          visibleSiblingHeight -
          rowGap * visibleSiblings.length,
      );
      maxHeight = Math.max(96, Math.min(maxHeight, availableDraftHeight));
    }

    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [
    activeSessionId,
    activeView,
    imagePasteNotice,
    prompt,
    promptImages.length,
  ]);

  useEffect(() => {
    if (!promptEnhancerModelPickerOpen) {
      return;
    }

    function closePromptModelPicker(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        promptModelPickerRef.current?.contains(target)
      ) {
        return;
      }
      setPromptEnhancerModelPickerOpen(false);
    }

    function closePromptModelPickerWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPromptEnhancerModelPickerOpen(false);
      }
    }

    document.addEventListener("pointerdown", closePromptModelPicker);
    document.addEventListener("keydown", closePromptModelPickerWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closePromptModelPicker);
      document.removeEventListener(
        "keydown",
        closePromptModelPickerWithKeyboard,
      );
    };
  }, [promptEnhancerModelPickerOpen]);

  useEffect(() => {
    if (
      fleetAddHelmModalOpen &&
      fleetAddHelmStage === "connecting" &&
      connection === "connected"
    ) {
      setFleetAddHelmStage("pair");
    }
  }, [connection, fleetAddHelmModalOpen, fleetAddHelmStage]);

  function openFleetAddHelmModal() {
    setFleetAddHelmStage("connect");
    setFleetAddHelmName("");
    setFleetAddHelmHost(DEFAULT_DAEMON_HOST);
    setFleetAddHelmPort(DEFAULT_DAEMON_PORT);
    pendingAddHelmProfileRef.current = null;
    setFleetAddHelmModalOpen(true);
  }

  function closeFleetAddHelmModal() {
    setFleetAddHelmModalOpen(false);
    setFleetAddHelmStage("connect");
    pendingAddHelmProfileRef.current = null;
  }

  function connectFromFleetAddHelmModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const profile = createDaemonProfile(
      fleetAddHelmName,
      fleetAddHelmHost,
      fleetAddHelmPort,
    );
    pendingAddHelmProfileRef.current = profile;
    setFleetAddHelmStage("connecting");
    void connectToDaemon(undefined, {
      preserveState: true,
      host: profile.host,
      port: profile.port,
      persistEndpoint: false,
    });
  }

  useEffect(() => {
    window.localStorage.setItem(
      MISSION_PANEL_PAGES_STORAGE_KEY,
      JSON.stringify(customMissionPanelPages),
    );
  }, [customMissionPanelPages]);

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

  useEffect(() => {
    if (missionVisualMode) {
      return;
    }
    const snapshot = readDeckSnapshot(window.localStorage, activeProfileId);
    if (!snapshot) {
      return;
    }
    setProjects(snapshot.projects);
    setSessions(snapshot.sessions);
    setWorkspaces(snapshot.workspaces);
    setAgents(snapshot.agents);
    setStatuses(createSessionStatusMap(snapshot.sessions));
    setSelectedProjectId(
      (current) => current ?? snapshot.projects[0]?.id ?? null,
    );
  }, [activeProfileId, missionVisualMode]);

  useEffect(() => {
    if (missionVisualMode || pairingState !== "paired") {
      return;
    }
    writeDeckSnapshot(window.localStorage, {
      profileId: activeProfileId,
      cachedAt: new Date().toISOString(),
      projects,
      sessions,
      workspaces,
      agents,
    });
  }, [activeProfileId, agents, pairingState, projects, sessions, workspaces]);

  useEffect(() => {
    if (
      missionVisualMode ||
      (!trustedDevice?.token && !IS_EMBEDDED_HELM_DECK)
    ) {
      return;
    }
    if (
      !shouldAttemptSilentReconnect({
        connection,
        tokenPresent: Boolean(trustedDevice?.token),
        embedded: IS_EMBEDDED_HELM_DECK,
        host: daemonHost,
        port: daemonPort,
      })
    ) {
      return;
    }
    if (manualDisconnectRef.current === activeProfileId) {
      return;
    }
    const attemptKey = `silent:${activeProfileId}`;
    if (autoConnectAttemptRef.current === attemptKey) {
      return;
    }
    autoConnectAttemptRef.current = attemptKey;
    connectToDaemon(undefined, { preserveState: true, auto: true });
  }, [
    activeProfileId,
    connection,
    daemonHost,
    daemonPort,
    missionVisualMode,
    trustedDevice?.token,
  ]);

  useEffect(() => {
    if (missionVisualMode || !shouldEnsureLiveConnection(activeView)) {
      return;
    }
    if (
      !shouldAttemptSilentReconnect({
        connection,
        tokenPresent: Boolean(trustedDevice?.token),
        embedded: IS_EMBEDDED_HELM_DECK,
        host: daemonHost,
        port: daemonPort,
      })
    ) {
      return;
    }
    if (manualDisconnectRef.current === activeProfileId) {
      return;
    }
    const attemptKey = `live:${activeView}:${activeProfileId}`;
    if (autoConnectAttemptRef.current === attemptKey) {
      return;
    }
    autoConnectAttemptRef.current = attemptKey;
    connectToDaemon(undefined, { preserveState: true, auto: true });
  }, [
    activeProfileId,
    activeView,
    connection,
    daemonHost,
    daemonPort,
    missionVisualMode,
    trustedDevice?.token,
  ]);

  function updateDeckPreference<K extends keyof DeckPreferences>(
    key: K,
    value: DeckPreferences[K],
  ) {
    setDeckPreferences((current) => ({ ...current, [key]: value }));
  }

  function updateTechnicalPanelPreference<
    K extends keyof TechnicalPanelPreferences,
  >(key: K, value: TechnicalPanelPreferences[K]) {
    setDeckPreferences((current) => ({
      ...current,
      technicalPanels: {
        ...resolveTechnicalPanelPreferences(current),
        [key]: value,
      },
    }));
  }

  function updatePromptEnhancerPreference<
    K extends keyof PromptEnhancerPreferences,
  >(key: K, value: PromptEnhancerPreferences[K]) {
    setDeckPreferences((current) => ({
      ...current,
      promptEnhancer: { ...current.promptEnhancer, [key]: value },
    }));
  }

  function updatePromptEnhancerLlmPreference<
    K extends keyof PromptEnhancerPreferences["llm"],
  >(key: K, value: PromptEnhancerPreferences["llm"][K]) {
    setDeckPreferences((current) => ({
      ...current,
      promptEnhancer: {
        ...current.promptEnhancer,
        llm: { ...current.promptEnhancer.llm, [key]: value },
      },
    }));
  }

  function resetPromptEnhancerDefaults() {
    setDeckPreferences((current) => ({
      ...current,
      promptEnhancer: {
        ...current.promptEnhancer,
        llm: {
          ...current.promptEnhancer.llm,
          systemPrompt: DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
          instructionTemplate: DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
        },
      },
    }));
    setPromptEnhancerStatus("已恢复默认增强器 System Prompt 与指令模板。");
  }

  async function testPromptEnhancerSelectedModel() {
    setPromptEnhancerBusy(true);
    setPromptEnhancerStatus("正在测试 LLM 连通性...");
    try {
      await testPromptEnhancerConnectivity(deckPreferences.promptEnhancer.llm);
      setPromptEnhancerStatus("LLM 连通性正常。");
    } catch (error) {
      setPromptEnhancerStatus(
        error instanceof Error ? error.message : "LLM 连通性测试失败",
      );
    } finally {
      setPromptEnhancerBusy(false);
    }
  }

  async function refreshPromptEnhancerModels() {
    setPromptEnhancerBusy(true);
    setPromptEnhancerModelPickerOpen(true);
    setPromptEnhancerStatus("正在获取模型列表...");
    try {
      const models = await listPromptEnhancerModels(
        deckPreferences.promptEnhancer.llm,
      );
      setPromptEnhancerModels(models);
      const ownerCount = new Set(models.map((model) => model.ownedBy)).size;
      setPromptEnhancerStatus(
        models.length
          ? `已获取 ${models.length} 个模型，来自 ${ownerCount} 个 owner。`
          : "模型接口可用，但没有返回模型。",
      );
    } catch (error) {
      setPromptEnhancerStatus(
        error instanceof Error ? error.message : "获取模型失败",
      );
    } finally {
      setPromptEnhancerBusy(false);
    }
  }

  function updatePromptEnhancerModelInput(value: string) {
    updatePromptEnhancerLlmPreference("model", value);
    setPromptEnhancerModelFilter(value);
    setPromptEnhancerModelPickerOpen(true);
  }

  function selectPromptEnhancerModel(model: PromptEnhancerModelOption) {
    updatePromptEnhancerLlmPreference("model", model.id);
    setPromptEnhancerModelFilter("");
    setPromptEnhancerModelPickerOpen(false);
    setPromptEnhancerStatus(`已选择 ${model.id}（${model.ownedBy}）。`);
  }

  async function enhancePromptDraft() {
    const rawPrompt = prompt.trim();
    if (!rawPrompt) {
      return;
    }
    setPromptEnhancerBusy(true);
    setPromptEnhancerStatus("正在增强提示词...");
    try {
      const workspace = filteredWorkspaces.find(
        (item) =>
          item.id === (activeSession?.workspaceId ?? selectedWorkspaceId),
      );
      const enhanced = await enhancePromptWithLlm(
        rawPrompt,
        deckPreferences.promptEnhancer,
        {
          projectName: draftProject?.name ?? activeSession?.projectName,
          workspaceName: activeSession?.workspaceName ?? workspace?.name,
          projectSummary: draftProject?.summary,
          workspaceSummary: workspace?.summary,
          sessionStatus: activeSession?.status,
          sessionSummary: summarizeSessionContext(
            activeSession,
            activeSession ? (messages[activeSession.id] ?? []) : [],
          ),
        },
      );
      setPrompt(enhanced);
      setPromptEnhancerStatus("已增强并回填输入框，请确认后再发送。");
    } catch (error) {
      setPromptEnhancerStatus(
        error instanceof Error ? error.message : "提示词增强失败",
      );
    } finally {
      setPromptEnhancerBusy(false);
    }
  }

  function resetDeckPreferences() {
    setDeckPreferences(DEFAULT_DECK_PREFERENCES);
  }

  function requestInitialSync(socket: WebSocket) {
    requestInitialSyncImpl(socket, {
      dispatch,
      requestCounter,
      setSessionHistoryState,
      sessionPageLimit: DEFAULT_SESSION_PAGE_LIMIT,
    });
  }

  function setHelmConnectionState(helmKey: string, state: ConnectionState) {
    setHelmConnectionStates((current) => ({ ...current, [helmKey]: state }));
  }

  function updateHelmInventory(
    helmKey: string,
    patch: Partial<HelmInventoryBucket>,
  ) {
    const emptyBucket: HelmInventoryBucket = {
      projects: [],
      workspaces: [],
      agents: [],
      sessions: [],
      statuses: {},
      trustedDevices: [],
    };
    setHelmInventories((current) => ({
      ...current,
      [helmKey]: {
        ...emptyBucket,
        ...(current[helmKey] ?? {}),
        ...patch,
      },
    }));
  }

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
        setDaemonHost,
        setDaemonPort,
        daemonHostStorageKey: DAEMON_HOST_KEY,
        daemonPortStorageKey: DAEMON_PORT_KEY,
        setSelectedHelmKey,
        setFleetAddHelmModalOpen,
        setFleetAddHelmStage,
        setTrustedDevice,
        autoConnectAttemptRef,
        setPairingFeedback,
        setPairingState,
        socketRef,
        requestInitialSync,
        readTrustedDeviceCache,
        clearTrustedDeviceCache,
        setTrustedDevices,
        updateHelmInventory,
        helmInventories,
        trustedDevices,
        setConnectFeedback,
      })
    ) {
      return;
    }
    if (
      handleInventoryServerEvent(payload, sourceHelmKey, sourceIsCurrentHelm, {
        setHelms,
        updateHelmInventory,
        setProjects,
        projectFilesKey,
        setProjectFilesByScope,
        setWorkspaces,
        setWorktreeGitByProject,
        setSelectedWorkspaceId,
        setWorktreePickerOpen,
        setAgents,
        setAgentTestResult,
        agentModelOptionsKey,
        setAgentModelOptions,
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
        sessions,
        setSessions,
        setStatuses,
        setSelectedProjectId,
        setActiveSessionId,
        pendingPromptRef,
        pendingPromptContentRef,
        socketRef,
        assignSessionTitleFromPrompt,
        createClientUserMessageId,
        appendUserMessage,
        dispatch,
        nextRequestId,
        requestCounter,
        setSessionConfigOptions,
        setSessionAvailableCommands,
        updateHelmInventory,
        setSessionHistoryState,
        setMessages,
        setMessageHistoryState,
        setPermissionRequests,
        setOutputs,
        setToolCalls,
        toolCallsRef,
        setActivityHistoryState,
        setDiffs,
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
        setMessages,
        setSessions,
        setPermissionRequests,
        setOutputs,
        mergeSessionToolCalls,
        setDiffs,
        setPairingFeedback,
        setPairingState,
        appendSystemMessage,
      })
    ) {
      return;
    }
  }

  function appendSystemMessage(sessionId: string, text: string) {
    setMessages((current) => ({
      ...current,
      [sessionId]: [
        ...(current[sessionId] ?? []),
        {
          id: `${sessionId}-system-${Date.now()}`,
          role: "system",
          text,
          timestamp: new Date().toISOString(),
        },
      ],
    }));
  }

  function createClientUserMessageId(sessionId: string) {
    return `${sessionId}-user-${Date.now()}`;
  }

  function appendUserMessage(
    sessionId: string,
    text: string,
    id = createClientUserMessageId(sessionId),
    attachments: AgentPromptImageContent[] = [],
  ) {
    setMessages((current) => ({
      ...current,
      [sessionId]: mergeMessageHistory(current[sessionId] ?? [], [
        {
          id,
          role: "user",
          text,
          timestamp: new Date().toISOString(),
          ...(attachments.length ? { attachments } : {}),
        },
      ]),
    }));
  }

  function resolveDisplaySessionTitle(session: SessionSummary) {
    const firstUserMessage = messages[session.id]?.find(
      (message) => message.role === "user",
    )?.text;
    return resolveSessionTitle(
      session,
      sessionTitles[session.id] ?? firstUserMessage,
    );
  }

  function assignSessionTitleFromPrompt(sessionId: string, rawPrompt: string) {
    const promptText = rawPrompt.trim();
    if (!promptText) {
      return;
    }
    const fallbackTitle = createFallbackSessionTitle(promptText);
    setSessionTitles((current) =>
      current[sessionId] ? current : { ...current, [sessionId]: fallbackTitle },
    );

    const llm = deckPreferences.promptEnhancer.llm;
    if (!llm.enabled || !llm.baseUrl.trim() || !llm.model.trim()) {
      return;
    }

    void generateSessionTitleWithLlm(promptText, llm)
      .then((title) => {
        if (title) {
          setSessionTitles((current) => ({ ...current, [sessionId]: title }));
        }
      })
      .catch(() => {
        // Keep deterministic fallback title when the optional naming model is unavailable.
      });
  }

  function createSession(
    initialPrompt?: string,
    initialContent?: AgentPromptContent[],
  ) {
    return createSessionImpl(initialPrompt, initialContent, {
      selectedProjectId,
      projects,
      selectedWorkspace,
      filteredWorkspaces,
      selectedAgentId,
      filteredAgents,
      socketRef,
      pendingPromptRef,
      pendingPromptContentRef,
      dispatch,
      requestCounter,
      effectiveDraftAgentMode,
      normalizeModelSelection,
      selectedModel,
      selectedReasoningEffort,
      navigateToView,
    });
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

  function createDaemonProfile(
    nameValue: string,
    hostValue: string,
    portValue: string,
  ): DaemonProfile {
    const host = hostValue.trim() || DEFAULT_DAEMON_HOST;
    const port = portValue.trim() || DEFAULT_DAEMON_PORT;
    const name = nameValue.trim() || `${host}:${port}`;
    return {
      id: slugify(`${name}-${host}-${port}`),
      name,
      host,
      port,
    };
  }

  function persistDaemonProfile(profile: DaemonProfile) {
    const profileKey = daemonProfileKey(profile.host, profile.port);
    const nextProfiles = [
      ...daemonProfiles.filter(
        (item) => daemonProfileKey(item.host, item.port) !== profileKey,
      ),
      profile,
    ];
    setDaemonProfiles(nextProfiles);
    setDaemonProfileName(profile.name);
    setDaemonProfileMessage(`已保存 Helm：${profile.name}`);
    window.localStorage.setItem(
      DAEMON_PROFILE_STORAGE_KEY,
      JSON.stringify(nextProfiles),
    );
  }

  function saveDaemonProfile() {
    persistDaemonProfile(
      createDaemonProfile(daemonProfileName, daemonHost, daemonPort),
    );
  }

  function removeDaemonProfile(profile: DaemonProfile) {
    const profileKey = daemonProfileKey(profile.host, profile.port);
    const nextProfiles = daemonProfiles.filter(
      (item) => daemonProfileKey(item.host, item.port) !== profileKey,
    );
    const currentHelmKey = daemonProfileKey(
      daemonHost.trim() || DEFAULT_DAEMON_HOST,
      daemonPort.trim() || DEFAULT_DAEMON_PORT,
    );
    const fallbackProfile = nextProfiles[0];

    helmSocketRefs.current.get(profileKey)?.close();
    helmSocketRefs.current.delete(profileKey);
    setHelmConnectionState(profileKey, "disconnected");
    setHelmInventories((current) => {
      const { [profileKey]: _removed, ...rest } = current;
      return rest;
    });
    setHelmConnectionStates((current) => {
      const { [profileKey]: _removed, ...rest } = current;
      return rest;
    });

    if (currentHelmKey === profileKey) {
      manualDisconnectRef.current = profileKey;
      socketRef.current?.close();
      socketRef.current = null;
      setConnection("disconnected");
      // 手动断开当前 Helm 后，project files 缓存应失效，避免重连后使用过期数据。
      lastFilesScopeKeyRef.current = null;
      const fallbackHost = fallbackProfile?.host ?? DEFAULT_DAEMON_HOST;
      const fallbackPort = fallbackProfile?.port ?? DEFAULT_DAEMON_PORT;
      setDaemonHost(fallbackHost);
      setDaemonPort(fallbackPort);
      window.localStorage.setItem(DAEMON_HOST_KEY, fallbackHost);
      window.localStorage.setItem(DAEMON_PORT_KEY, fallbackPort);
      setSelectedHelmKey(
        fallbackProfile ? daemonProfileKey(fallbackHost, fallbackPort) : "",
      );
    } else if (selectedHelmKey === profileKey) {
      setSelectedHelmKey(currentHelmKey);
    }

    setDaemonProfiles(nextProfiles);
    window.localStorage.setItem(
      DAEMON_PROFILE_STORAGE_KEY,
      JSON.stringify(nextProfiles),
    );
    setDaemonProfileMessage(`已删除 Helm 前端配置：${profile.name}`);
  }

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
    const labels =
      deckPreferences.language === "en-US"
        ? {
            title: "Beacons",
            count: `${devices.length}`,
            empty: `${helmName} has no beacons yet.`,
            current: "Current",
            revoke: "Revoke",
            web: "Web",
            app: "App",
            lastSeen: "Last auth",
            expiresAt: "Expires",
            revokeDevice: (deviceName: string) => `Revoke ${deviceName}`,
          }
        : {
            title: "信标",
            count: `${devices.length} 个`,
            empty: `${helmName} 暂无信标。`,
            current: "当前",
            revoke: "撤销",
            web: "网页",
            app: "App",
            lastSeen: "最近",
            expiresAt: "到期",
            revokeDevice: (deviceName: string) => `撤销 ${deviceName}`,
          };

    const deviceCreatedAtTime = (device: TrustedDeviceSummary) => {
      const createdAt = Date.parse(device.createdAt);
      return Number.isFinite(createdAt) ? createdAt : 0;
    };
    const nameIndexes = new Map<string, number>();
    const deviceRows = [...devices]
      .sort((left, right) => {
        const createdAtDelta =
          deviceCreatedAtTime(left) - deviceCreatedAtTime(right);
        return createdAtDelta || left.deviceId.localeCompare(right.deviceId);
      })
      .map((device) => {
        const baseName =
          (device.deviceName || "Tiller Deck").trim() || "Tiller Deck";
        const index = nameIndexes.get(baseName) ?? 0;
        nameIndexes.set(baseName, index + 1);

        return {
          ...device,
          displayName: `${baseName}-${index}`,
          isCurrentDevice: device.deviceId === deckDeviceId,
        };
      });

    return (
      <section className="helm-beacon-section">
        <div className="helm-beacon-head">
          <h3>{labels.title}</h3>
          <span className="muted compact">{labels.count}</span>
        </div>
        {deviceRows.length ? (
          <ul className="helm-beacon-simple-list">
            {deviceRows.map((device) => (
              <li key={device.deviceId} className="helm-beacon-simple-row">
                <strong
                  className="helm-beacon-device-name"
                  title={device.displayName}
                >
                  {device.displayName}
                </strong>
                <span className="status-chip subtle-chip helm-beacon-kind">
                  {device.clientKind === "app" ? labels.app : labels.web}
                </span>
                {device.isCurrentDevice ? (
                  <span className="status-chip helm-beacon-current">
                    {labels.current}
                  </span>
                ) : null}
                <span className="helm-beacon-meta helm-beacon-last">
                  {labels.lastSeen} · {formatDeviceTime(device.lastSeenAt)}
                </span>
                <span className="helm-beacon-meta helm-beacon-expires">
                  {labels.expiresAt} · {formatDeviceTime(device.expiresAt)}
                </span>
                <button
                  aria-label={labels.revokeDevice(device.displayName)}
                  className="secondary helm-beacon-action"
                  type="button"
                  onClick={() =>
                    revokeTrustedDevice(device.deviceId, targetSocket)
                  }
                >
                  {labels.revoke}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state helm-beacon-empty">{labels.empty}</div>
        )}
      </section>
    );
  }

  function applyDaemonProfile(profile: DaemonProfile) {
    setDaemonHost(profile.host);
    setDaemonPort(profile.port);
    setDaemonProfileName(profile.name);
    setDaemonProfileMessage(`已切换到 ${profile.name}`);
  }

  function connectDaemonProfile(profile: DaemonProfile) {
    applyDaemonProfile(profile);
    setSelectedHelmKey(daemonProfileKey(profile.host, profile.port));
    void connectToDaemon(undefined, {
      preserveState: true,
      host: profile.host,
      port: profile.port,
    });
  }

  function requestSessionResumeStart(sessionId: string, reason: string) {
    requestSessionResumeStartImpl(sessionId, reason, {
      socketRef,
      resumeStartRequestsRef,
      setResumeFeedback,
      dispatch,
      requestCounter,
    });
  }

  function shouldAutoStartSessionResume(
    session: Pick<SessionSummary, "resume"> | undefined,
  ) {
    const resume = session?.resume;
    return Boolean(
      resume?.state === "resume-available" &&
      resume.mode === "reconnect" &&
      (resume.restoreMethod === "session/load" ||
        resume.restoreMethod === "session/resume"),
    );
  }

  function submitPrompt(event: FormEvent<HTMLFormElement>) {
    submitPromptImpl(event, {
      prompt,
      promptImages,
      socketRef,
      setImagePasteNotice,
      activeSessionId,
      createSession,
      setPrompt,
      setPromptImages,
      createClientUserMessageId,
      appendUserMessage,
      dispatch,
      requestCounter,
    });
  }

  async function handleMissionPromptPaste(
    event: ReactClipboardEvent<HTMLTextAreaElement>,
  ) {
    const images = extractClipboardImageItems(event.clipboardData);
    if (!images.length) {
      return;
    }

    event.preventDefault();

    if (activeSession && activeSession.imageInput === false) {
      setImagePasteNotice("当前 Agent 不支持图片输入，无法粘贴图片喵~");
      return;
    }

    try {
      const startIndex = promptImages.length;
      const nextImages = await Promise.all(
        images.map((file, index) =>
          createClipboardImageContent(file, startIndex + index),
        ),
      );
      setPromptImages((current) => [...current, ...nextImages]);
      setImagePasteNotice("");
    } catch {
      setImagePasteNotice("图片粘贴失败：无法读取剪贴板图片内容。");
    }
  }

  function removePromptImage(index: number) {
    setPromptImages((current) => current.filter((_, i) => i !== index));
  }

  function submitPromptFromKeyboard(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  const slashCommandToken = useMemo(() => {
    const match = /^\/(\S*)$/.exec(prompt);
    return match ? match[1].toLowerCase() : null;
  }, [prompt]);

  const filteredSlashCommands = useMemo(() => {
    if (slashCommandToken === null || !activeSessionId) {
      return [] as AvailableCommand[];
    }
    const all = sessionAvailableCommands[activeSessionId] ?? [];
    if (!slashCommandToken) {
      return all;
    }
    return all.filter((cmd) =>
      cmd.name.toLowerCase().startsWith(slashCommandToken),
    );
  }, [slashCommandToken, activeSessionId, sessionAvailableCommands]);

  const slashPopupOpen =
    filteredSlashCommands.length > 0 && slashSuppressedFor !== prompt;

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [slashCommandToken, activeSessionId]);

  useEffect(() => {
    setSlashSelectedIndex((current) =>
      filteredSlashCommands.length > 0 &&
      current >= filteredSlashCommands.length
        ? 0
        : current,
    );
  }, [filteredSlashCommands.length]);

  useEffect(() => {
    if (!slashPopupOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      if (
        slashWrapperRef.current &&
        !slashWrapperRef.current.contains(event.target as Node)
      ) {
        setSlashSuppressedFor(prompt);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [slashPopupOpen, prompt]);

  function applySlashCommand(cmd: AvailableCommand) {
    setPrompt(`/${cmd.name} `);
    setSlashSuppressedFor(null);
    missionPromptRef.current?.focus();
  }

  function handleMissionPromptKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    if (slashPopupOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashSelectedIndex((i) => (i + 1) % filteredSlashCommands.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashSelectedIndex(
          (i) =>
            (i - 1 + filteredSlashCommands.length) %
            filteredSlashCommands.length,
        );
        return;
      }
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        const cmd = filteredSlashCommands[slashSelectedIndex];
        if (cmd) {
          applySlashCommand(cmd);
        }
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const cmd = filteredSlashCommands[slashSelectedIndex];
        if (cmd) {
          applySlashCommand(cmd);
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashSuppressedFor(prompt);
        return;
      }
    }
    submitPromptFromKeyboard(event);
  }

  function respondToPermission(decision: PermissionDecision) {
    if (!activeSessionId || !socketRef.current) {
      return;
    }

    const permissionRequest = permissionRequests[activeSessionId];
    if (!permissionRequest) {
      return;
    }

    dispatch(socketRef.current, {
      type: "permission.respond",
      requestId: nextRequestId(requestCounter),
      permissionRequestId: permissionRequest.id,
      decision,
    });
  }

  function updatePairingDigit(index: number, rawValue: string) {
    updatePairingDigitImpl(index, rawValue, {
      pairingCodeInput,
      setPairingCodeInput,
      pairInputRefs,
      pairingState,
      setPairingState,
    });
  }

  function pastePairingDigits(startIndex: number, rawValue: string) {
    pastePairingDigitsImpl(startIndex, rawValue, {
      pairingCodeInput,
      setPairingCodeInput,
      pairInputRefs,
      pairingState,
      setPairingState,
    });
  }

  function handlePairingKeyDown(index: number, key: string) {
    handlePairingKeyDownImpl(index, key, {
      pairingCodeInput,
      pairInputRefs,
    });
  }

  function sendPairingRequest() {
    sendPairingRequestImpl({
      socketRef,
      pairingCodeInput,
      setPairingFeedback,
      setDebugTrace,
      dispatch,
      requestCounter,
      deckDeviceId,
      deckDeviceName: DECK_DEVICE_NAME,
      setPairingState,
    });
  }

  function submitPairingCode(event: FormEvent<HTMLFormElement>) {
    submitPairingCodeImpl(event, sendPairingRequest);
  }

  function startResume() {
    startResumeImpl({
      activeSessionId,
      socketRef,
      setResumeFeedback,
      dispatch,
      requestCounter,
    });
  }

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

  function toggleMissionDiffDirectory(path: string) {
    setCollapsedMissionDiffDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  function addMissionPanelPage() {
    const id = `custom-${Date.now()}`;
    setCustomMissionPanelPages((current) => [
      ...current,
      { id, title: `展示页 ${current.length + 1}` },
    ]);
    setSelectedMissionPanelPageId(id);
  }

  function dropMissionPanelPage(targetPageId: string) {
    if (
      !draggedMissionPanelPageId ||
      draggedMissionPanelPageId === targetPageId
    ) {
      return;
    }
    setCustomMissionPanelPages((current) => {
      const fromIndex = current.findIndex(
        (page) => page.id === draggedMissionPanelPageId,
      );
      const toIndex = current.findIndex((page) => page.id === targetPageId);
      if (fromIndex < 0 || toIndex < 0) {
        return current;
      }
      const next = [...current];
      const [dragged] = next.splice(fromIndex, 1);
      if (!dragged) {
        return current;
      }
      next.splice(toIndex, 0, dragged);
      return next;
    });
    setDraggedMissionPanelPageId(null);
  }

  function renameMissionPanelPage(pageId: string, title: string) {
    setCustomMissionPanelPages((current) =>
      current.map((page) => (page.id === pageId ? { ...page, title } : page)),
    );
  }

  function moveMissionPanelPage(pageId: string, direction: -1 | 1) {
    setCustomMissionPanelPages((current) => {
      const index = current.findIndex((page) => page.id === pageId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [page] = next.splice(index, 1);
      if (!page) {
        return current;
      }
      next.splice(targetIndex, 0, page);
      return next;
    });
  }

  function deleteMissionPanelPage(pageId: string) {
    setCustomMissionPanelPages((current) =>
      current.filter((page) => page.id !== pageId),
    );
    if (selectedMissionPanelPageId === pageId) {
      setSelectedMissionPanelPageId("overview");
    }
  }

  function cleanupSession(sessionId: string) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      toast.warning("Helm 未连接，无法清理任务。");
      return;
    }

    toast.info("正在清理任务...", { id: "session-cleanup", duration: 2000 });
    dispatch(socket, {
      type: "session.cleanup",
      requestId: nextRequestId(requestCounter),
      sessionId,
    });
  }

  function cancelSession(sessionId: string) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      toast.warning("Helm 未连接，无法取消任务。");
      return;
    }

    dispatch(socket, {
      type: "session.cancel",
      requestId: nextRequestId(requestCounter),
      sessionId,
    });
  }

  function loadOlderSessions() {
    if (
      !socketRef.current ||
      socketRef.current.readyState !== WebSocket.OPEN ||
      sessionHistoryState.loading ||
      !sessionHistoryState.hasMore ||
      !sessionHistoryState.nextCursor
    ) {
      return;
    }
    setSessionHistoryState((current) => ({ ...current, loading: true }));
    dispatch(socketRef.current, {
      type: "session.list",
      requestId: nextRequestId(requestCounter),
      limit: DEFAULT_SESSION_PAGE_LIMIT,
      before: sessionHistoryState.nextCursor,
    });
  }

  function handleMissionTreeScroll(event: ReactUIEvent<HTMLElement>) {
    const target = event.currentTarget;
    const distanceToBottom =
      target.scrollHeight - target.clientHeight - target.scrollTop;
    if (target.scrollTop <= 24 || distanceToBottom <= 24) {
      loadOlderSessions();
    }
  }

  function loadOlderMessages(sessionId: string) {
    const historyState = messageHistoryState[sessionId];
    if (
      !socketRef.current ||
      socketRef.current.readyState !== WebSocket.OPEN ||
      historyState?.loading ||
      !historyState?.hasMore ||
      !historyState.nextCursor
    ) {
      return;
    }
    if (activeSessionId === sessionId && chatMainRef.current) {
      preserveChatScrollRef.current = {
        scrollHeight: chatMainRef.current.scrollHeight,
        scrollTop: chatMainRef.current.scrollTop,
      };
    }
    setMessageHistoryState((current) => ({
      ...current,
      [sessionId]: { ...current[sessionId], loading: true },
    }));
    dispatch(socketRef.current, {
      type: "session.messages.list",
      requestId: nextRequestId(requestCounter),
      sessionId,
      limit: DEFAULT_MESSAGE_PAGE_LIMIT,
      before: historyState.nextCursor,
    });
  }

  function loadOlderActivities(sessionId: string) {
    const historyState = activityHistoryState[sessionId];
    if (
      !socketRef.current ||
      socketRef.current.readyState !== WebSocket.OPEN ||
      historyState?.loading ||
      !historyState?.hasMore ||
      !historyState.nextCursor
    ) {
      return;
    }
    setActivityHistoryState((current) => ({
      ...current,
      [sessionId]: { ...current[sessionId], loading: true },
    }));
    dispatch(socketRef.current, {
      type: "session.artifacts.get",
      requestId: nextRequestId(requestCounter),
      sessionId,
      limit: DEFAULT_ACTIVITY_PAGE_LIMIT,
      before: historyState.nextCursor,
    });
  }

  function handleChatMainScroll(event: ReactUIEvent<HTMLDivElement>) {
    const target = event.currentTarget;
    const distanceToBottom =
      target.scrollHeight - target.clientHeight - target.scrollTop;
    stickChatToBottomRef.current = distanceToBottom <= 96;

    if (!activeSessionId || target.scrollTop > 32) {
      return;
    }

    const messageState = messageHistoryState[activeSessionId];
    const activityState = activityHistoryState[activeSessionId];
    const canLoadMessages = Boolean(
      messageState?.hasMore && !messageState.loading && messageState.nextCursor,
    );
    const canLoadActivities = Boolean(
      activityState?.hasMore &&
      !activityState.loading &&
      activityState.nextCursor,
    );
    if (!canLoadMessages && !canLoadActivities) {
      return;
    }

    preserveChatScrollRef.current = {
      scrollHeight: target.scrollHeight,
      scrollTop: target.scrollTop,
    };
    loadOlderMessages(activeSessionId);
    loadOlderActivities(activeSessionId);
  }

  function renderPlainMessages(
    items: AgentMessage[],
    sessionId?: string,
    assistantLabel: string = copy.role.assistant,
  ) {
    return (
      <PlainMessages
        items={items}
        emptyText={copy.waitingForAgent}
        assistantLabel={assistantLabel}
        roleLabels={copy.role}
        expandedMessageIds={expandedMessageIds}
        historyState={sessionId ? messageHistoryState[sessionId] : undefined}
        onLoadOlderMessages={() => {
          if (sessionId) {
            loadOlderMessages(sessionId);
          }
        }}
        onToggleExpandedMessage={toggleExpandedMessage}
      />
    );
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

  function summarizeActivityText(text: string) {
    const compact = text.replace(/\s+/g, " ").trim();
    return compact.length > 72
      ? `${compact.slice(0, 72)}…`
      : compact || "发送给 ACP";
  }

  function renderActivityLog(
    sessionId: string | undefined,
    sessionToolCalls: AgentToolCall[],
    commandChunks: CommandChunk[],
    sessionMessages: AgentMessage[],
  ) {
    const toolItems = groupToolCalls(
      sessionToolCalls.length
        ? sessionToolCalls
        : commandChunks.map(commandChunkToToolCall),
    );
    const promptItems = sessionMessages
      .filter((message) => message.role === "user")
      .map((message) => ({
        kind: "prompt" as const,
        id: message.id,
        timestamp: message.timestamp,
        text: message.text,
      }));
    const timelineItems = [
      ...promptItems,
      ...toolItems.map((item) => ({
        kind: "tool" as const,
        timestamp: item.timestamp,
        item,
      })),
    ].sort(
      (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp),
    );
    const historyState = sessionId
      ? activityHistoryState[sessionId]
      : undefined;
    const visibleCount = sessionId
      ? (activityVisibleCounts[sessionId] ?? DEFAULT_LOGBOOK_VISIBLE_LIMIT)
      : DEFAULT_LOGBOOK_VISIBLE_LIMIT;
    const visibleTimelineItems = timelineItems.slice(0, visibleCount);
    const hiddenCount = Math.max(
      0,
      timelineItems.length - visibleTimelineItems.length,
    );
    if (!timelineItems.length) {
      return (
        <CommandOutput
          items={commandChunks}
          emptyLabel={copy.noCommandOutput}
        />
      );
    }

    return (
      <section className="info-list mission-activity-log">
        <div className="section-head section-head-soft">
          <div>
            <h3>{copy.commandOutput}</h3>
          </div>
        </div>
        <div className="plain-message-list conversation-timeline activity-timeline">
          {visibleTimelineItems.map((timelineItem) => {
            if (timelineItem.kind === "prompt") {
              return (
                <details
                  key={timelineItem.id}
                  className="tool-call-card acp-prompt-card"
                >
                  <summary className="tool-call-head">
                    <span className="tool-call-icon" aria-hidden="true">
                      ↗
                    </span>
                    <span className="tool-call-kind">Prompt</span>
                    <strong>{summarizeActivityText(timelineItem.text)}</strong>
                    <span className="tool-call-stream">user</span>
                  </summary>
                  <pre className="tool-call-output">{timelineItem.text}</pre>
                </details>
              );
            }

            const toolTone = resolveToolCallTone(
              timelineItem.item.toolKind,
              timelineItem.item.title,
            );
            const streamTone = timelineItem.item.streams.includes("stderr")
              ? "stderr"
              : "stdout";
            return (
              <details
                key={timelineItem.item.id}
                className={`tool-call-card tool-call-${streamTone} ${toolTone.className}`}
              >
                <summary className="tool-call-head">
                  <span className="tool-call-icon" aria-hidden="true">
                    {toolTone.icon}
                  </span>
                  <span className="tool-call-kind">{toolTone.label}</span>
                  <strong>{timelineItem.item.title}</strong>
                  <span
                    className={`tool-call-stream tool-call-stream-${streamTone}`}
                  >
                    {streamTone}
                  </span>
                </summary>
                {timelineItem.item.text.trim() ? (
                  <pre className="tool-call-output">
                    {timelineItem.item.text}
                  </pre>
                ) : null}
              </details>
            );
          })}
          {hiddenCount > 0 ? (
            <button
              className="secondary load-more-history"
              type="button"
              onClick={() =>
                sessionId
                  ? setActivityVisibleCounts((current) => ({
                      ...current,
                      [sessionId]: visibleCount + DEFAULT_LOGBOOK_VISIBLE_LIMIT,
                    }))
                  : undefined
              }
            >
              展开更多（剩余 {hiddenCount} 条）
            </button>
          ) : historyState?.hasMore ? (
            <button
              className="secondary load-more-history"
              type="button"
              onClick={() => loadOlderActivities(sessionId!)}
              disabled={historyState.loading}
            >
              {historyState.loading ? "加载中..." : "加载更早活动"}
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  function renderSessionOverview(diffCount: number, logCount: number) {
    const statusLabel = activeSession
      ? copy.status[statuses[activeSession.id] ?? activeSession.status]
      : "待创建";
    const cards = activeSession
      ? [
          { label: "状态", value: statusLabel, meta: "Session state" },
          {
            label: "消息",
            value: `${activeSession.messageCount} 条`,
            meta: "Conversation",
          },
          { label: "变更", value: `${diffCount} 个文件`, meta: "Git diff" },
          { label: "航行日志", value: `${logCount} 条`, meta: "Activity" },
        ]
      : [
          { label: "状态", value: "待创建", meta: "Session state" },
          { label: "会话", value: "未创建", meta: "发送首条指令后创建" },
        ];

    return (
      <section className="session-overview-card">
        <div className="section-head section-head-soft">
          <div>
            <h3>{activeSession ? "会话信息" : "新任务"}</h3>
          </div>
        </div>
        <div className="session-overview-grid">
          {cards.map((card) => (
            <article key={card.label} className="session-overview-metric">
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.meta}</small>
            </article>
          ))}
        </div>
        <div className="session-overview-preview">
          <span>最近活动</span>
          <strong>{activeSession?.lastMessagePreview || "暂无预览"}</strong>
        </div>
      </section>
    );
  }

  function renderMissionPaneResizer(
    handle: MissionResizeHandle,
    label: string,
  ) {
    return (
      <button
        type="button"
        className={`mission-pane-resizer mission-pane-resizer-${handle}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        title={label}
        onMouseDown={(event) => startMissionPaneResize(handle, event)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            nudgeMissionPane(handle, -1);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            nudgeMissionPane(handle, 1);
          }
        }}
      />
    );
  }

  function resolveMissionAgentInitials(agentName: string) {
    const words = agentName.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g) ?? [
      agentName,
    ];
    return (
      words
        .slice(0, 2)
        .map((word) => word[0])
        .join("")
        .toUpperCase() || "A"
    );
  }

  function resolveMissionAgentIconUrl(agentName: string) {
    const normalized = agentName.toLowerCase();
    if (normalized.includes("codex") || normalized.includes("openai")) {
      return codexProviderIconUrl;
    }
    if (normalized.includes("claude") || normalized.includes("anthropic")) {
      return claudeProviderIconUrl;
    }
    if (normalized.includes("gemini")) {
      return geminiProviderIconUrl;
    }
    return null;
  }

  function renderMissionAgentIcon(agentName: string) {
    const iconUrl = resolveMissionAgentIconUrl(agentName);
    if (iconUrl) {
      return <img src={iconUrl} alt="" aria-hidden="true" />;
    }
    return (
      <span className="mission-tree-agent-initials">
        {resolveMissionAgentInitials(agentName)}
      </span>
    );
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
      ) ?? missionPanelPages[0];
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
    const overviewWorkspaceName = activeSession?.workspaceName ?? selectedWorkspace?.name ?? "未选择";
    const overviewAgentName = activeSession?.agentName ?? selectedDraftAgent?.name ?? "未选舰员";
    const projectOverviewItems = overviewProject ? [
      `Helm · ${activeMissionHelm?.name ?? overviewProject.helmId ?? "未选择"}`,
      `Project · ${overviewProjectName}`,
      `Workspace · ${overviewWorkspaceName}`,
      `ACP · ${overviewAgentName}`,
      overviewProject.path ? `路径 · ${overviewProject.path}` : "路径 · 等待 Helm 返回",
      `摘要 · ${formatProjectSummaryForDisplay(overviewProject.summary, overviewProjectName)}`,
    ] : [];
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
    const renderProjectFileList = () => {
      if (!activeSession) {
        return <div className="empty-state">选择左侧任务后显示项目文件。</div>;
      }
      if (projectFilesEntry?.loading && !projectFiles.length) {
        return <div className="empty-state">正在加载项目文件...</div>;
      }
      if (!projectFiles.length) {
        return (
          <div className="empty-state">
            {projectFilesEntry?.message || "暂无项目文件"}
          </div>
        );
      }
      if (!visibleProjectFiles.length) {
        return <div className="empty-state">没有匹配的项目文件</div>;
      }
      return (
        <div
          className="mission-project-file-list"
          role="tree"
          aria-label="项目文件列表"
        >
          {visibleProjectFiles.map((file) => {
            const isDirectory = file.kind === "directory";
            const collapsed = collapsedProjectFileDirectories.has(file.path);
            const depth = Math.max(file.path.split("/").length - 1, 0);
            return (
              <button
                key={`${file.kind}:${file.path}`}
                type="button"
                className={`mission-project-file-row mission-project-file-${file.kind}`}
                role="treeitem"
                aria-expanded={isDirectory ? !collapsed : undefined}
                title={file.path}
                style={{ paddingLeft: `${8 + depth * 12}px` }}
                onClick={() => {
                  if (isDirectory) {
                    toggleProjectFileDirectory(file.path);
                  }
                }}
              >
                <span className="mission-project-file-caret">
                  {isDirectory ? (collapsed ? "▸" : "▾") : ""}
                </span>
                <span className="mission-project-file-icon" aria-hidden="true">
                  {isDirectory ? (collapsed ? "📁" : "📂") : "📄"}
                </span>
                <strong>
                  {file.path.split("/").slice(-1)[0] ?? file.path}
                </strong>
              </button>
            );
          })}
        </div>
      );
    };

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
          <>
            {renderSessionOverview(missionDiffCount, missionLogCount)}
            {renderActivityLog(
              activeSession?.id,
              activeToolCalls,
              activeOutputs,
              activeSession ? (messages[activeSession.id] ?? []) : [],
            )}
          </>
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
        className={`card surface-card chat-layout chat-layout-sidebar ${effectiveSidebarCollapsed ? "mission-sidebar-collapsed" : ""} ${effectiveInspectorCollapsed ? "mission-inspector-collapsed" : ""}`.trim()}
        style={missionLayoutStyle}
      >
        <>
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
              !effectiveSidebarCollapsed
                ? renderMissionPaneResizer("sidebar", "调整任务列表宽度")
                : null
            }
          />

          <div
            className={`chat-conversation mission-pane mission-pane-chat ${!activeSession ? "mission-draft-chat" : ""}`.trim()}
            style={missionChatPaneStyle}
          >
            <div
              className="chat-main"
              ref={chatMainRef}
              onScroll={handleChatMainScroll}
            >
              {pairingState !== "paired" ? (
                <div className="note-box compact-note mission-session-feedback">
                  <strong>Helm 未连接</strong>
                  <p>
                    任务页会继续展示本地缓存；连接 Helm
                    后即可刷新项目、任务与文件。
                  </p>
                </div>
              ) : null}
              {activeSession ? (
                <>
                  {renderPlainMessages(
                    activeSessionMessages,
                    activeSession.id,
                    activeSession.agentName,
                  )}
                  {missionActivityLoading ? (
                    <div
                      className="mission-tool-loading"
                      role="status"
                      aria-live="polite"
                    >
                      <span
                        className="mission-tool-loading-dots"
                        aria-hidden="true"
                      >
                        <i />
                        <i />
                        <i />
                      </span>
                      <div>
                        <strong>
                          {pendingToolActivity
                            ? "正在执行工具"
                            : "Agent 正在处理"}
                        </strong>
                        <p className="compact muted">
                          等待 {missionActivityLoading.title} 返回结果…
                        </p>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            {activeSession && pendingPermission ? (
              <section
                className="mission-permission-drawer"
                role="region"
                aria-live="polite"
                aria-label={copy.permissionRequest}
              >
                <div className="mission-permission-copy">
                  <p className="eyebrow">{copy.permissionRequest}</p>
                  <strong>{pendingPermission.command}</strong>
                  <p className="muted compact">{pendingPermission.reason}</p>
                  {technicalPanels.showPermissionWorkspace ? (
                    <p className="subtle compact">
                      {pendingPermission.workspacePath}
                    </p>
                  ) : null}
                </div>
                <div className="permission-actions mission-permission-actions">
                  <button
                    className="primary"
                    type="button"
                    onClick={() => respondToPermission("allow")}
                  >
                    {copy.allowOnce}
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => respondToPermission("deny")}
                  >
                    {copy.deny}
                  </button>
                </div>
              </section>
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
            />
          </div>

          {renderMissionPaneResizer("display", "调整任务展示宽度")}

          {renderMissionDisplayPanel()}

          <MissionInspector
            collapsed={effectiveInspectorCollapsed}
            style={missionInspectorPaneStyle}
            activeSessionPresent={Boolean(activeSession)}
            projectFileCount={projectFiles.length}
            loading={projectFilesEntry?.loading}
            message={projectFilesEntry?.message}
            filter={projectFileFilter}
            projectFileList={renderProjectFileList()}
            resizer={renderMissionPaneResizer("inspector", "调整检视器宽度")}
            onFilterChange={setProjectFileFilter}
            onExpand={() => setMissionInspectorCollapsed(false)}
          />
        </>
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
        setSelectedHelmKey={setSelectedHelmKey}
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
    <main
      className={`shell view-${activeView} theme-${deckPreferences.theme} ${deckPreferences.reduceMotion ? "motion-reduced" : ""}`}
    >
      <TopNav
        activeView={activeView}
        onNavigate={navigateToView}
        connection={connection}
        language={deckPreferences.language}
      />
      <div className="page-content stack-gap">
        {activeView === "overview" && renderOverview()}
        {activeView === "sessions" && renderSessions()}
        {activeView === "agents" && renderAgents()}
        {activeView === "settings" && renderSettings()}
      </div>
      {pendingSessionCleanup ? (
        <div className="fleet-modal-backdrop" role="presentation">
          <section
            className="card surface-card fleet-delete-helm-modal"
            role="dialog"
            aria-modal="true"
            aria-label="确认删除会话"
          >
            <div className="fleet-dialog-head fleet-dialog-head-simple">
              <h3>确认删除会话？</h3>
              <button
                className="secondary fleet-dialog-close"
                type="button"
                onClick={() => setPendingSessionCleanup(null)}
              >
                关闭
              </button>
            </div>
            <div className="fleet-delete-confirm-body">
              <p>此操作将清理该会话的本地记录并尝试通知 Agent 删除远端会话。</p>
              <div className="fleet-delete-target">
                <strong>
                  {resolveDisplaySessionTitle(pendingSessionCleanup)}
                </strong>
                <span>{pendingSessionCleanup.agentName}</span>
              </div>
            </div>
            <div className="section-actions fleet-delete-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => setPendingSessionCleanup(null)}
              >
                取消
              </button>
              <button
                className="secondary helm-destroy-button"
                type="button"
                onClick={() => {
                  cleanupSession(pendingSessionCleanup.id);
                  setPendingSessionCleanup(null);
                }}
              >
                确认删除
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function resolveViewFromPath(pathname: string): AppView {
  const normalized = pathname.replace(/\/+$/g, "") || "/";
  if (normalized === "/sessions") {
    return "sessions";
  }
  const matched = (Object.entries(VIEW_PATHS) as Array<[AppView, string]>).find(
    ([, path]) => path === normalized,
  );
  return matched?.[0] ?? "overview";
}


function isSessionExecutionPending(status: SessionStatus) {
  return (
    status === "starting" ||
    status === "running" ||
    status === "waiting_for_permission"
  );
}



function formatResumeLabel(resume: SessionSummary["resume"], locale: Locale) {
  if (!resume) {
    return "恢复状态待检查";
  }

  switch (resume.state) {
    case "resume-available":
      return "可恢复";
    case "resume-unavailable":
      return "暂不可恢复";
    case "history-only":
    default:
      return "仅历史记录";
  }
}

function readMissionPanelPages(): MissionPanelPage[] {
  try {
    const raw = window.localStorage.getItem(MISSION_PANEL_PAGES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(isRecord).map((page, index) => ({
          id:
            typeof page.id === "string" && page.id
              ? page.id
              : `custom-${index + 1}`,
          title:
            typeof page.title === "string" && page.title
              ? page.title
              : `展示页 ${index + 1}`,
        }))
      : [];
  } catch {
    return [];
  }
}

function moveMissionPanelPageInList(
  pages: MissionPanelPage[],
  pageId: string,
  direction: -1 | 1,
) {
  const index = pages.findIndex((page) => page.id === pageId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= pages.length) return pages;
  const next = [...pages];
  const [page] = next.splice(index, 1);
  next.splice(nextIndex, 0, page);
  return next;
}

function reorderMissionPanelPage(
  pages: MissionPanelPage[],
  sourceId: string,
  targetId: string,
) {
  const sourceIndex = pages.findIndex((page) => page.id === sourceId);
  const targetIndex = pages.findIndex((page) => page.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return pages;
  const next = [...pages];
  const [page] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, page);
  return next;
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "custom-agent"
  );
}

function createProjectId(projects: ProjectSummary[]) {
  const usedIds = new Set(projects.map((project) => project.id));
  const maxNumericId = projects.reduce((max, project) => {
    const match = /^project-(\d+)$/u.exec(project.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  let next = Math.max(maxNumericId, projects.length) + 1;
  while (usedIds.has(`project-${next}`)) {
    next += 1;
  }
  return `project-${next}`;
}

function resolveProjectWorkspaceLabel(
  project: ProjectSummary,
  workspaces: WorkspaceSummary[],
) {
  const workspaceId = project.defaultWorkspaceId ?? project.workspaceIds?.[0];
  const workspace = workspaceId
    ? workspaces.find((item) => item.id === workspaceId)
    : undefined;
  return workspace?.name ?? project.gitCurrentBranch ?? workspaceId ?? "-";
}

function resolveProjectDisplayId(
  project: ProjectSummary,
  projects: ProjectSummary[],
) {
  const numericId = /^project-\d+$/u.test(project.id) ? project.id : null;
  if (numericId) {
    return numericId;
  }
  const index = projects.findIndex((item) => item.id === project.id);
  return `project-${index >= 0 ? index + 1 : projects.length + 1}`;
}

function splitArgs(value: string) {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveAgentModeOptions(configOptions: SessionConfigOption[] = []) {
  const option = configOptions.find(
    (item) => item.category?.toLowerCase() === "mode",
  );
  return (option?.options ?? [])
    .map((item) => ({
      value: typeof item.value === "string" ? item.value : "",
      label: item.label ?? item.name ?? String(item.value ?? ""),
    }))
    .filter((item) => item.value.trim().length > 0);
}

function resolveCurrentAgentMode(
  currentAgentMode: string | undefined,
  configOptions: SessionConfigOption[] = [],
  probedAgentMode?: string,
) {
  const option = configOptions.find(
    (item) => item.category?.toLowerCase() === "mode",
  );
  const modeOptions = resolveAgentModeOptions(configOptions);
  const validModes = new Set(modeOptions.map((item) => item.value));
  const currentValue =
    typeof option?.currentValue === "string" ? option.currentValue : undefined;
  const selectedValue =
    typeof option?.selectedValue === "string"
      ? option.selectedValue
      : undefined;
  const value = typeof option?.value === "string" ? option.value : undefined;
  const candidates = [
    currentAgentMode,
    currentValue,
    selectedValue,
    value,
    probedAgentMode,
  ]
    .map((candidate) => candidate?.trim())
    .filter((candidate): candidate is string => Boolean(candidate));

  if (validModes.size) {
    return candidates.find((candidate) => validModes.has(candidate));
  }

  return currentValue || selectedValue || value || undefined;
}

function resolveModelOptions(
  currentModel?: string,
  configOptions: SessionConfigOption[] = [],
  nativeOptions: AcpModelOption[] = [],
) {
  return resolveModelOptionsFromConfig(
    currentModel,
    configOptions,
    nativeOptions,
  );
}

function resolveReasoningOptions(configOptions: SessionConfigOption[] = []) {
  const option = configOptions.find((item) =>
    ["thought_level", "reasoning", "reasoning_effort"].includes(
      item.category?.toLowerCase() ?? "",
    ),
  );
  const values = (option?.options ?? [])
    .map((item) => item.value)
    .filter(
      (value): value is SessionReasoningEffort =>
        typeof value === "string" &&
        REASONING_OPTIONS.some((candidate) => candidate.value === value),
    );
  return Array.from(new Set(values));
}

function resolveReasoningLabel(value: SessionReasoningEffort) {
  return (
    REASONING_OPTIONS.find((option) => option.value === value)?.label ?? value
  );
}

function splitModelReasoning(value: string | undefined) {
  const raw = value?.trim() ?? "";
  const index = raw.lastIndexOf("/");
  if (index <= 0) {
    return {
      model: raw,
      reasoning: undefined as SessionReasoningEffort | undefined,
    };
  }
  const suffix = raw.slice(index + 1).toLowerCase();
  const reasoning = REASONING_OPTIONS.find(
    (option) => option.value === suffix,
  )?.value;
  return reasoning
    ? { model: raw.slice(0, index), reasoning }
    : {
        model: raw,
        reasoning: undefined as SessionReasoningEffort | undefined,
      };
}

function resolveBaseModelOptions(modelOptions: string[]) {
  return Array.from(
    new Set(
      modelOptions
        .map((model) => splitModelReasoning(model).model)
        .filter(Boolean),
    ),
  );
}

function resolveReasoningOptionsForModel(
  model: string,
  modelOptions: string[],
  configOptions: SessionConfigOption[] = [],
) {
  const fromModel = modelOptions
    .map((option) => splitModelReasoning(option))
    .filter((option) => option.model === model && option.reasoning)
    .map((option) => option.reasoning as SessionReasoningEffort);
  if (fromModel.length) {
    return Array.from(new Set(fromModel));
  }

  const fromConfig = resolveReasoningOptions(configOptions);
  return fromConfig.length
    ? fromConfig
    : model.trim()
      ? REASONING_OPTIONS.map((option) => option.value)
      : [];
}

function resolveCombinedModelValue(
  model: string,
  reasoning: SessionReasoningEffort | undefined,
  modelOptions: string[],
) {
  if (reasoning) {
    const combined = modelOptions.find((option) => {
      const parsed = splitModelReasoning(option);
      return parsed.model === model && parsed.reasoning === reasoning;
    });
    if (combined) {
      return combined;
    }
  }

  return (
    modelOptions.find(
      (option) => splitModelReasoning(option).model === model,
    ) ?? model
  );
}

function resolveDraftConfigOptions(
  activeSession: SessionSummary | null,
  sessions: SessionSummary[],
  sessionConfigOptions: Record<string, SessionConfigOption[]>,
  selectedAgentId?: string | null,
) {
  if (activeSession) {
    return sessionConfigOptions[activeSession.id] ?? [];
  }

  const cachedSession = sessions.find(
    (session) =>
      session.agentId === selectedAgentId &&
      (sessionConfigOptions[session.id]?.length ?? 0) > 0,
  );
  return cachedSession ? (sessionConfigOptions[cachedSession.id] ?? []) : [];
}

function normalizeModelSelection(model: string | undefined) {
  return model && model !== "provider-default" ? model : undefined;
}

function defaultAgentId(agents: AcpAgentProvider[]) {
  return (
    agents.find((agent) => agent.id === "codex")?.id ?? agents[0]?.id ?? null
  );
}

function formatRelativeTime(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  const diffMinutes = Math.max(1, Math.round((Date.now() - parsed) / 60000));
  if (diffMinutes < 60) {
    return `${diffMinutes}m`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h`;
  }

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d`;
}

function resolveSessionConfigHint(
  activeSession: SessionSummary | null,
  agents: AcpAgentProvider[],
  draftAgentId?: string | null,
) {
  const provider = agents.find(
    (agent) => agent.id === (activeSession?.agentId ?? draftAgentId),
  );
  const support = resolveSessionConfigSupport(provider);

  if (support.model === "startup" && support.reasoningEffort === "startup") {
    return activeSession
      ? " 该 provider 会在下次 runtime 启动/恢复时应用模型与推理 覆盖。"
      : " 该 provider 的新会话会直接写入 模型 / 推理。";
  }

  if (support.model === "startup" && support.reasoningEffort === "none") {
    return activeSession
      ? " 该 provider 会在下次 runtime 启动/恢复时应用模型覆盖；若当前 provider/model 支持 reasoningEffort，Tiller 也会通过 inline config 尝试带入，否则仍只保存在 session 配置中。模型请使用 provider/model 形式，例如 openai/gpt-5.4。"
      : " 该 provider 的新会话支持写入模型；若当前 provider/model 支持 reasoningEffort，Tiller 也会通过 inline config 尝试带入，否则仅保存在 session 配置中。模型请使用 provider/model 形式，例如 openai/gpt-5.4。";
  }

  return activeSession
    ? " 当前 provider 暂未暴露通用的运行时 模型/推理热切换接口，Tiller 会先保存为 session 配置。"
    : " 新会话会尽量把这些配置带入 provider。";
}

function resolveModelInputPlaceholder(
  activeSession: SessionSummary | null,
  agents: AcpAgentProvider[],
  draftAgentId?: string | null,
) {
  const provider = agents.find(
    (agent) => agent.id === (activeSession?.agentId ?? draftAgentId),
  );
  const support = resolveSessionConfigSupport(provider);
  return support.modelFormat === "provider/model"
    ? "provider-default 或 openai/gpt-5.4"
    : "provider-default 或 gpt-5.4";
}

function summarizeSessionContext(
  session: SessionSummary | null,
  sessionMessages: AgentMessage[],
) {
  if (!session) {
    return "暂无活跃任务；请先增强新任务草稿。";
  }
  const recentMessages = sessionMessages
    .slice(-4)
    .map(
      (message) =>
        `${message.role}: ${message.text.replace(/\s+/g, " ").trim().slice(0, 180)}`,
    );
  return [
    `Session ${session.id} is ${session.status}; messages: ${session.messageCount}.`,
    session.lastMessagePreview
      ? `最近意图/结果：${session.lastMessagePreview}`
      : "",
    recentMessages.length
      ? ["最近消息：", ...recentMessages.map((message) => `- ${message}`)].join(
          "\n",
        )
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function resolveHelmConnectionState(
  helm: { key: string; isCurrent: boolean },
  currentHelmKey: string,
  globalConnection: ConnectionState,
  helmConnectionStates: Record<string, ConnectionState>,
) {
  return (
    helmConnectionStates[helm.key] ??
    (helm.key === currentHelmKey ? globalConnection : "disconnected")
  );
}

function dedupeHelmCards<T extends { key: string; isCurrent: boolean }>(
  cards: T[],
) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const card of cards) {
    if (seen.has(card.key)) {
      continue;
    }
    seen.add(card.key);
    result.push(card);
  }
  return result;
}


function formatSessionTime(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDeviceTime(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString(deckLocale(), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function deckLocale() {
  return document.documentElement.lang || "zh-CN";
}
