import { useEffect, useMemo, useRef, useState } from "react";
import "highlight.js/styles/github-dark.css";
import type { AgentToolCall } from "@tiller/shared";
import {
  agentModelOptionsKey,
  readAgentModelOptionsCache,
  useAppActions,
} from "../../features/agents";
import { getOrCreateDeviceId } from "../../features/auth";
import {
  daemonProfileKey,
  dispatchWithTrace,
  resolveDefaultHelmEndpoint,
  type DeckRpcClient,
  useAppControllers,
  useHelmConnection,
} from "../../features/helm-connection";
import {
  DEFAULT_ACTIVITY_PAGE_LIMIT,
  DEFAULT_MESSAGE_PAGE_LIMIT,
  DEFAULT_SESSION_PAGE_LIMIT,
  resolveCombinedModelValue,
  resolveReasoningLabel,
  resolveReasoningOptionsForModel,
  createMissionVisualFixture,
  shouldUseMissionVisualFixture,
  MissionAgentIcon,
  SessionCleanupConfirmDialog,
  SessionHistoryReimportConfirmDialog,
  useHistoryPagination,
  useMissionEffects,
  useMissionLayout,
  useMissionViewModel,
  usePanelPages,
  useSelection,
  useSessionTitles,
  useSlashCommands,
} from "../../features/mission";
import { ApprovalToastStackContainer } from "../../features/approvals";
import { useCodeActions } from "../../features/pairing";
import {
  useDeckPreferenceActions,
  usePreferencesEffects,
} from "../../features/preferences";
import {
  usePromptEnhanceAction,
  usePromptEnhancerSettings,
} from "../../features/prompt-enhancer";
import type { LoggingLevel, LoggingSettings } from "../../features/settings";
import {
  DECK_DEVICE_NAME,
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
  IS_EMBEDDED_HELM_DECK,
} from "../../shared/config/deck-runtime";
import { RadialMenu, type RadialMenuItem } from "../../shared/ui";
import { UI_COPY, type Locale } from "../../shared/utils/copy";
import { formatRelativeTime } from "../../shared/utils/format-time";
import {
  buildAppLayoutContext,
  buildAppRouteContext,
  buildMissionPanelContext,
  resolveShellClassName,
} from "../composition/bindings";
import { createSessionDraftPreferencesAction } from "../composition/session-draft-preferences";
import { AppRoutes } from "../routing/route-content";
import { useRouteView } from "../routing/route-view";
import {
  getDeckSessionMessages,
  useActiveSessionMessages,
} from "../state/active-session-messages";
import { useDeckData } from "../state/deck-data";
import { useAppRuntimeState } from "../state/runtime-state";

const MOBILE_ADDRESSBAR_SCROLL_OFFSET = 80;
const LOGGING_LEVEL_VALUES = new Set<LoggingLevel>(["trace", "debug", "info", "warn", "error", "fatal"]);

type LocalLoggingSettings = {
  helmKey: string;
  settings: LoggingSettings;
};

const V6_RADIAL_ITEMS: RadialMenuItem[] = [
  { id: "overview", icon: "home", label: "首页" },
  { id: "dashboard", icon: "board", label: "Dashboard" },
  { id: "sessions", icon: "mission", label: "工作台" },
  { id: "agents", icon: "fleet", label: "舰队" },
  { id: "settings", icon: "settings", label: "设置" },
];

function tryCollapseMobileAddressBar() {
  if (!window.matchMedia("(max-width: 1080px)").matches) {
    return;
  }
  if (window.scrollY >= MOBILE_ADDRESSBAR_SCROLL_OFFSET / 2) {
    return;
  }
  if (document.documentElement.scrollHeight <= window.innerHeight + 24) {
    return;
  }

  window.scrollTo({ top: MOBILE_ADDRESSBAR_SCROLL_OFFSET, behavior: "smooth" });
}

function isLoggingLevel(value: unknown): value is LoggingLevel {
  return typeof value === "string" && LOGGING_LEVEL_VALUES.has(value as LoggingLevel);
}

function normalizeLoggingSettings(result: unknown): LoggingSettings | null {
  const logging = (result as { logging?: Partial<LoggingSettings> } | null)?.logging;
  if (!logging || !isLoggingLevel(logging.level)) {
    return null;
  }
  return {
    level: logging.level,
    format: typeof logging.format === "string" ? logging.format : "pretty",
    acpTrace: typeof logging.acpTrace === "string" ? logging.acpTrace : "summary",
  };
}

function formatRpcError(error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes("Unknown method: logging/")) {
      return "当前 Helm 需重启后才支持日志设置";
    }
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      if (maybeMessage.includes("Unknown method: logging/")) {
        return "当前 Helm 需重启后才支持日志设置";
      }
      return maybeMessage;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

export function App() {
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
  const runtimeState = useAppRuntimeState(missionVisualFixture);
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
  const helmConnection = useHelmConnection({
    defaultHelmEndpoint,
    fixtureConnected: Boolean(missionVisualFixture),
  });
  const copy = UI_COPY[locale];
  const deckData = useDeckData(missionVisualFixture);
  const activeSessionMessages = useActiveSessionMessages(
    deckData.activeSessionId,
    missionVisualFixture?.messages,
  );

  function dispatch(
    client: DeckRpcClient,
    method: string,
    params: unknown,
    options?: { onResult?: (method: string, result: unknown) => void },
  ) {
    return dispatchWithTrace(
      client,
      method,
      params,
      helmConnection.setDebugTrace,
      (resultMethod, result) => {
        options?.onResult?.(resultMethod, result);
        controllers.handleRpcResult?.(resultMethod, result);
      },
    );
  }

  const codeActions = useCodeActions({
    rpcClientRef: runtimeState.rpcClientRef,
    pairingCodeInput: helmConnection.pairingCodeInput,
    setPairingCodeInput: helmConnection.setPairingCodeInput,
    pairInputRefs: runtimeState.pairInputRefs,
    pairingState: helmConnection.pairingState,
    setPairingState: helmConnection.setPairingState,
    setPairingFeedback: helmConnection.setPairingFeedback,
    setDebugTrace: helmConnection.setDebugTrace,
    dispatch,
    deckDeviceId,
    deckDeviceName: DECK_DEVICE_NAME,
  });

  const toolCallsRef = useRef<Record<string, AgentToolCall[]>>(
    missionVisualFixture?.toolCalls ?? {},
  );
  const agentModelOptionsHydratedRef = useRef(false);
  const lastFilesScopeKeyRef = useRef<string | null>(null);
  const titleActions = useSessionTitles({
    client: runtimeState.rpcClientRef.current,
    getSessionMessages: (sessionId) =>
      missionVisualFixture?.messages?.[sessionId] ?? getDeckSessionMessages(sessionId),
    sessionTitles: deckData.sessionTitles,
    setSessionTitles: deckData.setSessionTitles,
    promptEnhancerLlm: deckData.deckPreferences.promptEnhancer.llm,
  });
  const promptEnhancerSettings = usePromptEnhancerSettings({
    preferences: deckData.deckPreferences,
    pickerRef: runtimeState.promptModelPickerRef,
    updatePreferences: deckData.updatePreferences,
  });
  const panelPages = usePanelPages();
  const route = useRouteView();
  const [localLoggingSettings, setLocalLoggingSettings] = useState<LocalLoggingSettings | null>(null);
  const [loggingStatus, setLoggingStatus] = useState("");

  usePreferencesEffects();
  useEffect(() => {
    if (
      agentModelOptionsHydratedRef.current ||
      Object.keys(deckData.agentModelOptions).length > 0
    ) {
      return;
    }
    agentModelOptionsHydratedRef.current = true;
    const cachedOptions = readAgentModelOptionsCache();
    if (Object.keys(cachedOptions).length > 0) {
      deckData.setAgentModelOptions(cachedOptions);
    }
  }, [deckData.agentModelOptions, deckData.setAgentModelOptions]);

  function requestChatScrollToBottom(sessionId: string | null) {
    runtimeState.pendingSessionScrollToBottomRef.current = sessionId;
    runtimeState.stickChatToBottomRef.current = true;
    runtimeState.setSessionOpenScrollTick((current: number) => current + 1);
  }

  async function refreshLoggingSettings() {
    const target = resolveLoggingTarget();
    if (!target) {
      setLoggingStatus("Helm 未连接");
      return;
    }
    setLoggingStatus("正在读取日志级别...");
    try {
      const result = await target.client.request("logging/get", {});
      const next = normalizeLoggingSettings(result);
      if (!next) {
        setLoggingStatus("读取失败：响应格式不正确");
        return;
      }
      setLocalLoggingSettings({ helmKey: target.helmKey, settings: next });
      deckData.applyHelmInventory(target.helmKey, { logging: next });
      setLoggingStatus("");
    } catch (error) {
      setLoggingStatus(`读取失败：${formatRpcError(error)}`);
    }
  }

  async function saveLoggingLevel(level: LoggingLevel) {
    const target = resolveLoggingTarget();
    if (!target) {
      setLoggingStatus("Helm 未连接");
      return;
    }
    setLoggingStatus(`正在保存日志级别：${level}...`);
    try {
      const result = await target.client.request("logging/save", {
        logging: { level },
      });
      const next = normalizeLoggingSettings(result);
      if (!next) {
        setLoggingStatus("保存失败：响应格式不正确");
        return;
      }
      setLocalLoggingSettings({ helmKey: target.helmKey, settings: next });
      deckData.applyHelmInventory(target.helmKey, { logging: next });
      setLoggingStatus(`已保存并生效：${next.level}`);
    } catch (error) {
      setLoggingStatus(`保存失败：${formatRpcError(error)}`);
    }
  }

  function resolveCurrentHelmKey() {
    return daemonProfileKey(
      helmConnection.daemonHost.trim() || DEFAULT_DAEMON_HOST,
      helmConnection.daemonPort.trim() || DEFAULT_DAEMON_PORT,
    );
  }

  function resolveCandidateHelmIds() {
    return Array.from(new Set([
      deckData.selectedHelmKey,
      runtimeState.selectedMissionHelmId,
      runtimeState.primaryHelmKeyRef.current,
      resolveCurrentHelmKey(),
    ].filter((helmId): helmId is string => Boolean(helmId))));
  }

  function resolveLoggingTarget() {
    const candidateHelmIds = resolveCandidateHelmIds();
    for (const helmId of candidateHelmIds) {
      const helmClient = runtimeState.helmRpcClientRefs.current.get(helmId);
      if (helmClient?.socket.readyState === WebSocket.OPEN) {
        return { client: helmClient, helmKey: helmId };
      }
    }
    const directClient = runtimeState.rpcClientRef.current;
    if (directClient?.socket.readyState === WebSocket.OPEN) {
      return {
        client: directClient,
        helmKey: runtimeState.primaryHelmKeyRef.current ?? resolveCurrentHelmKey(),
      };
    }
    for (const [helmKey, client] of runtimeState.helmRpcClientRefs.current) {
      if (client.socket.readyState === WebSocket.OPEN) {
        return { client, helmKey };
      }
    }
    return null;
  }

  function resolveLoggingClient() {
    return resolveLoggingTarget()?.client ?? null;
  }

  function resolveSyncedLoggingSettings() {
    for (const helmId of resolveCandidateHelmIds()) {
      const logging = deckData.helmInventories[helmId]?.logging;
      const normalized = normalizeLoggingSettings({ logging });
      if (normalized) {
        return normalized;
      }
    }
    for (const inventory of Object.values(deckData.helmInventories)) {
      const normalized = normalizeLoggingSettings({ logging: inventory.logging });
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  function resolveLocalLoggingSettings() {
    if (!localLoggingSettings) {
      return null;
    }
    return resolveCandidateHelmIds().includes(localLoggingSettings.helmKey)
      ? localLoggingSettings.settings
      : null;
  }

  const selection = useSelection({
    projects: deckData.projects,
    agents: deckData.agents,
    sessions: deckData.sessions,
    requestChatScrollToBottom,
    setSelectedMissionHelmId: runtimeState.setSelectedMissionHelmId,
    setExpandedMissionHelmIds: runtimeState.setExpandedMissionHelmIds,
    setExpandedMissionProjectIds: runtimeState.setExpandedMissionProjectIds,
    setSelectedProjectId: runtimeState.setSelectedProjectId,
    setSelectedCwd: runtimeState.setSelectedCwd,
    setSelectedAgentId: runtimeState.setSelectedAgentId,
    setSelectedModel: runtimeState.setSelectedModel,
    setActiveSessionId: deckData.setActiveSessionId,
    setWorktreePickerOpen: runtimeState.setWorktreePickerOpen,
    setAgentPickerOpen: runtimeState.setAgentPickerOpen,
  });

  const missionView = useMissionViewModel({
    runtimeState,
    deckData,
    activeSessionMessages,
    helmConnection,
    copy,
    locale,
  });
  const layout = useMissionLayout({
    activeView: route.activeView,
    hasActiveSession: Boolean(missionView.activeSession),
  });
  const layoutContext = buildAppLayoutContext(layout);
  const panelContext = buildMissionPanelContext(panelPages);

  const updateSessionDraftPreferences = createSessionDraftPreferencesAction({
    runtimeState,
    deckData,
    missionView,
    dispatch,
  });

  const agentLocked = Boolean(
    missionView.activeSession?.runtimeSessionId ??
    missionView.activeSession?.resume?.runtimeSessionId,
  );
  const appActionsRef = useRef<any>({});
  const controllers = useAppControllers({
    runtimeState,
    deckData,
    missionView,
    helmConnection,
    route,
    titleActions,
    toolCallsRef,
    lastFilesScopeKeyRef,
    appActionsRef,
    dispatch,
    copy,
    deckDeviceId,
  });
  const history = useHistoryPagination({
    activeSessionId: deckData.activeSessionId,
    activityHistoryState: deckData.activityHistoryState,
    chatMainRef: runtimeState.chatMainRef,
    dispatch,
    messageHistoryState: deckData.messageHistoryState,
    sessionHistoryState: deckData.sessionHistoryState,
    setActivityHistoryState: deckData.setActivityHistoryState,
    setMessageHistoryState: deckData.setMessageHistoryState,
    setSessionHistoryState: deckData.setSessionHistoryState,
    rpcClientRef: runtimeState.rpcClientRef,
    stickChatToBottomRef: runtimeState.stickChatToBottomRef,
    sessionPageLimit: DEFAULT_SESSION_PAGE_LIMIT,
    messagePageLimit: DEFAULT_MESSAGE_PAGE_LIMIT,
    activityPageLimit: DEFAULT_ACTIVITY_PAGE_LIMIT,
  });
  const preferenceActions = useDeckPreferenceActions({
    deckPreferences: deckData.deckPreferences,
    updatePreferences: deckData.updatePreferences,
  });
  const enhancePromptDraft = usePromptEnhanceAction({
    prompt: runtimeState.prompt,
    setPrompt: runtimeState.setPrompt,
    promptEnhancer: deckData.deckPreferences.promptEnhancer,
    setPromptEnhancerBusy: promptEnhancerSettings.setBusy,
    setPromptEnhancerStatus: promptEnhancerSettings.setStatus,
    filteredWorktrees: missionView.filteredWorktrees,
    selectedCwd: runtimeState.selectedCwd,
    activeSession: missionView.activeSession,
    activeSessionProject: missionView.activeSessionProject,
    draftProject: missionView.draftProject,
    activeSessionMessages: missionView.activeSessionMessages,
  });
  useMissionEffects({
    runtimeState,
    deckData,
    missionView,
    helmConnection,
    controllers,
    history,
    route,
    lastFilesScopeKeyRef,
    missionVisualMode,
    activeProfileId: `${helmConnection.daemonHost.trim() || DEFAULT_DAEMON_HOST}:${helmConnection.daemonPort.trim() || DEFAULT_DAEMON_PORT}`,
    requestChatScrollToBottom,
    dispatch,
  });
  const appActions = useAppActions({
    runtimeState,
    deckData,
    helmConnection,
    controllers,
    copy,
    deckDeviceId,
    lastFilesScopeKeyRef,
  });
  appActionsRef.current = appActions;
  const activeSessionSlashCommands = missionView.activeSession?.availableCommands ?? [];
  const sessionAvailableCommandsForComposer = useMemo(
    () =>
      missionView.activeSession && activeSessionSlashCommands.length
        ? {
            ...deckData.sessionAvailableCommands,
            [missionView.activeSession.id]: activeSessionSlashCommands,
          }
        : deckData.sessionAvailableCommands,
    [deckData.sessionAvailableCommands, missionView.activeSession, activeSessionSlashCommands],
  );
  const slash = useSlashCommands({
    prompt: runtimeState.prompt,
    setPrompt: runtimeState.setPrompt,
    activeSessionId: deckData.activeSessionId,
    activeSessionAgentId: missionView.activeSession?.agentId ?? runtimeState.selectedAgentId,
    sessionAvailableCommands: sessionAvailableCommandsForComposer,
    agentAvailableCommands: deckData.agentAvailableCommands,
    refreshAgentAvailableCommands: deckData.refreshAgentAvailableCommands,
    promptRef: runtimeState.missionPromptRef,
    onFallbackKeyDown: controllers.submitPromptFromKeyboard,
  });

  function toggleProjectFileDirectory(path: string) {
    runtimeState.setCollapsedProjectFileDirectories((current: Set<string>) => {
      const next = new Set(current);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }
  function openDiffDetail(path: string) {
    panelPages.openDiffFile(path);
    layout.setMissionDisplayCollapsed(false);
    layout.setSelectedMissionMobilePane("display");
  }
  function toggleExpandedMessage(messageId: string) {
    runtimeState.setExpandedMessageIds((current: Set<string>) => {
      const next = new Set(current);
      next.has(messageId) ? next.delete(messageId) : next.add(messageId);
      return next;
    });
  }
  function renderMissionAgentIcon(agentName: string) {
    return <MissionAgentIcon agentName={agentName} />;
  }

  const activeProfileId = `${helmConnection.daemonHost.trim() || DEFAULT_DAEMON_HOST}:${helmConnection.daemonPort.trim() || DEFAULT_DAEMON_PORT}`;
  const currentLoggingSettings = resolveLocalLoggingSettings();
  const syncedLoggingSettings = resolveSyncedLoggingSettings();
  const effectiveLoggingSettings = currentLoggingSettings ?? syncedLoggingSettings;
  const loggingClientAvailable = Boolean(resolveLoggingClient());
  const loggingConnectionKnownConnected =
    helmConnection.connection === "connected" ||
    Object.values(deckData.helmConnectionStates).includes("connected");
  const shellClassName = resolveShellClassName(
    route.activeView,
    deckData.deckPreferences.theme,
    deckData.deckPreferences.reduceMotion,
  );
  const deckTheme = deckData.deckPreferences.theme;

  useEffect(() => {
    document.body.dataset.theme = deckTheme;
  }, [deckTheme]);

  useEffect(() => {
    if (route.activeView !== "settings") {
      return;
    }
    void refreshLoggingSettings();
  }, [
    route.activeView,
    helmConnection.connection,
    helmConnection.daemonHost,
    helmConnection.daemonPort,
    deckData.selectedHelmKey,
    deckData.helmConnectionStates,
  ]);

  // 离开设置页面时清空 promptEnhancer 状态消息
  useEffect(() => {
    if (route.activeView === "settings") {
      return;
    }
    // 当从设置页面切换到其他页面时，清空状态消息
    promptEnhancerSettings.setStatus("");
  }, [route.activeView, promptEnhancerSettings]);

  const appShell = (
    <main className={shellClassName}>
      <AppRoutes
        ctx={buildAppRouteContext({
          runtimeState,
          deckData,
          missionView,
          titleActions,
          formatRelativeTime,
          resolveCombinedModelValue,
          resolveReasoningOptionsForModel,
          resolveReasoningLabel,
          appActions,
          controllers,
          panelPages: panelContext,
          selection,
          layout: layoutContext,
          history,
          preferenceActions,
          promptEnhancerSettings,
          slash,
          codeActions,
          helmConnection,
          route,
          activeProfileId,
          copy,
          agentLocked,
          enhancePromptDraft,
          updateSessionDraftPreferences,
          toggleProjectFileDirectory,
          openDiffDetail,
          toggleExpandedMessage,
          renderMissionAgentIcon,
          loggingSettings: effectiveLoggingSettings,
          loggingStatus,
          loggingClientAvailable,
          loggingConnectionKnownConnected,
          refreshLoggingSettings,
          saveLoggingLevel,
        })}
      />
      <SessionCleanupConfirmDialog
        session={runtimeState.pendingSessionCleanup}
        resolveSessionTitle={titleActions.resolveDisplaySessionTitle}
        onCancel={() => runtimeState.setPendingSessionCleanup(null)}
        onConfirm={(sessionId) => {
          controllers.cleanupSession(sessionId);
          runtimeState.setPendingSessionCleanup(null);
        }}
      />
      <SessionHistoryReimportConfirmDialog
        session={runtimeState.pendingSessionHistoryReimport}
        resolveSessionTitle={titleActions.resolveDisplaySessionTitle}
        onCancel={() => runtimeState.setPendingSessionHistoryReimport(null)}
        onConfirm={(sessionId) => {
          controllers.reimportSessionHistory(sessionId);
          runtimeState.setPendingSessionHistoryReimport(null);
        }}
      />
      <ApprovalToastStackContainer
        onRespond={(approvalRequestId, decision) =>
          controllers.respondToPermission(approvalRequestId, decision)
        }
      />
      <RadialMenu
        activeView={route.activeView}
        items={V6_RADIAL_ITEMS}
        onNavigate={route.navigateToView}
        enabled={true}
      />
    </main>
  );

  return (
    <div className="mobile-addressbar-scroll-shell">
      {appShell}
    </div>
  );
}
