import { lazy, Suspense } from "react";
import {
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
  IS_EMBEDDED_HELM_DECK,
} from "../../shared/config/deck-runtime";

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
    default: ({ source }: { source: any }) => module.renderMissionRoute(source),
  })),
);
export function AppRoutes({ ctx }: { ctx: any }) {
  const source = {
    ...ctx.runtimeState, ...ctx.deckData, ...ctx.missionView, ...ctx.titleActions,
    ...ctx.appActions,
    ...ctx.controllers, ...ctx.panelPages, ...ctx.selection, ...ctx.layout,
    ...ctx.history, ...ctx.preferenceActions, ...ctx.promptEnhancerSettings,
    ...ctx.slash, ...ctx.codeActions, ...ctx.helmConnection, ...ctx, ...ctx.route,
  };
  const {
    activeView,
    copy,
    connection,
    activeHelm,
    daemonHost,
    daemonPort,
    projects,
    worktrees,
    agents,
    sessions,
    helms,
    approvalItemsById,
    toolCalls,
    navigateToView,
    openSession,
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
    updatePromptEnhancerLlmPreference,
    updatePromptEnhancerModelInput,
    setPromptEnhancerModelPickerOpen,
    refreshPromptEnhancerModels,
    setPromptEnhancerModelFilter,
    selectPromptEnhancerModel,
    testPromptEnhancerSelectedModel,
  } = source;
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
  const activeHelmLabel = activeHelm
    ? `${activeHelm.name} · ${activeHelm.host}:${activeHelm.port}`
    : `${daemonHost || DEFAULT_DAEMON_HOST}:${daemonPort || DEFAULT_DAEMON_PORT}`;
  const helmRows = (helms ?? []).map((helm: any) => ({
    id: helm.id ?? `${helm.host}:${helm.port}`,
    name: helm.name ?? "Local Helm",
    endpoint: `${helm.host ?? DEFAULT_DAEMON_HOST}:${helm.port ?? DEFAULT_DAEMON_PORT}`,
    agentCount: helm.agentCount ?? helm.agentsCount ?? agents.length,
    projectCount: helm.projectCount ?? helm.projectsCount ?? projects.length,
    sessionCount: helm.sessionCount ?? helm.sessions ?? sessions.length,
    status: helm.status === "connected" || helm.status === "active" ? "active" : "idle",
  }));
  const approvalRows = Object.values(approvalItemsById ?? {}).map((item: any) => ({
    id: item.id ?? item.request?.id ?? item.requestId ?? item.createdAt,
    kind: item.request?.kind ?? item.request?.toolName ?? item.request?.type ?? "permission",
    target: item.request?.path ?? item.request?.command ?? item.request?.url ?? item.request?.description ?? "权限请求",
    agentName: item.request?.agentName ?? item.request?.agentId,
  }));
  const toolCallCount = Object.values(toolCalls ?? {}).reduce(
    (total: number, calls: any) => total + (Array.isArray(calls) ? calls.length : 0),
    0,
  );

  return (
    <DashboardPage
      activeHelmLabel={activeHelmLabel}
      onlineHelmCount={connection === "connected" ? 1 : 0}
      totalHelmCount={Math.max(helmRows.length, 1)}
      activeSessionCount={sessions.length}
      pendingApprovalCount={approvalRows.length}
      localMessageCount={sessions.length}
      toolCallCount={toolCallCount}
      sessions={sessions}
      helms={helmRows}
      approvals={approvalRows}
      onNavigateAgents={() => navigateToView("agents")}
    />
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
      worktrees={worktrees}
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
      testPromptEnhancerSelectedModel={testPromptEnhancerSelectedModel}
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
