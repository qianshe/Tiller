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
  SessionSummary,
  TrustedDeviceSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import {
  daemonProfileKey,
  formatConnectionStatus,
  type DaemonProfile,
} from "../../helm-connection/daemon-profiles";
import type { Locale, UI_COPY } from "../../../shared/utils/copy";
import { DeleteHelmConfigDialog } from "./delete-helm-config-dialog";
import { FleetAddHelmDialog } from "./fleet-add-helm-dialog";
import { HelmActions } from "./helm-actions";
import { HelmHub, type HelmCard } from "./helm-hub";
import {
  AgentInventorySection,
  type FleetAgentDraft,
} from "./agent-inventory-section";
import {
  ProjectInventorySection,
  type FleetProjectDraft,
} from "./project-inventory-section";
import {
  dedupeHelmCards,
  resolveHelmConnectionState,
  slugify,
} from "../utils/fleet-helpers";
type ConnectionState = "connecting" | "connected" | "disconnected";
type PairingState = "idle" | "waiting" | "input" | "paired" | "rejected";
type HelmInventoryBucket = {
  projects: ProjectSummary[];
  workspaces: WorkspaceSummary[];
  agents: AcpAgentProvider[];
  sessions: SessionSummary[];
  trustedDevices: TrustedDeviceSummary[];
};
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
  const currentHelmKey = daemonProfileKey(
    daemonHost.trim() || defaultDaemonHost,
    daemonPort.trim() || defaultDaemonPort,
  );
  const currentSavedHelmProfile = daemonProfiles.find(
    (profile) =>
      daemonProfileKey(profile.host, profile.port) === currentHelmKey,
  );
  const additionalHelmCards = isEmbeddedHelmDeck
    ? []
    : [
        ...daemonProfiles
          .filter(
            (profile) =>
              daemonProfileKey(profile.host, profile.port) !== currentHelmKey,
          )
          .map((profile) => ({
            key: daemonProfileKey(profile.host, profile.port),
            name: profile.name,
            host: profile.host,
            port: profile.port,
            isCurrent: false,
            profile,
          })),
      ];
  const rawHelmCards = [
    {
      key: currentHelmKey,
      name: currentSavedHelmProfile?.name || "Local Helm",
      host: daemonHost.trim() || defaultDaemonHost,
      port: daemonPort.trim() || defaultDaemonPort,
      isCurrent: true,
      profile: null as DaemonProfile | null,
    },
    ...additionalHelmCards,
  ];
  const helmCards = dedupeHelmCards(rawHelmCards);
  const selectedKey = selectedHelmKey || currentHelmKey;
  const selectedHelm =
    helmCards.find((helm) => helm.key === selectedKey) ?? helmCards[0];
  if (!selectedHelm) {
    return null;
  }
  const selectedHelmIsCurrent = selectedHelm.key === currentHelmKey;
  const selectedHelmConnection = resolveHelmConnectionState(
    selectedHelm,
    currentHelmKey,
    connection,
    helmConnectionStates,
  );
  const selectedHelmIsConnected = selectedHelmConnection === "connected";
  const selectedHelmInventory = helmInventories[selectedHelm.key];
  const selectedHelmTrustedDevices = selectedHelmIsCurrent
    ? trustedDevices
    : (selectedHelmInventory?.trustedDevices ?? []);
  const selectedHelmProjects = selectedHelmIsCurrent
    ? projects
    : (selectedHelmInventory?.projects ?? []);
  const selectedHelmAgents = selectedHelmIsCurrent
    ? agents
    : (selectedHelmInventory?.agents ?? []);
  const selectedHelmWorkspaces = selectedHelmIsCurrent
    ? workspaces
    : (selectedHelmInventory?.workspaces ?? []);
  const selectedHelmSocket = selectedHelmIsCurrent
    ? socketRef.current
    : (helmSocketRefs.current.get(selectedHelm.key) ?? null);
  const selectedHelmSummary = configuredHelms.find(
    (helm) =>
      helm.host === selectedHelm.host &&
      String(helm.port) === selectedHelm.port,
  );
  const selectedHelmId =
    selectedHelmSummary?.id ?? slugify(selectedHelm.name || selectedHelm.key);
  const selectedHelmSavedProfile =
    daemonProfiles.find(
      (profile) =>
        daemonProfileKey(profile.host, profile.port) === selectedHelm.key,
    ) ?? null;
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
        <section className="note-box compact-note fleet-card helm-detail-panel helm-detail-panel-expanded">
          <div className="section-head section-head-soft">
            <div>
              <strong>{selectedHelm.name}</strong>
              <p className="muted compact">
                {selectedHelm.host}:{selectedHelm.port} ·
                <span
                  className={`helm-inline-status helm-inline-status-${selectedHelmConnection}`}
                >
                  {formatConnectionStatus(selectedHelmConnection)}
                </span>
              </p>
            </div>
            <HelmActions
              connectDaemonProfile={connectDaemonProfile}
              connectToDaemon={connectToDaemon}
              helmSocketRefs={helmSocketRefs}
              isEmbeddedHelmDeck={isEmbeddedHelmDeck}
              lastFilesScopeKeyRef={lastFilesScopeKeyRef}
              manualDisconnectRef={manualDisconnectRef}
              selectedHelm={selectedHelm}
              selectedHelmConnection={selectedHelmConnection}
              selectedHelmIsConnected={selectedHelmIsConnected}
              selectedHelmIsCurrent={selectedHelmIsCurrent}
              selectedHelmSavedProfile={selectedHelmSavedProfile}
              setConnection={setConnection}
              setHelmConnectionState={setHelmConnectionState}
              setPendingHelmDeleteProfile={setPendingHelmDeleteProfile}
              socketRef={socketRef}
            />
          </div>
          <div className="helm-detail-facts" aria-label="Helm 配置范围">
            <span>
              <strong>{selectedHelmProjects.length}</strong> 项目配置
            </span>
            <span>
              <strong>{selectedHelmAgents.length}</strong> ACP 舰员
            </span>
            <span>
              <strong>{selectedHelmWorkspaces.length}</strong> 分支
            </span>
          </div>
          <div className="helm-inventory-list-stack">
            <ProjectInventorySection
              connected={selectedHelmIsConnected}
              draft={fleetProjectDraft}
              formOpen={fleetProjectFormOpen}
              requestCounter={requestCounter}
              selectedHelmAgents={selectedHelmAgents}
              selectedHelmId={selectedHelmId}
              selectedHelmProjects={selectedHelmProjects}
              selectedHelmSocket={selectedHelmSocket}
              selectedHelmWorkspaces={selectedHelmWorkspaces}
              setDraft={setFleetProjectDraft}
              setFormOpen={setFleetProjectFormOpen}
              setSaveMessage={setFleetProjectSaveMessage}
            />
            {fleetProjectSaveMessage ? (
              <p className="muted compact helm-inline-save-message">
                {fleetProjectSaveMessage}
              </p>
            ) : null}
            <AgentInventorySection
              connected={selectedHelmIsConnected}
              draft={fleetAgentDraft}
              emptyLabel={copy.noAgents}
              formOpen={fleetAgentFormOpen}
              requestCounter={requestCounter}
              selectedHelmAgents={selectedHelmAgents}
              selectedHelmSocket={selectedHelmSocket}
              setDraft={setFleetAgentDraft}
              setFormOpen={setFleetAgentFormOpen}
            />
          </div>
          {renderTrustedDevicesPanel(
            selectedHelmTrustedDevices,
            selectedHelmSocket,
            selectedHelm.name,
          )}
        </section>
      </section>
    </section>
  );
}
