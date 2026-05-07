import { useEffect, useMemo, useRef } from "react";
import "highlight.js/styles/github-dark.css";
import type { AgentToolCall } from "@tiller/shared";
import {
  readAgentModelOptionsCache,
  useAppActions,
} from "../../features/agents";
import { getOrCreateDeviceId } from "../../features/auth";
import {
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
  normalizeModelSelection,
  resolveCombinedModelValue,
  resolveReasoningLabel,
  resolveReasoningOptionsForModel,
  createMissionVisualFixture,
  shouldUseMissionVisualFixture,
  MissionAgentIcon,
  SessionCleanupConfirmDialog,
  type SessionDraftPreferencePatch,
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
import {
  DECK_DEVICE_NAME,
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
  IS_EMBEDDED_HELM_DECK,
} from "../../shared/config/deck-runtime";
import { TopNav } from "../../shared/ui/layout/top-nav";
import { UI_COPY, type Locale } from "../../shared/utils/copy";
import { formatRelativeTime } from "../../shared/utils/format-time";
import {
  buildAppLayoutContext,
  buildAppRouteContext,
  buildMissionPanelContext,
  resolveShellClassName,
} from "../composition/bindings";
import { AppRoutes } from "../routing/route-content";
import { useRouteView } from "../routing/route-view";
import { useDeckData } from "../state/deck-data";
import { useAppRuntimeState } from "../state/runtime-state";

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
    messages: deckData.messages,
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
  const layout = useMissionLayout(route.activeView);
  const layoutContext = buildAppLayoutContext(layout);
  const panelContext = buildMissionPanelContext(panelPages);

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

  const selection = useSelection({
    projects: deckData.projects,
    agents: deckData.agents,
    sessions: deckData.sessions,
    requestChatScrollToBottom,
    setSelectedMissionHelmId: runtimeState.setSelectedMissionHelmId,
    setExpandedMissionHelmIds: runtimeState.setExpandedMissionHelmIds,
    setExpandedMissionProjectIds: runtimeState.setExpandedMissionProjectIds,
    setSelectedProjectId: runtimeState.setSelectedProjectId,
    setSelectedWorkspaceId: runtimeState.setSelectedWorkspaceId,
    setSelectedAgentId: runtimeState.setSelectedAgentId,
    setActiveSessionId: deckData.setActiveSessionId,
    setWorktreePickerOpen: runtimeState.setWorktreePickerOpen,
    setAgentPickerOpen: runtimeState.setAgentPickerOpen,
  });

  const missionView = useMissionViewModel({
    runtimeState,
    deckData,
    helmConnection,
    copy,
    locale,
  });

  function updateSessionDraftPreferences(next: SessionDraftPreferencePatch) {
    const activeSession = missionView.activeSession;
    const client = runtimeState.rpcClientRef.current;
    if (activeSession && client?.socket.readyState === WebSocket.OPEN) {
      void dispatch(client, "session/set_config_option", {
        sessionId: activeSession.id,
        agentMode:
          next.agentMode ??
          activeSession.agentMode ??
          missionView.effectiveDraftAgentMode,
        model: normalizeModelSelection(
          next.model ?? activeSession.model ?? missionView.draftModel,
        ),
        reasoningEffort:
          next.reasoningEffort ??
          activeSession.reasoningEffort ??
          runtimeState.selectedReasoningEffort,
      });
      return;
    }
    if (typeof next.agentMode === "string")
      runtimeState.setSelectedAgentMode(next.agentMode);
    if (typeof next.model === "string")
      runtimeState.setSelectedModel(next.model);
    if (next.reasoningEffort)
      runtimeState.setSelectedReasoningEffort(next.reasoningEffort);
  }

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
    preserveChatScrollRef: runtimeState.preserveChatScrollRef,
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
    filteredWorkspaces: missionView.filteredWorkspaces,
    selectedWorkspaceId: runtimeState.selectedWorkspaceId,
    activeSession: missionView.activeSession,
    draftProject: missionView.draftProject,
    messages: deckData.messages,
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
  const slash = useSlashCommands({
    prompt: runtimeState.prompt,
    setPrompt: runtimeState.setPrompt,
    activeSessionId: deckData.activeSessionId,
    activeSessionAgentId: missionView.activeSession?.agentId ?? runtimeState.selectedAgentId,
    sessionAvailableCommands: deckData.sessionAvailableCommands,
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
    panelPages.setSelectedDiffFilePath(path);
    panelPages.setSelectedPageId("diff-detail");
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
  const shellClassName = resolveShellClassName(
    route.activeView,
    deckData.deckPreferences.theme,
    deckData.deckPreferences.reduceMotion,
  );

  return (
    <main className={shellClassName}>
      <TopNav
        activeView={route.activeView}
        onNavigate={route.navigateToView}
        connection={helmConnection.connection}
        language={deckData.deckPreferences.language}
      />
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
    </main>
  );
}
