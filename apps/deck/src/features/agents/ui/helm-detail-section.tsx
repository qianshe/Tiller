import type {
  AcpAgentProvider,
  ProjectSummary,
  TrustedDeviceSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import type {
  Dispatch,
  FormEvent,
  MutableRefObject,
  ReactNode,
  SetStateAction,
} from "react";
import {
  formatConnectionStatus,
  type DaemonProfile,
} from "../../helm-connection/facade";
import type { Locale, UI_COPY } from "../../../shared/utils/copy";
import {
  AgentInventorySection,
  type FleetAgentDraft,
} from "./agent-inventory-section";
import { HelmActions } from "./helm-actions";
import type { HelmCard } from "./helm-hub";
import {
  ProjectInventorySection,
  type FleetProjectDraft,
} from "./project-inventory-section";

type ConnectionState = "connecting" | "connected" | "disconnected";

type HelmDetailSectionProps = {
  selectedHelm: HelmCard;
  selectedHelmConnection: ConnectionState;
  selectedHelmIsConnected: boolean;
  selectedHelmIsCurrent: boolean;
  selectedHelmSavedProfile: DaemonProfile | null;
  selectedHelmProjects: ProjectSummary[];
  selectedHelmAgents: AcpAgentProvider[];
  selectedHelmWorkspaces: WorkspaceSummary[];
  selectedHelmSocket: WebSocket | null;
  selectedHelmId: string;
  selectedHelmTrustedDevices: TrustedDeviceSummary[];
  socketRef: MutableRefObject<WebSocket | null>;
  helmSocketRefs: MutableRefObject<Map<string, WebSocket>>;
  isEmbeddedHelmDeck: boolean;
  manualDisconnectRef: MutableRefObject<string | null>;
  lastFilesScopeKeyRef: MutableRefObject<string | null>;
  setConnection: Dispatch<SetStateAction<ConnectionState>>;
  setHelmConnectionState: (profileKey: string, state: ConnectionState) => void;
  setPendingHelmDeleteProfile: Dispatch<SetStateAction<DaemonProfile | null>>;
  connectDaemonProfile: (profile: DaemonProfile) => void;
  connectToDaemon: (
    event?: FormEvent<HTMLFormElement>,
    options?: { preserveState?: boolean },
  ) => Promise<void> | void;
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

/**
 * Renders the selected Helm details, actions, inventory, and trusted devices.
 */
export function HelmDetailSection({
  selectedHelm,
  selectedHelmConnection,
  selectedHelmIsConnected,
  selectedHelmIsCurrent,
  selectedHelmSavedProfile,
  selectedHelmProjects,
  selectedHelmAgents,
  selectedHelmWorkspaces,
  selectedHelmSocket,
  selectedHelmId,
  selectedHelmTrustedDevices,
  socketRef,
  helmSocketRefs,
  isEmbeddedHelmDeck,
  manualDisconnectRef,
  lastFilesScopeKeyRef,
  setConnection,
  setHelmConnectionState,
  setPendingHelmDeleteProfile,
  connectDaemonProfile,
  connectToDaemon,
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
}: HelmDetailSectionProps) {
  return (
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
  );
}
