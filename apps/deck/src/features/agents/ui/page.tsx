import type {
  Dispatch,
  FormEvent,
  MutableRefObject,
  ReactNode,
  SetStateAction,
} from "react";
import type {
  AcpAgentProvider,
  HelmSummary,
  ProjectSummary,
  TrustedDeviceSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import type { DaemonProfile } from "../../helm-connection/facade";
import type { Locale, UI_COPY } from "../../../shared/utils/copy";
import { DeleteHelmConfigDialog } from "./delete-helm-config-dialog";
import { FleetAddHelmDialog } from "./fleet-add-helm-dialog";
import { HelmDetailSection } from "./helm-detail-section";
import { HelmHub } from "./helm-hub";
import type { FleetAgentDraft } from "./agent-inventory-section";
import type { FleetProjectDraft } from "./project-inventory-section";
import {
  resolveHelmSelection,
  type ConnectionState,
  type HelmInventoryBucket,
} from "../utils/helm-selection";
type PairingState = "idle" | "waiting" | "input" | "paired" | "rejected";
type AgentsPageProps = {
  daemonHost: string;
  daemonPort: string;
  defaultDaemonHost: string;
  defaultDaemonPort: string;
  isEmbeddedHelmDeck: boolean;
  daemonProfiles: DaemonProfile[];
  selectedHelmKey: string;
  connection: ConnectionState;
  helmConnectionStates: Record<string, ConnectionState>;
  helmInventories: Record<string, HelmInventoryBucket>;
  trustedDevices: TrustedDeviceSummary[];
  projects: ProjectSummary[];
  agents: AcpAgentProvider[];
  workspaces: WorkspaceSummary[];
  socketRef: MutableRefObject<WebSocket | null>;
  helmSocketRefs: MutableRefObject<Map<string, WebSocket>>;
  configuredHelms: HelmSummary[];
  fleetAddHelmStage: "connect" | "connecting" | "pair";
  fleetAddHelmModalOpen: boolean;
  closeFleetAddHelmModal: () => void;
  connectFromFleetAddHelmModal: (event: FormEvent<HTMLFormElement>) => void;
  fleetAddHelmName: string;
  setFleetAddHelmName: Dispatch<SetStateAction<string>>;
  fleetAddHelmHost: string;
  setFleetAddHelmHost: Dispatch<SetStateAction<string>>;
  fleetAddHelmPort: string;
  setFleetAddHelmPort: Dispatch<SetStateAction<string>>;
  submitPairingCode: (event: FormEvent<HTMLFormElement>) => void;
  pairInputRefs: MutableRefObject<Array<HTMLInputElement | null>>;
  pairingCodeInput: string;
  pairingState: PairingState;
  updatePairingDigit: (index: number, rawValue: string) => void;
  handlePairingKeyDown: (index: number, key: string) => void;
  pastePairingDigits: (startIndex: number, rawValue: string) => void;
  sendPairingRequest: () => void;
  connectToDaemon: (
    event?: FormEvent<HTMLFormElement>,
    options?: { preserveState?: boolean },
  ) => Promise<void> | void;
  pendingHelmDeleteProfile: DaemonProfile | null;
  setPendingHelmDeleteProfile: Dispatch<SetStateAction<DaemonProfile | null>>;
  removeDaemonProfile: (profile: DaemonProfile) => void;
  setSelectedHelmKey: (key: string) => void;
  openFleetAddHelmModal: () => void;
  manualDisconnectRef: MutableRefObject<string | null>;
  setConnection: Dispatch<SetStateAction<ConnectionState>>;
  lastFilesScopeKeyRef: MutableRefObject<string | null>;
  setHelmConnectionState: (profileKey: string, state: ConnectionState) => void;
  connectDaemonProfile: (profile: DaemonProfile) => void;
  fleetProjectFormOpen: boolean;
  setFleetProjectFormOpen: Dispatch<SetStateAction<boolean>>;
  fleetProjectDraft: FleetProjectDraft;
  setFleetProjectDraft: Dispatch<SetStateAction<FleetProjectDraft>>;
  setFleetProjectSaveMessage: Dispatch<SetStateAction<string>>;
  fleetProjectSaveMessage: string;
  fleetAgentFormOpen: boolean;
  setFleetAgentFormOpen: Dispatch<SetStateAction<boolean>>;
  fleetAgentDraft: FleetAgentDraft;
  setFleetAgentDraft: Dispatch<SetStateAction<FleetAgentDraft>>;
  requestCounter: MutableRefObject<number>;
  copy: (typeof UI_COPY)[Locale];
  renderTrustedDevicesPanel: (
    devices: TrustedDeviceSummary[],
    socket: WebSocket | null,
    helmName: string,
  ) => ReactNode;
};
export function AgentsPage({
  daemonHost,
  daemonPort,
  defaultDaemonHost,
  defaultDaemonPort,
  isEmbeddedHelmDeck,
  daemonProfiles,
  selectedHelmKey,
  connection,
  helmConnectionStates,
  helmInventories,
  trustedDevices,
  projects,
  agents,
  workspaces,
  socketRef,
  helmSocketRefs,
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
  pairingState,
  updatePairingDigit,
  handlePairingKeyDown,
  pastePairingDigits,
  sendPairingRequest,
  connectToDaemon,
  pendingHelmDeleteProfile,
  setPendingHelmDeleteProfile,
  removeDaemonProfile,
  setSelectedHelmKey,
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
  copy,
  renderTrustedDevicesPanel,
}: AgentsPageProps) {
  const helmSelection = resolveHelmSelection({
    daemonHost,
    daemonPort,
    defaultDaemonHost,
    defaultDaemonPort,
    isEmbeddedHelmDeck,
    daemonProfiles,
    selectedHelmKey,
    connection,
    helmConnectionStates,
    helmInventories,
    trustedDevices,
    projects,
    agents,
    workspaces,
    configuredHelms,
    socket: socketRef.current,
    helmSockets: helmSocketRefs.current,
  });
  if (!helmSelection) {
    return null;
  }
  const {
    currentHelmKey,
    helmCards,
    selectedHelm,
    selectedHelmAgents,
    selectedHelmConnection,
    selectedHelmId,
    selectedHelmIsConnected,
    selectedHelmIsCurrent,
    selectedHelmProjects,
    selectedHelmSavedProfile,
    selectedHelmSocket,
    selectedHelmTrustedDevices,
    selectedHelmWorkspaces,
  } = helmSelection;
  return (
    <section className="workspace-single">
      {fleetAddHelmModalOpen ? (
        <FleetAddHelmDialog
          stage={fleetAddHelmStage}
          connection={connection}
          onClose={closeFleetAddHelmModal}
          onConnect={connectFromFleetAddHelmModal}
          helmName={fleetAddHelmName}
          setHelmName={setFleetAddHelmName}
          helmHost={fleetAddHelmHost}
          setHelmHost={setFleetAddHelmHost}
          helmPort={fleetAddHelmPort}
          setHelmPort={setFleetAddHelmPort}
          defaultHost={defaultDaemonHost}
          defaultPort={defaultDaemonPort}
          onSubmitPairingCode={submitPairingCode}
          pairInputRefs={pairInputRefs}
          pairingCodeInput={pairingCodeInput}
          pairingState={pairingState}
          onUpdatePairingDigit={updatePairingDigit}
          onPairingKeyDown={handlePairingKeyDown}
          onPastePairingDigits={pastePairingDigits}
          onSendPairingRequest={sendPairingRequest}
          reconnect={() => connectToDaemon(undefined, { preserveState: true })}
        />
      ) : null}
      {pendingHelmDeleteProfile ? (
        <DeleteHelmConfigDialog
          profile={pendingHelmDeleteProfile}
          onClose={() => setPendingHelmDeleteProfile(null)}
          onRemove={(profile) => {
            removeDaemonProfile(profile);
            setPendingHelmDeleteProfile(null);
          }}
        />
      ) : null}
      <section className="card surface-card stack-gap fleet-panel fleet-command-panel">
        <div className="section-head section-head-soft fleet-title-row">
          <div>
            <h2>舰队</h2>
          </div>
        </div>
        <HelmHub
          connection={connection}
          currentHelmKey={currentHelmKey}
          helmCards={helmCards}
          helmConnectionStates={helmConnectionStates}
          isEmbeddedHelmDeck={isEmbeddedHelmDeck}
          onAddHelm={openFleetAddHelmModal}
          selectedHelm={selectedHelm}
          setSelectedHelmKey={setSelectedHelmKey}
        />
        <HelmDetailSection
          selectedHelm={selectedHelm}
          selectedHelmConnection={selectedHelmConnection}
          selectedHelmIsConnected={selectedHelmIsConnected}
          selectedHelmIsCurrent={selectedHelmIsCurrent}
          selectedHelmSavedProfile={selectedHelmSavedProfile}
          selectedHelmProjects={selectedHelmProjects}
          selectedHelmAgents={selectedHelmAgents}
          selectedHelmWorkspaces={selectedHelmWorkspaces}
          selectedHelmSocket={selectedHelmSocket}
          selectedHelmId={selectedHelmId}
          selectedHelmTrustedDevices={selectedHelmTrustedDevices}
          socketRef={socketRef}
          helmSocketRefs={helmSocketRefs}
          isEmbeddedHelmDeck={isEmbeddedHelmDeck}
          manualDisconnectRef={manualDisconnectRef}
          lastFilesScopeKeyRef={lastFilesScopeKeyRef}
          setConnection={setConnection}
          setHelmConnectionState={setHelmConnectionState}
          setPendingHelmDeleteProfile={setPendingHelmDeleteProfile}
          connectDaemonProfile={connectDaemonProfile}
          connectToDaemon={connectToDaemon}
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
      </section>
    </section>
  );
}
