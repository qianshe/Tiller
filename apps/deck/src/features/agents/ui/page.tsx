import {
  useState,
  type Dispatch,
  type FormEvent,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from "react";
import type {
  AcpAgentProvider,
  HelmSummary,
  ProjectSummary,
  TrustedDeviceSummary,
  WorktreeSummary,
} from "@tiller/shared";
import type { DaemonProfile, DeckRpcClient, DispatchToHelm } from "../../helm-connection/facade";
import type { ProjectFilesEntry } from "../../mission/facade";
import type { Locale, UI_COPY } from "../../../shared/utils/copy";
import { AgentsTree } from "./agents-tree";
import { DeleteHelmConfigDialog } from "./delete-helm-config-dialog";
import { FleetAddHelmDialog } from "./fleet-add-helm-dialog";
import { HelmDetailSection } from "./helm-detail-section";
import type { FleetAgentDraft } from "./agent-inventory-section";
import type { FleetProjectDraft } from "./project-inventory-section";
import { DashboardAgentsWorkspace } from "./dashboard-workspace";
import {
  resolveHelmConnectionState,
  resolveHelmInventoryCounts,
} from "../utils/fleet-helpers";
import {
  resolveHelmSelection,
  type ConnectionState,
  type HelmInventoryBucket,
} from "../utils/helm-selection";
type PairingState = "idle" | "waiting" | "input" | "paired" | "rejected";
type AgentsPageProps = {
  mode?: "standalone" | "dashboard";
  daemonHost: string;
  daemonPort: string;
  initialTab?: "agents" | "projects";
  defaultDaemonHost: string;
  defaultDaemonPort: string;
  isEmbeddedHelmDeck: boolean;
  daemonProfiles: DaemonProfile[];
  selectedHelmKey: string;
  connection: ConnectionState;
  helmConnectionStates: Record<string, ConnectionState>;
  helmInventories: Record<string, HelmInventoryBucket>;
  projectFilesByScope: Record<string, ProjectFilesEntry>;
  trustedDevices: TrustedDeviceSummary[];
  projects: ProjectSummary[];
  agents: AcpAgentProvider[];
  worktrees: WorktreeSummary[];
  socketRef: MutableRefObject<WebSocket | null>;
  rpcClientRef: MutableRefObject<DeckRpcClient | null>;
  helmSocketRefs: MutableRefObject<Map<string, WebSocket>>;
  helmRpcClientRefs: MutableRefObject<Map<string, DeckRpcClient>>;
  dispatch: DispatchToHelm;
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
  isMobile?: boolean;
};
export function AgentsPage({
  mode = "standalone",
  daemonHost,
  daemonPort,
  initialTab = "agents",
  defaultDaemonHost,
  defaultDaemonPort,
  isEmbeddedHelmDeck,
  daemonProfiles,
  selectedHelmKey,
  connection,
  helmConnectionStates,
  helmInventories,
  projectFilesByScope,
  trustedDevices,
  projects,
  agents,
  worktrees,
  socketRef,
  rpcClientRef,
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
  isMobile = false,
}: AgentsPageProps) {
  const [mobileScreen, setMobileScreen] = useState<"list" | "detail">("list");
  const [dashboardScreen, setDashboardScreen] = useState<"list" | "detail">("list");

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
    worktrees,
    configuredHelms,
    socket: socketRef.current,
    helmSockets: helmSocketRefs.current,
    rpcClient: rpcClientRef.current,
    helmRpcClients: helmRpcClientRefs.current,
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
    selectedHelmRpcClient,
    selectedHelmTrustedDevices,
    selectedHelmWorktrees,
  } = helmSelection;

  const handleSelectHelmKey = (key: string) => {
    setSelectedHelmKey(key);
    if (isMobile) {
      setMobileScreen("detail");
    }
  };

  const selectedHelmCounts = {
    agents: selectedHelmAgents.length,
    projects: selectedHelmProjects.length,
    worktrees: selectedHelmWorktrees.length,
  };
  const dashboardHelms = helmCards.map((helm) => ({
    key: helm.key,
    name: helm.name,
    endpoint: `${helm.host}:${helm.port}`,
    connection: resolveHelmConnectionState(
      helm,
      currentHelmKey,
      connection,
      helmConnectionStates,
    ),
    counts: resolveHelmInventoryCounts({
      helmKey: helm.key,
      selectedHelmKey: selectedHelm.key,
      selectedCounts: selectedHelmCounts,
      inventory: helmInventories[helm.key],
    }),
  }));

  const renderHelmDetail = ({
    detailIsMobile = false,
    onBack,
  }: {
    detailIsMobile?: boolean;
    onBack?: () => void;
  } = {}) => (
    <HelmDetailSection
      selectedHelm={selectedHelm}
      selectedHelmConnection={selectedHelmConnection}
      selectedHelmIsConnected={selectedHelmIsConnected}
      selectedHelmIsCurrent={selectedHelmIsCurrent}
      selectedHelmSavedProfile={selectedHelmSavedProfile}
      selectedHelmProjects={selectedHelmProjects}
      selectedHelmAgents={selectedHelmAgents}
      selectedHelmWorktrees={selectedHelmWorktrees}
      projectFilesByScope={projectFilesByScope}
      selectedHelmSocket={selectedHelmSocket}
      selectedHelmRpcClient={selectedHelmRpcClient}
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
      dispatch={dispatch}
      copy={copy}
      renderTrustedDevicesPanel={renderTrustedDevicesPanel}
      isMobile={detailIsMobile}
      initialTab={initialTab}
      onBack={onBack}
    />
  );

  return (
    <section
      className={`agents-fleet-shell agents-v6-page w-full min-w-0 ${
        mode === "dashboard"
          ? "flex h-full min-h-0 flex-col overflow-hidden bg-canvas"
          : isMobile
            ? "flex h-screen flex-col bg-canvas p-1"
            : "grid h-screen grid-cols-[260px_minmax(0,1fr)] gap-1 bg-canvas p-1"
      }`}
      data-testid="agents-page"
      data-agents-mode={mode}
    >
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
      {mode === "dashboard" ? (
        <DashboardAgentsWorkspace
          screen={dashboardScreen}
          helms={dashboardHelms}
          detail={renderHelmDetail({
            detailIsMobile: isMobile,
            onBack: () => setDashboardScreen("list"),
          })}
          onSelectHelm={(key) => {
            setSelectedHelmKey(key);
            setDashboardScreen("detail");
          }}
          onAddHelm={openFleetAddHelmModal}
        />
      ) : isMobile ? (
        mobileScreen === "list" ? (
          <AgentsTree
            connection={connection}
            currentHelmKey={currentHelmKey}
            helmCards={helmCards}
            helmConnectionStates={helmConnectionStates}
            helmInventories={helmInventories}
            isEmbeddedHelmDeck={isEmbeddedHelmDeck}
            onAddHelm={openFleetAddHelmModal}
            selectedHelm={selectedHelm}
            selectedHelmCounts={selectedHelmCounts}
            setSelectedHelmKey={handleSelectHelmKey}
            isMobile={true}
          />
        ) : (
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {renderHelmDetail({
              detailIsMobile: true,
              onBack: () => setMobileScreen("list"),
            })}
          </div>
        )
      ) : (
        <div className="contents">
          <AgentsTree
            connection={connection}
            currentHelmKey={currentHelmKey}
            helmCards={helmCards}
            helmConnectionStates={helmConnectionStates}
            helmInventories={helmInventories}
            isEmbeddedHelmDeck={isEmbeddedHelmDeck}
            onAddHelm={openFleetAddHelmModal}
            selectedHelm={selectedHelm}
            selectedHelmCounts={selectedHelmCounts}
            setSelectedHelmKey={setSelectedHelmKey}
          />
          <div className="min-h-0 min-w-0 overflow-hidden">
            {renderHelmDetail()}
          </div>
        </div>
      )}
    </section>
  );
}
