import type {
  AcpAgentProvider,
  ProjectSummary,
  TrustedDeviceSummary,
  WorktreeSummary,
} from "@tiller/shared";
import type {
  Dispatch,
  FormEvent,
  MutableRefObject,
  ReactNode,
  SetStateAction,
} from "react";
import { useState } from "react";
import { Badge, Button, Icon, StatusDot } from "@/shared/ui";
import {
  type DaemonProfile,
  type DeckRpcClient,
  type DispatchToHelm,
} from "../../helm-connection/facade";
import { projectFilesKey, type ProjectFilesEntry } from "../../mission/facade";
import type { Locale, UI_COPY } from "../../../shared/utils/copy";
import {
  AgentInventorySection,
  type FleetAgentDraft,
} from "./agent-inventory-section";
import { HelmActions } from "./helm-actions";
import type { HelmCard } from "./helm-hub";
import { InventoryTable } from "./inventory-table";
import {
  ProjectInventorySection,
  type FleetProjectDraft,
} from "./project-inventory-section";

type ConnectionState = "connecting" | "connected" | "disconnected";
type ProjectDirectoryListResult = {
  ok: boolean;
  directories: string[];
};

type HelmDetailSectionProps = {
  selectedHelm: HelmCard;
  selectedHelmConnection: ConnectionState;
  selectedHelmIsConnected: boolean;
  selectedHelmIsCurrent: boolean;
  selectedHelmSavedProfile: DaemonProfile | null;
  selectedHelmProjects: ProjectSummary[];
  selectedHelmAgents: AcpAgentProvider[];
  selectedHelmWorktrees: WorktreeSummary[];
  projectFilesByScope: Record<string, ProjectFilesEntry>;
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
  isMobile?: boolean;
  onBack?: () => void;
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
  selectedHelmWorktrees,
  projectFilesByScope,
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
  isMobile = false,
  onBack,
}: HelmDetailSectionProps) {
  const [activeTab, setActiveTab] = useState<"agents" | "projects" | "devices" | "worktrees" | "logs">("agents");
  const [projectPathCandidates, setProjectPathCandidates] = useState<string[]>([]);
  const tabs = [
    { id: "agents", label: `Agents (${selectedHelmAgents.length})` },
    { id: "projects", label: `项目 (${selectedHelmProjects.length})` },
    { id: "devices", label: `可信设备 (${selectedHelmTrustedDevices.length})` },
    { id: "worktrees", label: `工作区 (${selectedHelmWorktrees.length})` },
    { id: "logs", label: "日志" },
  ] as const;
  const summaryFileProject = fleetProjectDraft.id
    ? selectedHelmProjects.find((project) => project.id === fleetProjectDraft.id)
    : undefined;
  const summaryFileCwd = fleetProjectDraft.path.trim() || summaryFileProject?.path;
  const summaryFileScopeKey = summaryFileProject
    ? projectFilesKey(summaryFileProject.id, summaryFileCwd)
    : undefined;
  const summaryFileCandidates = summaryFileScopeKey
    ? projectFilesByScope[summaryFileScopeKey]?.files ?? []
    : [];

  function requestSummaryFileCandidates(project: ProjectSummary) {
    if (!selectedHelmRpcClient) {
      return;
    }
    void dispatch(selectedHelmRpcClient, "project/list_files", {
      projectId: project.id,
      cwd: project.path,
    });
  }

  function requestProjectPathCandidates(path: string) {
    const query = path.trim();
    if (!selectedHelmRpcClient || !query) {
      setProjectPathCandidates([]);
      return;
    }
    const requestId = requestCounter.current + 1;
    requestCounter.current = requestId;
    void dispatch(
      selectedHelmRpcClient,
      "project/list_directories",
      { path: query },
      {
        onResult: (_method, result) => {
          if (requestCounter.current !== requestId || !isProjectDirectoryListResult(result)) {
            return;
          }
          setProjectPathCandidates(result.ok ? result.directories : []);
        },
      },
    );
  }

  return (
    <section className="wb-pane flex h-full min-h-0 flex-col overflow-hidden">
      <div className="wb-pane-head">
        {isMobile && onBack && (
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            onClick={onBack}
            title="返回"
            className="-ml-1 mr-1"
          >
            <Icon name="chevronLeft" size={12} />
          </Button>
        )}
        <Icon name="server" size={12} className="text-muted-foreground" />
        <span className="font-mono text-2xs tabular text-foreground">{selectedHelm.name}</span>
        <StatusDot
          tone={selectedHelmIsConnected ? "active" : selectedHelmConnection === "connecting" ? "primary" : "idle"}
          pulse={selectedHelmIsConnected || selectedHelmConnection === "connecting"}
          size={5}
        />
        <span className="font-mono text-meta tabular text-muted-foreground">
          {selectedHelm.host}:{selectedHelm.port}
        </span>
        <div className="flex-1" />
        <HelmActions
          connectDaemonProfile={connectDaemonProfile}
          connectToDaemon={connectToDaemon}
          dispatch={dispatch}
          helmSocketRefs={helmSocketRefs}
          isEmbeddedHelmDeck={isEmbeddedHelmDeck}
          lastFilesScopeKeyRef={lastFilesScopeKeyRef}
          manualDisconnectRef={manualDisconnectRef}
          selectedHelm={selectedHelm}
          selectedHelmConnection={selectedHelmConnection}
          selectedHelmIsConnected={selectedHelmIsConnected}
          selectedHelmIsCurrent={selectedHelmIsCurrent}
          selectedHelmRpcClient={selectedHelmRpcClient}
          selectedHelmSavedProfile={selectedHelmSavedProfile}
          setConnection={setConnection}
          setHelmConnectionState={setHelmConnectionState}
          setPendingHelmDeleteProfile={setPendingHelmDeleteProfile}
          socketRef={socketRef}
        />
      </div>

      <div className="flex items-center gap-px overflow-x-auto border-b border-border-ghost px-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`h-7 whitespace-nowrap px-2 text-action ${
              activeTab === tab.id
                ? "-mb-px border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {activeTab === "agents" ? (
          <div className="grid gap-3">
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
          </div>
        ) : null}

        {activeTab === "projects" ? (
          <div className="grid gap-3">
            <ProjectInventorySection
              connected={selectedHelmIsConnected}
              draft={fleetProjectDraft}
              formOpen={fleetProjectFormOpen}
              dispatch={dispatch}
              selectedHelmAgents={selectedHelmAgents}
              selectedHelmId={selectedHelmId}
              selectedHelmProjects={selectedHelmProjects}
              selectedHelmRpcClient={selectedHelmRpcClient}
              selectedHelmWorktrees={selectedHelmWorktrees}
              setDraft={setFleetProjectDraft}
              setFormOpen={setFleetProjectFormOpen}
              setSaveMessage={setFleetProjectSaveMessage}
              projectPathCandidates={projectPathCandidates}
              requestProjectPathCandidates={requestProjectPathCandidates}
              summaryFileCandidates={summaryFileCandidates}
              requestSummaryFileCandidates={requestSummaryFileCandidates}
            />
            {fleetProjectSaveMessage ? (
              <p className="m-0 pl-0.5 text-sm text-muted-foreground">{fleetProjectSaveMessage}</p>
            ) : null}
          </div>
        ) : null}

        {activeTab === "devices" ? renderTrustedDevicesPanel(selectedHelmTrustedDevices, selectedHelmSocket, selectedHelm.name) : null}

        {activeTab === "worktrees" ? (
          <InventoryTable
            title="工作区"
            countLabel={`${selectedHelmWorktrees.length}`}
            rows={selectedHelmWorktrees.map((worktree) => ({
              key: worktree.path,
              icon: <Icon name="branch" size={12} className="text-muted-foreground" />,
              title: worktree.branch || "worktree",
              subtitle: worktree.path,
              badge: <Badge variant="secondary">工作区</Badge>,
            }))}
            emptyLabel={`${selectedHelm.name} 暂无工作区。`}
          />
        ) : null}

        {activeTab === "logs" ? (
          <section className="grid min-h-32 place-items-center rounded bg-surface-sunken px-4 text-sm text-muted-foreground">
            Helm 日志仍由现有连接与诊断面板提供；此处保留 v6 标签入口。
          </section>
        ) : null}
      </div>
    </section>
  );
}

function isProjectDirectoryListResult(result: unknown): result is ProjectDirectoryListResult {
  return (
    result !== null &&
    typeof result === "object" &&
    "ok" in result &&
    typeof result.ok === "boolean" &&
    "directories" in result &&
    Array.isArray(result.directories) &&
    result.directories.every((directory) => typeof directory === "string")
  );
}
