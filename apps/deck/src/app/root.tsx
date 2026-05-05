import { useEffect, useMemo, useRef, type FormEvent } from "react";
import "highlight.js/styles/github-dark.css";
import type { ClientToHelm, HelmToClient } from "@tiller/sync-protocol";
import type { AgentToolCall } from "@tiller/shared";
import { daemonProfileKey, formatDaemonProfileLine, type DaemonProfile } from "../features/helm-connection/daemon-profiles";
import { useHelmConnection } from "../features/helm-connection/hooks/connection";
import type { ConnectionState } from "../store/slices/connection-slice";
import type { HelmInventoryBucket } from "../store/slices/helms-slice";
import { UI_COPY, type Locale } from "../shared/utils/copy";
import { usePreferencesEffects } from "../features/preferences/hooks/effects";
import { agentModelOptionsKey, readAgentModelOptionsCache, writeAgentModelOptionsCache } from "../features/agents/utils/agent-model-options-cache";
import { slugify, splitArgs } from "../features/agents/utils/agent-identity";
import { normalizeModelSelection, resolveCombinedModelValue, resolveModelOptions, resolvePreferredModel, resolveReasoningLabel, resolveReasoningOptionsForModel } from "../features/mission/utils/composer-options";
import { projectFilesKey } from "../features/mission/utils/project-files-key";
import { formatRelativeTime } from "../shared/utils/format-time";
import { handleActivityServerEvent, handleDeviceServerEvent, handleInventoryServerEvent, handleSessionServerEvent } from "../features/server-events/index";
import { useRouteView } from "./route-view";
import { useDeckPreferenceActions } from "./preference-actions";
import { usePromptEnhanceAction } from "./prompt-enhance-action";
import { useSessionCommandActions } from "./session-command-actions";
import { useSessionMessageActions } from "./session-message-actions";
import { TopNav } from "../shared/ui/layout/top-nav";
import { createMissionVisualFixture, shouldUseMissionVisualFixture } from "../features/mission/utils/visual-fixture";
import { MissionAgentIcon } from "../features/mission/ui/agent-icon";
import { SessionCleanupConfirmDialog } from "../features/mission/ui/session-cleanup-confirm-dialog";
import { useHistoryPagination } from "../features/mission/hooks/history-pagination";
import { useMissionLayout } from "../features/mission/hooks/layout";
import { usePanelPages } from "../features/mission/hooks/panel-pages";
import { useSelection, type SessionDraftPreferencePatch } from "../features/mission/hooks/selection";
import { useSessionTitles } from "../features/mission/hooks/session-titles";
import { useSlashCommands } from "../features/mission/hooks/slash-commands";
import { useMissionViewModel } from "./mission-view-model";
import { useMissionEffects } from "./mission-effects";
import { usePromptEnhancerSettings } from "../features/prompt-enhancer/hooks/settings";
import { clearTrustedDeviceCache, getOrCreateDeviceId, readTrustedDeviceCache, writeTrustedDeviceCache } from "../features/auth/beacon-cache";
import { mergeToolCallHistory } from "../features/logbook/timeline";
import { DAEMON_HOST_KEY, DAEMON_PORT_KEY, resolveDefaultHelmEndpoint } from "../features/helm-connection/helm-endpoint";
import { connectHelmSocket as connectHelmSocketImpl, connectToDaemon as connectToDaemonImpl, type ConnectToDaemonOptions } from "../features/helm-connection/sockets";
import { dispatchWithTrace, nextRequestId, requestInitialSync as requestInitialSyncImpl } from "../features/helm-connection/request-dispatch";
import { useCodeActions } from "../features/pairing/hooks/code-actions";
import { DECK_DEVICE_NAME, DEFAULT_ACTIVITY_PAGE_LIMIT, DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT, DEFAULT_MESSAGE_PAGE_LIMIT, DEFAULT_SESSION_PAGE_LIMIT, IS_EMBEDDED_HELM_DECK } from "./constants";
import { useDeckData } from "./deck-data";
import { useAppRuntimeState } from "./runtime-state";
import { AppRoutes } from "./route-content";
import { useAppActions } from "./action-handlers";
import { useAppControllers } from "./controllers";
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
  const deckDeviceId = useMemo(() => getOrCreateDeviceId(window.localStorage), []);
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

  function dispatch(socket: WebSocket, payload: ClientToHelm) {
    dispatchWithTrace(socket, payload, helmConnection.setDebugTrace);
  }

  const codeActions = useCodeActions({
    socketRef: runtimeState.socketRef,
    pairingCodeInput: helmConnection.pairingCodeInput,
    setPairingCodeInput: helmConnection.setPairingCodeInput,
    pairInputRefs: runtimeState.pairInputRefs,
    pairingState: helmConnection.pairingState,
    setPairingState: helmConnection.setPairingState,
    setPairingFeedback: helmConnection.setPairingFeedback,
    setDebugTrace: helmConnection.setDebugTrace,
    dispatch,
    requestCounter: runtimeState.requestCounter,
    deckDeviceId,
    deckDeviceName: DECK_DEVICE_NAME,
  });

  const toolCallsRef = useRef<Record<string, AgentToolCall[]>>(
    missionVisualFixture?.toolCalls ?? {},
  );
  const agentModelOptionsHydratedRef = useRef(false);
  const lastFilesScopeKeyRef = useRef<string | null>(null);
  const titleActions = useSessionTitles({
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
  const layoutContext = {
    ...layout,
    missionLayoutStyle: layout.paneStyles.layout,
    missionSidebarPaneStyle: layout.paneStyles.sidebar,
    missionChatPaneStyle: layout.paneStyles.chat,
    missionDisplayPaneStyle: layout.paneStyles.display,
    missionInspectorPaneStyle: layout.paneStyles.inspector,
  };
  const panelContext = {
    customMissionPanelPages: panelPages.customPages,
    selectedMissionPanelPageId: panelPages.selectedPageId,
    setSelectedMissionPanelPageId: panelPages.setSelectedPageId,
    selectedMissionDiffFilePath: panelPages.selectedDiffFilePath,
    setSelectedMissionDiffFilePath: panelPages.setSelectedDiffFilePath,
    collapsedMissionDiffDirectories: panelPages.collapsedDiffDirectories,
    setDraggedMissionPanelPageId: panelPages.setDraggedPageId,
    toggleMissionDiffDirectory: panelPages.toggleDiffDirectory,
    addMissionPanelPage: panelPages.addPage,
    dropMissionPanelPage: panelPages.dropPage,
    renameMissionPanelPage: panelPages.renamePage,
    moveMissionPanelPage: panelPages.movePage,
    deleteMissionPanelPage: panelPages.deletePage,
  };

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
    if (activeSession && runtimeState.socketRef.current) {
      dispatch(runtimeState.socketRef.current, {
        type: "session.configure",
        requestId: nextRequestId(runtimeState.requestCounter),
        sessionId: activeSession.id,
        agentMode: next.agentMode ?? activeSession.agentMode ?? missionView.effectiveDraftAgentMode,
        model: normalizeModelSelection(next.model ?? activeSession.model ?? missionView.draftModel),
        reasoningEffort:
          next.reasoningEffort ??
          activeSession.reasoningEffort ??
          runtimeState.selectedReasoningEffort,
      });
      return;
    }
    if (typeof next.agentMode === "string") runtimeState.setSelectedAgentMode(next.agentMode);
    if (typeof next.model === "string") runtimeState.setSelectedModel(next.model);
    if (next.reasoningEffort) runtimeState.setSelectedReasoningEffort(next.reasoningEffort);
  }

  const agentLocked = Boolean(
    missionView.activeSession?.runtimeSessionId ?? missionView.activeSession?.resume?.runtimeSessionId,
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
    requestCounter: runtimeState.requestCounter,
    sessionHistoryState: deckData.sessionHistoryState,
    setActivityHistoryState: deckData.setActivityHistoryState,
    setMessageHistoryState: deckData.setMessageHistoryState,
    setSessionHistoryState: deckData.setSessionHistoryState,
    socketRef: runtimeState.socketRef,
    stickChatToBottomRef: runtimeState.stickChatToBottomRef,
    nextRequestId,
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
    sessionAvailableCommands: deckData.sessionAvailableCommands,
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
  const shellClassName = [
    "shell",
    `view-${route.activeView}`,
    `theme-${deckData.deckPreferences.theme}`,
    deckData.deckPreferences.reduceMotion ? "motion-reduced" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={shellClassName}>
      <TopNav
        activeView={route.activeView}
        onNavigate={route.navigateToView}
        connection={helmConnection.connection}
        language={deckData.deckPreferences.language}
      />
      <AppRoutes
        ctx={{
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
          promptEnhancerBusy: promptEnhancerSettings.busy,
          promptEnhancerStatus: promptEnhancerSettings.status,
          promptEnhancerModels: promptEnhancerSettings.models,
          promptEnhancerModelFilter: promptEnhancerSettings.modelFilter,
          setPromptEnhancerModelFilter: promptEnhancerSettings.setModelFilter,
          promptEnhancerModelPickerOpen: promptEnhancerSettings.modelPickerOpen,
          setPromptEnhancerModelPickerOpen: promptEnhancerSettings.setModelPickerOpen,
          updatePromptEnhancerLlmPreference: promptEnhancerSettings.updateLlmPreference,
          resetPromptEnhancerDefaults: promptEnhancerSettings.resetDefaults,
          testPromptEnhancerSelectedModel: promptEnhancerSettings.testSelectedModel,
          refreshPromptEnhancerModels: promptEnhancerSettings.refreshModels,
          updatePromptEnhancerModelInput: promptEnhancerSettings.updateModelInput,
          selectPromptEnhancerModel: promptEnhancerSettings.selectModel,
          slash,
          codeActions,
          helmConnection,
          route,
          activeView: route.activeView,
          navigateToView: route.navigateToView,
          activeProfileId,
          copy,
          agentLocked,
          enhancePromptDraft,
          updateSessionDraftPreferences,
          toggleProjectFileDirectory,
          openDiffDetail,
          toggleExpandedMessage,
          renderMissionAgentIcon,
        }}
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
