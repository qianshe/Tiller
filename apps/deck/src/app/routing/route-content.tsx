import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react";
import { useDeckStore } from "../../store";
import {
  buildDashboardQuickCreateHelms,
  buildDashboardQuickCreateProjects,
  buildDashboardViewModel,
  DASHBOARD_MISSION_DRAWER_DEFAULT_WIDTH,
  DashboardMissionDrawerResizeHandle,
  DashboardGitWorkspace,
} from "../../features/dashboard";
import type { AppRouteContext, MissionRouteSource } from "./route-context";
import {
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
  IS_EMBEDDED_HELM_DECK,
} from "../../shared/config/deck-runtime";
import { useEffectiveViewport } from "../../features/preferences";
import { clearProcessedApprovalHistory } from "../../features/approvals";
import {
  resolveSessionComposerConfiguration,
  type SessionConfigPreferencePatch,
} from "../../features/mission/facade";
import { daemonProfileKey } from "../../features/helm-connection/facade";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "../../shared/ui";
import type { SessionSummary } from "@tiller/shared";

const OverviewPage = lazy(() =>
  import("../../features/overview/ui/page").then((module) => ({
    default: module.OverviewPage,
  })),
);
const DashboardPage = lazy(() =>
  import("../../features/dashboard/ui/page").then((module) => ({
    default: module.DashboardPage,
  })),
);
const AgentsPage = lazy(() =>
  import("../../features/agents/ui/page").then((module) => ({
    default: module.AgentsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("../../features/settings/ui/page").then((module) => ({
    default: module.SettingsPage,
  })),
);
const MissionRoute = lazy(() =>
  import("./mission-route").then((module) => ({
    default: ({
      source,
      embedded,
      chatOnly,
      hideSessionCloseAction,
    }: {
      source: MissionRouteSource;
      embedded?: boolean;
      chatOnly?: boolean;
      hideSessionCloseAction?: boolean;
    }) => module.renderMissionRoute(source, { embedded, chatOnly, hideSessionCloseAction }),
  })),
);

const ignoreDashboardMissionStateUpdate = () => undefined;

function DashboardMissionDrawerLoading() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-surface-elevated">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent"
        />
        <span>正在打开会话...</span>
      </div>
    </div>
  );
}

export function AppRoutes({ ctx }: { ctx: AppRouteContext }) {
  const viewport = useEffectiveViewport();
  const isMobile = viewport === "mobile";
  const helmHealthStatus = useDeckStore((state) => state.helmHealthStatus);

  const source = {
    ...ctx.runtimeState, ...ctx.deckData, ...ctx.missionView, ...ctx.titleActions,
    ...ctx.appActions,
    ...ctx.controllers, ...ctx.panelPages, ...ctx.selection, ...ctx.layout,
    ...ctx.history, ...ctx.preferenceActions, ...ctx.promptEnhancerSettings,
    ...ctx.slash, ...ctx.codeActions, ...ctx.helmConnection, ...ctx, ...ctx.route,
  } as MissionRouteSource;
  const {
    activeView,
    agentsInitialTab,
    copy,
    connection,
    activeHelm,
    daemonHost,
    daemonPort,
    projects,
    worktrees,
    projectFilesByScope,
    agents,
    agentConnectionInventory,
    sessions,
    preparations,
    messages,
    sessionTimeline,
    statuses,
    completedUnreadSessionIds,
    acknowledgeSessionCompletion,
    sessionPlans,
    helms,
    notifications,
    clearNotifications,
    approvalItemsById,
    approvalHistory,
    toolCalls,
    navigateToView,
    respondToPermission,
    openSession,
    openNewTaskFromDashboard,
    resolveDisplaySessionTitle,
    formatRelativeTime,
    socketRef,
    rpcClientRef,
    helmConnectionStates,
    pairingState,
    technicalPanels,
    deckPreferences,
    promptEnhancerBusy,
    daemonProfiles,
    selectedHelmKey,
    helmInventories,
    trustedDevices,
    helmSocketRefs,
    helmRpcClientRefs,
    dispatch,
    configuredHelms,
    fleetAddHelmStage,
    fleetAddHelmModalOpen,
    closeFleetAddHelmModal,
    connectFromFleetAddHelmModal,
    fleetAddHelmName,
    setFleetAddHelmName,
    fleetAddHelmHost,
    setFleetAddHelmHost,
    fleetAddHelmPort,
    setFleetAddHelmPort,
    submitPairingCode,
    pairInputRefs,
    pairingCodeInput,
    updatePairingDigit,
    handlePairingKeyDown,
    pastePairingDigits,
    sendPairingRequest,
    connectToDaemon,
    pendingHelmDeleteProfile,
    setPendingHelmDeleteProfile,
    removeDaemonProfile,
    selectHelmKey,
    openFleetAddHelmModal,
    manualDisconnectRef,
    setConnection,
    lastFilesScopeKeyRef,
    setHelmConnectionState,
    connectDaemonProfile,
    fleetProjectFormOpen,
    setFleetProjectFormOpen,
    fleetProjectDraft,
    setFleetProjectDraft,
    setFleetProjectSaveMessage,
    fleetProjectSaveMessage,
    fleetAgentFormOpen,
    setFleetAgentFormOpen,
    fleetAgentDraft,
    setFleetAgentDraft,
    requestCounter,
    renderTrustedDevicesPanel,
    promptModelPickerRef,
    promptEnhancerModelPickerOpen,
    promptEnhancerModelFilter,
    promptEnhancerModels,
    promptEnhancerStatus,
    resetDeckPreferences,
    updateDeckPreference,
    updateTechnicalPanelPreference,
    updatePromptEnhancerPreference,
    updatePromptEnhancerLlmPreference,
    updatePromptEnhancerModelInput,
    setPromptEnhancerModelPickerOpen,
    refreshPromptEnhancerModels,
    setPromptEnhancerModelFilter,
    selectPromptEnhancerModel,
    testPromptEnhancerSelectedModel,
    loggingSettings,
    loggingStatus,
    loggingClientAvailable,
    loggingConnectionKnownConnected,
    refreshLoggingSettings,
    saveLoggingLevel,
    helmUpdateState,
    helmUpdateClient,
    refreshHelmUpdate,
    startHelmUpdate,
    dashboardSection,
    setDashboardSection,
  } = source;
  const currentHelmKey = daemonProfileKey(
    daemonHost.trim() || DEFAULT_DAEMON_HOST,
    daemonPort.trim() || DEFAULT_DAEMON_PORT,
  );
  const [dashboardMissionSessionId, setDashboardMissionSessionId] = useState<string | null>(null);
  const [dashboardSelectedSessionId, setDashboardSelectedSessionId] = useState<string | null>(null);
  const [dashboardMissionDrawerWidth, setDashboardMissionDrawerWidth] = useState(
    DASHBOARD_MISSION_DRAWER_DEFAULT_WIDTH,
  );

  useEffect(() => {
    if (activeView !== "dashboard") {
      setDashboardMissionSessionId(null);
      setDashboardSelectedSessionId(null);
    }
  }, [activeView]);

  const openDashboardMission = (sessionId: string, helmKey?: string) => {
    const targetSession = sessions.find((session: any) => session.id === sessionId);
    if (!targetSession) {
      return;
    }
    if (helmKey && targetSession.helmId !== helmKey) {
      return;
    }
    acknowledgeSessionCompletion?.(targetSession);
    setDashboardSelectedSessionId(sessionId);
    setDashboardMissionSessionId(sessionId);
  };

function renderOverview() {
  return (
    <OverviewPage
      isMobile={isMobile}
      copy={copy}
      connection={connection}
      helmHealthStatus={helmHealthStatus}
      activeHelm={activeHelm}
      daemonHost={daemonHost}
      daemonPort={daemonPort}
      defaultDaemonHost={DEFAULT_DAEMON_HOST}
      defaultDaemonPort={DEFAULT_DAEMON_PORT}
      projects={projects}
      worktrees={worktrees}
      agents={agents}
      sessions={sessions}
      onNavigate={navigateToView}
      onOpenSession={(sessionId) => {
        openSession(sessionId);
      }}
      resolveDisplaySessionTitle={resolveDisplaySessionTitle}
      formatRelativeTime={formatRelativeTime}
    />
  );
}

function renderDashboard() {
  const dashboardPreparations = helmInventories[currentHelmKey]?.preparations ?? preparations ?? [];
  const dashboard = buildDashboardViewModel({
    connection,
    daemonHost,
    daemonPort,
    defaultDaemonHost: DEFAULT_DAEMON_HOST,
    defaultDaemonPort: DEFAULT_DAEMON_PORT,
    activeHelm,
    helms,
    configuredHelms,
    currentHelmKey,
    helmConnectionStates,
    helmInventories,
    agents,
    agentConnectionInventory,
    projects,
    sessions,
    preparations: dashboardPreparations,
    messages,
    sessionTimeline,
    statuses,
    completedUnreadSessionIds,
    selectedSessionId: dashboardSelectedSessionId,
    sessionPlans,
    toolCalls,
    activitySummary: helmInventories[currentHelmKey]?.activitySummary,
    approvalItemsById,
    approvalHistory,
    notifications,
    resolveDisplaySessionTitle,
  });
  const quickCreateInput = {
    currentHelmKey,
    currentHelm: activeHelm,
    currentProjects: projects,
    currentAgents: agents,
    currentSessions: sessions,
    currentStatuses: statuses,
    daemonProfiles,
    helmInventories,
  };
  const quickCreateHelms = buildDashboardQuickCreateHelms(quickCreateInput);
  const quickCreateProjects = buildDashboardQuickCreateProjects(quickCreateInput);
  const renameDashboardSession = (sessionId: string, title: string) => {
    const preparation = dashboardPreparations.find((item: any) => item.id === sessionId);
    const client = source.rpcClientRef?.current;
    if (preparation && client?.socket.readyState === WebSocket.OPEN) {
      void dispatch(client, "conversation/save", {
        id: preparation.id,
        revision: preparation.revision,
        title,
      });
      return;
    }
    source.setSessionTitles?.((current: Record<string, string>) => ({
      ...current,
      [sessionId]: title,
    }));
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    void dispatch(client, "session/rename", { sessionId, title });
  };
  const deleteDashboardSession = (sessionId: string) => {
    const preparation = dashboardPreparations.find((item: any) => item.id === sessionId);
    const client = source.rpcClientRef?.current;
    if (preparation && client?.socket.readyState === WebSocket.OPEN) {
      void dispatch(client, "conversation/delete", {
        id: preparation.id,
        revision: preparation.revision,
      });
      return;
    }
    source.controllers?.cleanupSession?.(sessionId);
  };

  return (
    <DashboardPage
      isMobile={isMobile}
      {...dashboard}
      preparations={dashboard.preparations}
      activeSection={dashboardSection}
      onSelectSection={setDashboardSection}
      embeddedContent={
        dashboardSection === "git"
          ? (
            <DashboardGitWorkspace
              currentHelmKey={currentHelmKey}
              currentConnection={connection as "connecting" | "connected" | "disconnected"}
              configuredHelms={configuredHelms as any}
              helms={helms as any}
              helmConnectionStates={helmConnectionStates}
              helmInventories={helmInventories}
              projects={projects as any}
              worktrees={worktrees as any}
              gitStatusByWorktree={source.gitStatusByWorktree ?? {}}
              gitGraphByWorktree={source.gitGraphByWorktree ?? {}}
              setGitGraphByWorktree={source.setGitGraphByWorktree}
              rpcClientRef={rpcClientRef}
              helmRpcClientRefs={helmRpcClientRefs}
              dispatch={dispatch as any}
              isMobile={isMobile}
            />
          )
          : dashboardSection === "agents"
          ? renderAgents("dashboard")
          : dashboardSection === "settings"
            ? renderSettings("dashboard")
            : null
      }
      quickCreateHelms={quickCreateHelms}
      quickCreateProjects={quickCreateProjects}
      onCreateTask={openNewTaskFromDashboard}
      onOpenMission={() => navigateToView("sessions")}
      onOpenSession={openDashboardMission}
      onOpenSearchSession={openDashboardMission}
      onRenameSession={renameDashboardSession}
      onDeleteSession={deleteDashboardSession}
      onRespondApproval={(approvalRequestId, decision) =>
        respondToPermission(approvalRequestId, decision)
      }
      onClearNotifications={clearNotifications}
      onClearApprovalHistory={() => {
        void clearProcessedApprovalHistory(rpcClientRef.current, dispatch);
      }}
    />
  );
}

function renderDashboardMissionDrawer() {
  if (!dashboardMissionSessionId) {
    return null;
  }

  const dashboardSession = sessions.find((session: any) => session.id === dashboardMissionSessionId);
  if (!dashboardSession) {
    return null;
  }
  const dashboardProjectId = dashboardSession.projectId;
  const dashboardProject = projects.find((project: any) => project.id === dashboardProjectId) ?? null;
  const dashboardWorktree = worktrees.find(
    (worktree: any) => worktree.path === dashboardSession.cwd,
  ) ?? null;
  const dashboardAgent = agents.find((agent: any) => agent.id === dashboardSession.agentId) ?? null;
  const dashboardSessionComposerConfiguration = resolveSessionComposerConfiguration({
    session: dashboardSession,
    sessions,
    sessionConfigOptions: source.sessionConfigOptions ?? {},
    agents,
  });
  const updateDashboardSessionDraftPreferences = (
    next: SessionConfigPreferencePatch,
  ) => source.updateSessionDraftPreferences(next, dashboardMissionSessionId);

  const dashboardMissionSource = {
    ...source,
    ...dashboardSessionComposerConfiguration,
    activeSessionId: dashboardMissionSessionId,
    activeSession: dashboardSession,
    activeSessionMessages: messages?.[dashboardMissionSessionId] ?? [],
    activePromptQueue: source.promptQueues?.[dashboardMissionSessionId],
    activeSessionProjectId: dashboardProjectId,
    activeSessionProject: dashboardProject,
    selectedProjectId: dashboardProjectId,
    selectedCwd: dashboardSession.cwd,
    selectedAgentId: dashboardSession.agentId,
    selectedWorktree: dashboardWorktree,
    selectedDraftAgent: dashboardAgent,
    effectiveMissionHelmId: dashboardSession.helmId,
    pendingPermission: source.permissionRequests?.[dashboardMissionSessionId] ?? null,
    updateSessionDraftPreferences: updateDashboardSessionDraftPreferences,
    openChatSessionIds: [dashboardMissionSessionId],
    focusedChatWindowId: `session:${dashboardMissionSessionId}`,
    setOpenChatSessionIds: ignoreDashboardMissionStateUpdate,
    setFocusedChatWindowId: ignoreDashboardMissionStateUpdate,
    setActiveSessionId: ignoreDashboardMissionStateUpdate,
    openSession: ignoreDashboardMissionStateUpdate,
    onCloseSessionView: () => setDashboardMissionSessionId(null),
  };

  const dashboardMissionDrawerClassName = isMobile
    ? "dashboard-mission-drawer h-[min(80dvh,720px)] max-h-[80dvh] min-h-0 gap-0 overflow-hidden rounded-none border-0 p-0"
    : "dashboard-mission-drawer h-full max-h-none gap-0 overflow-hidden rounded-none border-0 p-0 w-[var(--dashboard-mission-drawer-width)] sm:w-[var(--dashboard-mission-drawer-width)] max-w-[calc(100vw_-_1rem)] sm:max-w-[calc(100vw_-_1rem)]";

  return (
    <Drawer
      direction={isMobile ? "bottom" : "right"}
      dismissible
      handleOnly={!isMobile}
      open
      onOpenChange={(open) => {
        if (!open) {
          setDashboardMissionSessionId(null);
        }
      }}
    >
      <DrawerContent
        showHandle={false}
        style={
          {
            "--dashboard-mission-drawer-width": `${dashboardMissionDrawerWidth}px`,
            width: isMobile ? undefined : "var(--dashboard-mission-drawer-width)",
            maxWidth: isMobile ? undefined : "calc(100vw - 1rem)",
            userSelect: "text",
          } as CSSProperties
        }
        className={dashboardMissionDrawerClassName}
        data-slot="dashboard-mission-drawer"
      >
        {isMobile ? null : (
          <DashboardMissionDrawerResizeHandle
            width={dashboardMissionDrawerWidth}
            onWidthChange={setDashboardMissionDrawerWidth}
          />
        )}
        <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col">
          <DrawerHeader className="sr-only">
            <DrawerTitle>Mission 工作台</DrawerTitle>
            <DrawerDescription>在 Dashboard 中查看并继续当前会话</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <Suspense fallback={<DashboardMissionDrawerLoading />}>
              <MissionRoute
                key={dashboardMissionSessionId}
                source={dashboardMissionSource}
                embedded
                chatOnly
                hideSessionCloseAction
              />
            </Suspense>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function renderAgents(mode: "standalone" | "dashboard" = "standalone") {
  return (
    <AgentsPage
      mode={mode}
      isMobile={isMobile}
      daemonHost={daemonHost}
      daemonPort={daemonPort}
      initialTab={agentsInitialTab}
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
      worktrees={worktrees}
      projectFilesByScope={projectFilesByScope}
      socketRef={socketRef}
      rpcClientRef={rpcClientRef}
      helmSocketRefs={helmSocketRefs}
      helmRpcClientRefs={helmRpcClientRefs}
      dispatch={dispatch}
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
function renderSettings(mode: "standalone" | "dashboard" = "standalone") {
  return (
    <SettingsPage
      mode={mode}
      isMobile={isMobile}
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
      updatePromptEnhancerPreference={updatePromptEnhancerPreference}
      updatePromptEnhancerLlmPreference={updatePromptEnhancerLlmPreference}
      updatePromptEnhancerModelInput={updatePromptEnhancerModelInput}
      setPromptEnhancerModelPickerOpen={setPromptEnhancerModelPickerOpen}
      refreshPromptEnhancerModels={refreshPromptEnhancerModels}
      setPromptEnhancerModelFilter={setPromptEnhancerModelFilter}
      selectPromptEnhancerModel={selectPromptEnhancerModel}
      testPromptEnhancerSelectedModel={testPromptEnhancerSelectedModel}
      loggingSettings={loggingSettings}
      loggingStatus={loggingStatus}
      loggingClientAvailable={loggingClientAvailable}
      loggingConnectionKnownConnected={loggingConnectionKnownConnected}
      onRefreshLoggingSettings={refreshLoggingSettings}
      onSaveLoggingLevel={saveLoggingLevel}
      helmUpdate={helmUpdateState}
      helmUpdateClient={helmUpdateClient}
      onRefreshHelmUpdate={refreshHelmUpdate}
      onStartHelmUpdate={startHelmUpdate}
    />
  );
}
  return (
    <div className="page-content">
      <Suspense fallback={null}>
        {activeView === "overview" && renderOverview()}
        {activeView === "dashboard" && (
          <>
            {renderDashboard()}
            {renderDashboardMissionDrawer()}
          </>
        )}
        {activeView === "sessions" && <MissionRoute source={source} />}
        {activeView === "agents" && renderAgents()}
        {activeView === "settings" && renderSettings()}
      </Suspense>
    </div>
  );
}
