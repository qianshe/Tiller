// @ts-nocheck
import type { FormEvent } from "react";
import { daemonProfileKey, type DaemonProfile } from "../features/helm-connection/daemon-profiles";
import { TrustedDevicesPanel } from "../features/agents/ui/trusted-devices-panel";
import { useDaemonProfileActions } from "./daemon-profile-actions";
import { useFleetAddHelmActions } from "./fleet-add-helm-actions";
import { nextRequestId } from "../features/helm-connection/request-dispatch";
import { saveDraft as saveDraftImpl, testAgent as testAgentImpl, writeDraftToConfig as writeDraftToConfigImpl } from "../features/agents/actions/config-actions";
import { AGENT_DRAFT_STORAGE_KEY, DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from "./constants";

export function useAppActions(ctx: any) {
  const source = { ...ctx.runtimeState, ...ctx.deckData, ...ctx.helmConnection, ...ctx.controllers, ...ctx };
  const {
    selectedAgentId,
    filteredAgents,
    agents,
    socketRef,
    setAgentTestResult,
    copy,
    dispatch,
    requestCounter,
    agentDraft,
    setDraftSaveMessage,
    setConfigSaveMessage,
    slugify,
    splitArgs,
    daemonProfileName,
    daemonHost,
    daemonPort,
    daemonProfiles,
    selectedHelmKey,
    helmSocketRefs,
    manualDisconnectRef,
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
    fleetAddHelmName,
    fleetAddHelmHost,
    fleetAddHelmPort,
    pendingAddHelmProfileRef,
    setFleetAddHelmModalOpen,
    setFleetAddHelmStage,
    setFleetAddHelmName,
    setFleetAddHelmHost,
    setFleetAddHelmPort,
    deckPreferences,
    deckDeviceId,
    setPairingFeedback,
  } = source;
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
  return {
    testAgent,
    saveDraft,
    writeDraftToConfig,
    applyDaemonProfile,
    connectDaemonProfile,
    createDaemonProfile,
    persistDaemonProfile,
    removeDaemonProfile,
    saveDaemonProfile,
    closeFleetAddHelmModal,
    connectFromFleetAddHelmModal,
    openFleetAddHelmModal,
    revokeTrustedDevice,
    renderTrustedDevicesPanel,
  };
}
