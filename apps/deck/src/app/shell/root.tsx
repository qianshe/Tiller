import { useEffect, useMemo, useRef, useState } from "react";
import "highlight.js/styles/github-dark.css";
import type { AgentToolCall, SessionSummary } from "@tiller/shared";
import {
  agentModelOptionsKey,
  readAgentModelOptionsCache,
  useAppActions,
} from "../../features/agents";
import {
  DashboardTaskLaunchError,
  finalizeDashboardTaskLaunch,
  launchDashboardTask,
  type DashboardQuickCreateRequest,
  type DashboardSection,
} from "../../features/dashboard";
import { getOrCreateDeviceId } from "../../features/auth";
import {
  daemonProfileKey,
  dispatchWithTrace,
  resolveDefaultHelmEndpoint,
  createHelmUpdateActions,
  HelmUpdateBlockingOverlay,
  isHelmUpdateBlocking,
  resolveSessionRpcTarget,
  type DeckRpcClient,
  useAppControllers,
  useHelmConnection,
  useHelmUpdateLifecycle,
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
  useHistoryPagination,
  useMissionEffects,
  useMissionLayout,
  useMissionViewModel,
  usePanelPages,
  useSelection,
  useSessionTitles,
  useSlashCommands,
} from "../../features/mission";
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
import { RouteErrorBoundary, formatRouteCrashNotification } from "./route-error-boundary";
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
  { id: "dashboard", icon: "board", label: "概览" },
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
    options?: {
      onResult?: (method: string, result: unknown) => void;
      sourceHelmKey?: string;
    },
  ) {
    return dispatchWithTrace(
      client,
      method,
      params,
      helmConnection.setDebugTrace,
      (resultMethod, result) => {
        options?.onResult?.(resultMethod, result);
        controllers.handleRpcResult?.(resultMethod, result, options?.sourceHelmKey);
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
  const [dashboardSection, setDashboardSection] = useState<DashboardSection>("overview");
  const [localLoggingSettings, setLocalLoggingSettings] = useState<LocalLoggingSettings | null>(null);
  const [loggingStatus, setLoggingStatus] = useState("");
  const acknowledgeCompletionRequestsRef = useRef(new Map<string, Promise<void>>());

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

  function acknowledgeSessionCompletion(session: SessionSummary) {
    if (!session.lastCompletedAt) {
      return;
    }
    const currentHelmKey = resolveCurrentHelmKey();
    const completionKey = `${session.id}\0${session.lastCompletedAt}`;
    if (acknowledgeCompletionRequestsRef.current.has(completionKey)) {
      return;
    }
    const target = resolveSessionRpcTarget({
      session,
      helms: missionView.configuredHelms,
      currentHelmKey: runtimeState.primaryHelmKeyRef.current ?? currentHelmKey,
      primaryClient: runtimeState.rpcClientRef.current,
      clients: runtimeState.helmRpcClientRefs.current,
      primarySessionIds: new Set(deckData.sessions.map((item) => item.id)),
    });
    if (!target) {
      deckData.addNotification({
        kind: "warning",
        source: "session",
        message: "会话完成状态同步失败：未连接到目标 Helm。",
        sessionId: session.id,
        details: {
          phase: "session/acknowledge_completion",
          helmKey: session.helmId,
        },
      });
      return;
    }
    const request = dispatch(
      target.client,
      "session/acknowledge_completion",
      {
        sessionId: session.id,
        completedAt: session.lastCompletedAt,
      },
      { sourceHelmKey: target.helmKey },
    ).then((result) => {
      if (!result || (result as { ok?: unknown }).ok !== true) {
        throw new Error("Helm 未确认会话完成状态");
      }
    }).catch((error) => {
      deckData.addNotification({
        kind: "warning",
        source: "session",
        message: `会话完成状态同步失败：${formatRpcError(error)}`,
        sessionId: session.id,
        details: {
          phase: "session/acknowledge_completion",
          helmKey: target.helmKey,
        },
      });
    }).finally(() => {
      acknowledgeCompletionRequestsRef.current.delete(completionKey);
    });
    acknowledgeCompletionRequestsRef.current.set(completionKey, request);
    void request;
  }

  function clearNotificationsFromHelm() {
    const target = resolveLoggingTarget();
    if (!target) {
      deckData.addNotification({
        kind: "warning",
        source: "notification",
        message: "通知清理失败：未连接到目标 Helm。",
        details: { phase: "notification/clear" },
      });
      return;
    }
    void dispatch(
      target.client,
      "notification/clear",
      {},
      { sourceHelmKey: target.helmKey },
    ).then((result) => {
      const clearedAt = (result as { clearedAt?: unknown } | null)?.clearedAt;
      if (typeof clearedAt !== "string") {
        throw new Error("Helm 未返回通知清理时间");
      }
      deckData.applyNotificationClear(clearedAt);
    }).catch((error) => {
      deckData.addNotification({
        kind: "warning",
        source: "notification",
        message: `通知清理失败：${formatRpcError(error)}`,
        details: {
          phase: "notification/clear",
          helmKey: target.helmKey,
        },
      });
    });
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

  const helmUpdateActions = createHelmUpdateActions({
    runtime: {
      primaryHelmKeyRef: runtimeState.primaryHelmKeyRef,
      rpcClientRef: runtimeState.rpcClientRef,
      helmRpcClientRefs: runtimeState.helmRpcClientRefs,
    },
    inventory: {
      helmInventories: deckData.helmInventories,
      applyHelmInventory: deckData.applyHelmInventory,
    },
    resolveCurrentHelmKey,
    dispatch,
    formatError: formatRpcError,
  });
  const helmUpdateKey = helmUpdateActions.resolveHelmKey();
  const helmUpdateTarget = helmUpdateActions.resolveTarget();
  const helmUpdateState = helmUpdateActions.getState();
  const helmUpdateBlocking = isHelmUpdateBlocking(helmUpdateState);

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

  const selectionActions = useSelection({
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
  const selection = {
    ...selectionActions,
    openSession(sessionId: string) {
      const session = deckData.sessions.find((item) => item.id === sessionId);
      if (session) {
        acknowledgeSessionCompletion(session);
      }
      selectionActions.openSession(sessionId);
    },
    acknowledgeSessionCompletion,
  };

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
    hasActiveConversation: Boolean(missionView.activeSession || deckData.draftChatWindow),
  });

  function openNewTaskFromDashboard(request: DashboardQuickCreateRequest): boolean {
    const currentHelmKey = daemonProfileKey(
      helmConnection.daemonHost.trim() || DEFAULT_DAEMON_HOST,
      helmConnection.daemonPort.trim() || DEFAULT_DAEMON_PORT,
    );
    const client = request.helmKey === currentHelmKey
      ? runtimeState.rpcClientRef.current
      : runtimeState.helmRpcClientRefs.current.get(request.helmKey);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      deckData.addNotification({
        kind: "warning",
        source: "dashboard",
        message: "任务未创建：目标 Helm 尚未连接。",
        details: { helmKey: request.helmKey, phase: "dashboard-quick-create" },
      });
      return false;
    }

    const dispatchDashboardTask = (
      method: "session/new" | "session/prompt" | "conversation/save" | "conversation/start" | "conversation/delete",
      params: Record<string, unknown>,
    ) => dispatch(
      client,
      method,
      params,
      { sourceHelmKey: request.helmKey },
    );

    if (request.mode === "new" && (!request.projectId || !request.cwd || !request.agentId)) {
      void dispatchDashboardTask("conversation/save", {
        ...(request.preparationId ? { id: request.preparationId } : {}),
        ...(request.revision !== undefined ? { revision: request.revision } : {}),
        content: request.prompt,
        title: request.title,
        projectId: request.projectId,
        cwd: request.cwd,
        agentId: request.agentId,
      }).catch((error) => {
        deckData.addNotification({
          kind: "error",
          source: "dashboard",
          message: `准备记录保存失败：${formatRpcError(error)}`,
          details: { helmKey: request.helmKey, phase: "conversation/save" },
        });
      });
      return true;
    }

    let launchTask: Promise<string>;
    if (request.mode === "reuse") {
      launchTask = launchDashboardTask({
        sessionId: request.sessionId,
        prompt: request.prompt,
        dispatch: dispatchDashboardTask,
      });
    } else {
      launchTask = dispatchDashboardTask("conversation/start", {
        ...(request.preparationId ? { preparationId: request.preparationId } : {}),
        ...(request.revision !== undefined ? { revision: request.revision } : {}),
        content: request.prompt,
        title: request.title,
        projectId: request.projectId,
        cwd: request.cwd,
        agentId: request.agentId,
      }).then((result) => {
        const response = result as {
          session?: { id?: unknown };
          titleUpdateFailed?: unknown;
        } | null;
        const sessionId = response?.session?.id;
        if (typeof sessionId !== "string" || !sessionId) {
          throw new Error("目标 Helm 没有返回会话 id。");
        }
        if (typeof response?.titleUpdateFailed === "string" && response.titleUpdateFailed) {
          deckData.addNotification({
            kind: "warning",
            source: "dashboard",
            message: `会话已创建，但标题更新失败：${response.titleUpdateFailed}`,
            sessionId,
            details: { helmKey: request.helmKey, phase: "conversation/start-title" },
          });
        }
        return sessionId;
      });
    }

    void launchTask.then(async (sessionId) => {
      if (request.mode !== "reuse" || !request.preparationId) {
        return;
      }
      try {
        await finalizeDashboardTaskLaunch({
          mode: request.mode,
          preparationId: request.preparationId,
          revision: request.revision,
          dispatch: dispatchDashboardTask,
        });
      } catch (error) {
        deckData.addNotification({
          kind: "warning",
          source: "dashboard",
          message: `会话已继续，但准备记录清理失败：${formatRpcError(error)}`,
          sessionId,
          details: { helmKey: request.helmKey, phase: "conversation/delete" },
        });
      }
    }).catch((error) => {
      const launchError = error instanceof DashboardTaskLaunchError ? error : null;
      const method = launchError?.phase ?? (request.mode === "reuse" ? "session/prompt" : "conversation/start");
      const failure = launchError?.cause ?? error;
      deckData.addNotification({
        kind: "error",
        source: "dashboard",
        message: method === "session/prompt"
          ? `任务 Prompt 发送失败：${formatRpcError(failure)}`
          : request.preparationId
            ? `准备任务启动失败：${formatRpcError(failure)}`
            : `任务创建失败：${formatRpcError(failure)}`,
        details: {
          helmKey: request.helmKey,
          method,
          phase: "dashboard-quick-create",
        },
      });
    });
    return true;
  }

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
    activityHistoryState: deckData.activityHistoryState,
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
    activeProfileId: daemonProfileKey(
      helmConnection.daemonHost.trim() || DEFAULT_DAEMON_HOST,
      helmConnection.daemonPort.trim() || DEFAULT_DAEMON_PORT,
    ),
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
  const composerSlashSession = missionView.selectedComposerSession ?? missionView.activeSession;
  const activeSessionSlashCommands = composerSlashSession?.availableCommands ?? [];
  const sessionAvailableCommandsForComposer = useMemo(
    () =>
      composerSlashSession && activeSessionSlashCommands.length
        ? {
            ...deckData.sessionAvailableCommands,
            [composerSlashSession.id]: activeSessionSlashCommands,
          }
        : deckData.sessionAvailableCommands,
    [deckData.sessionAvailableCommands, composerSlashSession, activeSessionSlashCommands],
  );
  const slash = useSlashCommands({
    prompt: runtimeState.prompt,
    setPrompt: runtimeState.setPrompt,
    activeSessionId: composerSlashSession?.id ?? deckData.activeSessionId,
    activeSessionAgentId: composerSlashSession?.agentId ?? runtimeState.selectedAgentId,
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

  const activeProfileId = daemonProfileKey(
    helmConnection.daemonHost.trim() || DEFAULT_DAEMON_HOST,
    helmConnection.daemonPort.trim() || DEFAULT_DAEMON_PORT,
  );
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
    dashboardSection,
  );
  const deckTheme = deckData.deckPreferences.theme;

  useEffect(() => {
    document.body.dataset.theme = deckTheme;
  }, [deckTheme]);

  useEffect(() => {
    const settingsVisible =
      route.activeView === "settings" ||
      (route.activeView === "dashboard" && dashboardSection === "settings");
    if (!settingsVisible) {
      return;
    }
    void refreshLoggingSettings();
  }, [
    route.activeView,
    dashboardSection,
    helmConnection.connection,
    helmConnection.daemonHost,
    helmConnection.daemonPort,
    deckData.selectedHelmKey,
    deckData.helmConnectionStates,
  ]);

  useHelmUpdateLifecycle({
    connection: helmConnection.connection,
    helmKey: helmUpdateKey,
    update: helmUpdateState,
  });

  // 离开设置页面时清空 promptEnhancer 状态消息
  useEffect(() => {
    const settingsVisible =
      route.activeView === "settings" ||
      (route.activeView === "dashboard" && dashboardSection === "settings");
    if (settingsVisible) {
      return;
    }
    // 当从设置页面切换到其他页面时，清空状态消息
    promptEnhancerSettings.setStatus("");
  }, [route.activeView, dashboardSection, promptEnhancerSettings]);

  const appShell = (
    <main
      aria-busy={helmUpdateBlocking}
      className={shellClassName}
      inert={helmUpdateBlocking || undefined}
    >
      <RouteErrorBoundary
        onError={(error, componentStack) => {
          deckData.addNotification({
            kind: "error",
            source: "deck-ui",
            message: formatRouteCrashNotification(error.message, componentStack),
            details: {
              phase: "render",
              errorName: error.name,
              errorStack: error.stack,
              componentStack,
            },
          });
        }}
      >
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
          dashboardSection,
          setDashboardSection,
          activeProfileId,
          copy,
          agentLocked,
          enhancePromptDraft,
          updateSessionDraftPreferences,
          toggleProjectFileDirectory,
          openDiffDetail,
          toggleExpandedMessage,
          openNewTaskFromDashboard,
          clearNotifications: clearNotificationsFromHelm,
          renderMissionAgentIcon,
          loggingSettings: effectiveLoggingSettings,
          loggingStatus,
          loggingClientAvailable,
          loggingConnectionKnownConnected,
          refreshLoggingSettings,
          saveLoggingLevel,
          helmUpdateState,
          helmUpdateClient: helmUpdateTarget?.client ?? null,
          refreshHelmUpdate: helmUpdateActions.refresh,
          startHelmUpdate: helmUpdateActions.start,
        })}
      />
      </RouteErrorBoundary>
      <SessionCleanupConfirmDialog
        session={runtimeState.pendingSessionCleanup}
        resolveSessionTitle={titleActions.resolveDisplaySessionTitle}
        onCancel={() => runtimeState.setPendingSessionCleanup(null)}
        onConfirm={(sessionId) => {
          controllers.cleanupSession(sessionId);
          runtimeState.setPendingSessionCleanup(null);
        }}
      />
      <RadialMenu
          activeView={route.activeView}
          items={V6_RADIAL_ITEMS}
          onNavigate={route.navigateToView}
          enabled={route.activeView !== "dashboard"}
        />
    </main>
  );

  return (
    <div className="mobile-addressbar-scroll-shell">
      {appShell}
      <HelmUpdateBlockingOverlay update={helmUpdateState} />
    </div>
  );
}
