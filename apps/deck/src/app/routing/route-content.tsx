import { lazy, Suspense } from "react";
import { useDeckStore } from "../../store";
import {
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
    default: ({ source }: { source: MissionRouteSource }) => module.renderMissionRoute(source),
  })),
);
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
    messages,
    sessionTimeline,
    statuses,
    sessionPlans,
    toolCalls,
    activitySummary: helmInventories[currentHelmKey]?.activitySummary,
    approvalItemsById,
    approvalHistory,
    notifications,
    resolveDisplaySessionTitle,
  });
  const quickCreateProjects = buildDashboardQuickCreateProjects({
    currentHelmKey,
    currentHelm: activeHelm,
    currentProjects: projects,
    currentAgents: agents,
    currentSessions: sessions,
    currentStatuses: statuses,
    daemonProfiles,
    helmInventories,
  });
  const renameDashboardSession = (sessionId: string, title: string) => {
    source.setSessionTitles?.((current: Record<string, string>) => ({
      ...current,
      [sessionId]: title,
    }));
    const client = source.rpcClientRef?.current;
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    void dispatch(client, "session/rename", { sessionId, title });
  };
  const deleteDashboardSession = (sessionId: string) => {
    source.controllers?.cleanupSession?.(sessionId);
  };

  return (
    <DashboardPage
      isMobile={isMobile}
      {...dashboard}
      activeSection={dashboardSection}
      onSelectSection={setDashboardSection}
      quickCreateProjects={quickCreateProjects}
      onCreateTask={openNewTaskFromDashboard}
      onOpenMission={() => navigateToView("sessions")}
      onOpenSession={(sessionId) => {
        openSession(sessionId);
        navigateToView("sessions");
      }}
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

function renderAgents() {
  return (
    <AgentsPage
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
function renderSettings() {
  return (
    <SettingsPage
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
        {activeView === "dashboard" && renderDashboard()}
        {activeView === "sessions" && <MissionRoute source={source} />}
        {activeView === "agents" && renderAgents()}
        {activeView === "settings" && renderSettings()}
      </Suspense>
    </div>
  );
}
