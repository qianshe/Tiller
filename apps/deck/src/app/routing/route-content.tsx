import { lazy, Suspense, useEffect, useState } from "react";
import { useDeckStore } from "../../store";
import {
  buildDashboardQuickCreateHelms,
  buildDashboardQuickCreateProjects,
  buildDashboardViewModel,
} from "../../features/dashboard";
import type { AppRouteContext, MissionRouteSource } from "./route-context";
import {
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
  IS_EMBEDDED_HELM_DECK,
} from "../../shared/config/deck-runtime";
import { useEffectiveViewport } from "../../features/preferences";
import { clearProcessedApprovalHistory } from "../../features/approvals";
import { daemonProfileKey } from "../../features/helm-connection/facade";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../shared/ui";

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
    }: {
      source: MissionRouteSource;
      embedded?: boolean;
      chatOnly?: boolean;
    }) => module.renderMissionRoute(source, { embedded, chatOnly }),
  })),
);

const ignoreDashboardMissionStateUpdate = () => undefined;

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
    sessions,
    preparations,
    messages,
    sessionTimeline,
    statuses,
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
  const [dashboardMissionSessionId, setDashboardMissionSessionId] = useState<string | null>(null);
  const [dashboardSelectedSessionId, setDashboardSelectedSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (activeView !== "dashboard") {
      setDashboardMissionSessionId(null);
      setDashboardSelectedSessionId(null);
    }
  }, [activeView]);

  const openDashboardMission = (sessionId: string) => {
    if (!sessions.some((session: any) => session.id === sessionId)) {
      return;
    }
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
      onOpenSession={openSession}
      resolveDisplaySessionTitle={resolveDisplaySessionTitle}
      formatRelativeTime={formatRelativeTime}
    />
  );
}

function renderDashboard() {
  const currentHelmKey = daemonProfileKey(
    daemonHost.trim() || DEFAULT_DAEMON_HOST,
    daemonPort.trim() || DEFAULT_DAEMON_PORT,
  );
  const dashboardPreparations = helmInventories[currentHelmKey]?.preparations ?? preparations ?? [];
  const dashboard = buildDashboardViewModel({
    connection,
    daemonHost,
    daemonPort,
    defaultDaemonHost: DEFAULT_DAEMON_HOST,
    defaultDaemonPort: DEFAULT_DAEMON_PORT,
    activeHelm,
    helms,
    agents,
    projects,
    sessions,
    preparations: dashboardPreparations,
    messages,
    sessionTimeline,
    statuses,
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
        dashboardSection === "agents"
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

function renderDashboardMissionDialog() {
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

  const dashboardMissionSource = {
    ...source,
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
    openChatSessionIds: [dashboardMissionSessionId],
    focusedChatWindowId: `session:${dashboardMissionSessionId}`,
    setOpenChatSessionIds: ignoreDashboardMissionStateUpdate,
    setFocusedChatWindowId: ignoreDashboardMissionStateUpdate,
    setActiveSessionId: ignoreDashboardMissionStateUpdate,
    openSession: ignoreDashboardMissionStateUpdate,
    onCloseSessionView: () => setDashboardMissionSessionId(null),
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          setDashboardMissionSessionId(null);
        }
      }}
    >
      <DialogContent
        className="dashboard-mission-dialog h-[calc(100vh_-_1rem)] w-[calc(100vw_-_1rem)] max-w-[1200px] gap-0 overflow-hidden p-0 [&>button]:hidden sm:h-[min(800px,calc(100vh_-_2rem))] sm:w-[min(1200px,calc(100vw_-_2rem))]"
        data-slot="dashboard-mission-dialog"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Mission 工作台</DialogTitle>
          <DialogDescription>在 Dashboard 中查看并继续当前会话</DialogDescription>
        </DialogHeader>
        <div className="h-full min-h-0 w-full overflow-hidden">
          <MissionRoute
            key={dashboardMissionSessionId}
            source={dashboardMissionSource}
            embedded
            chatOnly
          />
        </div>
      </DialogContent>
    </Dialog>
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
            {renderDashboardMissionDialog()}
          </>
        )}
        {activeView === "sessions" && <MissionRoute source={source} />}
        {activeView === "agents" && renderAgents()}
        {activeView === "settings" && renderSettings()}
      </Suspense>
    </div>
  );
}
