import { Badge, Card, CardContent, CardHeader } from "@/shared/ui";
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
  type DeckRpcClient,
  type DispatchToHelm,
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
  selectedHelmRpcClient: DeckRpcClient | null;
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
  dispatch: DispatchToHelm;
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
  selectedHelmRpcClient,
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
  dispatch,
  copy,
  renderTrustedDevicesPanel,
}: HelmDetailSectionProps) {
  return (
    <Card className="grid min-h-[520px] gap-5 p-5 shadow-card">
      <CardHeader className="flex-row items-start justify-between gap-4 border-b border-border-ghost p-0 pb-3">
        <div>
          <strong className="text-base font-semibold text-foreground">{selectedHelm.name}</strong>
          <p className="m-0 text-sm text-muted-foreground">
            {selectedHelm.host}:{selectedHelm.port} · {formatConnectionStatus(selectedHelmConnection)}
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
      </CardHeader>
      <div className="flex flex-wrap gap-2" aria-label="Helm 配置范围">
        <Badge variant="secondary">
          <strong>{selectedHelmProjects.length}</strong> 项目配置
        </Badge>
        <Badge variant="secondary">
          <strong>{selectedHelmAgents.length}</strong> ACP 舰员
        </Badge>
        <Badge variant="secondary">
          <strong>{selectedHelmWorkspaces.length}</strong> 分支
        </Badge>
      </div>
      <CardContent className="grid gap-4 p-0 lg:grid-cols-2 lg:items-start lg:gap-x-12">
        <ProjectInventorySection
          connected={selectedHelmIsConnected}
          draft={fleetProjectDraft}
          formOpen={fleetProjectFormOpen}
          dispatch={dispatch}
          selectedHelmAgents={selectedHelmAgents}
          selectedHelmId={selectedHelmId}
          selectedHelmProjects={selectedHelmProjects}
          selectedHelmRpcClient={selectedHelmRpcClient}
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
          dispatch={dispatch}
          selectedHelmAgents={selectedHelmAgents}
          selectedHelmRpcClient={selectedHelmRpcClient}
          setDraft={setFleetAgentDraft}
          setFormOpen={setFleetAgentFormOpen}
        />
      </CardContent>
      {renderTrustedDevicesPanel(
        selectedHelmTrustedDevices,
        selectedHelmSocket,
        selectedHelm.name,
      )}
    </Card>
  );
}
