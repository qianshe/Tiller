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
import {
  createProjectId,
  dedupeHelmCards,
  defaultAgentId,
  dispatch,
  nextRequestId,
  resolveHelmConnectionState,
  resolveProjectDisplayId,
  resolveProjectWorkspaceLabel,
  slugify,
} from "../utils/agents-utils";

type ConnectionState = "connecting" | "connected" | "disconnected";
type PairingState = "idle" | "waiting" | "input" | "paired" | "rejected";
type HelmInventoryBucket = {
  projects: ProjectSummary[];
  workspaces: WorkspaceSummary[];
  agents: AcpAgentProvider[];
  sessions: SessionSummary[];
  trustedDevices: TrustedDeviceSummary[];
};
type HelmCard = {
  key: string;
  name: string;
  host: string;
  port: string;
  isCurrent: boolean;
  profile: DaemonProfile | null;
};
type FleetProjectDraft = { name: string; path: string };
type FleetAgentDraft = { name: string; command: string; args: string[] };

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
  setSelectedHelmKey: Dispatch<SetStateAction<string>>;
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
            reconnect={() =>
              connectToDaemon(undefined, {
                preserveState: true,
              })
            }
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

          <section className="fleet-hub" aria-label="舰队 Helm 节点">
            <div className="fleet-hub-head">
              <div>
                <div className="fleet-hub-title-row">
                  <h3>Helm</h3>
                  <span>{helmCards.length} Helm</span>
                </div>
              </div>
              {!isEmbeddedHelmDeck ? (
                <button
                  className="primary"
                  type="button"
                  onClick={openFleetAddHelmModal}
                >
                  添加
                </button>
              ) : null}
            </div>

            <p className="fleet-hub-copy">
              {isEmbeddedHelmDeck
                ? "当前内置 Deck 只管理这个 Helm；多 Helm 控制台由公版 Web 承载。"
                : "管理多个 Helm 节点；选择后查看项目、ACP 舰员与信标。"}
            </p>

            <div
              className="fleet-hub-node-list"
              role="list"
              aria-label="Helm 节点列表"
            >
              {helmCards.map((helm) => (
                <button
                  className={`fleet-hub-node ${selectedHelm.key === helm.key ? "active" : ""}`}
                  key={helm.key}
                  type="button"
                  role="listitem"
                  onClick={() => setSelectedHelmKey(helm.key)}
                  aria-pressed={selectedHelm.key === helm.key}
                  title={`${helm.name} · ${helm.host}:${helm.port}`}
                >
                  <span
                    className={`helm-status-dot helm-status-${resolveHelmConnectionState(helm, currentHelmKey, connection, helmConnectionStates)}`}
                    aria-hidden="true"
                  />
                  <span>{helm.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="note-box compact-note fleet-card helm-detail-panel helm-detail-panel-expanded">
            <div className="section-head section-head-soft">
              <div>
                <strong>{selectedHelm.name}</strong>
                <p className="muted compact">
                  {selectedHelm.host}:{selectedHelm.port} ·{" "}
                  <span
                    className={`helm-inline-status helm-inline-status-${selectedHelmConnection}`}
                  >
                    {formatConnectionStatus(selectedHelmConnection)}
                  </span>
                </p>
              </div>
              <div className="section-actions">
                {selectedHelmIsConnected ? (
                  <button
                    className="secondary helm-disconnect-button"
                    type="button"
                    onClick={() => {
                      manualDisconnectRef.current = selectedHelm.key;
                      if (selectedHelmIsCurrent) {
                        socketRef.current?.close();
                        socketRef.current = null;
                        setConnection("disconnected");
                        // 手动断开当前 Helm 后，project files 缓存应失效，避免重连后使用过期数据。
                        lastFilesScopeKeyRef.current = null;
                        setHelmConnectionState(
                          selectedHelm.key,
                          "disconnected",
                        );
                        return;
                      }
                      helmSocketRefs.current.get(selectedHelm.key)?.close();
                      helmSocketRefs.current.delete(selectedHelm.key);
                      setHelmConnectionState(selectedHelm.key, "disconnected");
                    }}
                  >
                    断开连接
                  </button>
                ) : selectedHelmConnection === "connecting" ? (
                  <span className="helm-state-chip helm-state-connecting">
                    连接中
                  </span>
                ) : (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      if (selectedHelm.profile) {
                        connectDaemonProfile(selectedHelm.profile);
                        return;
                      }
                      void connectToDaemon(undefined, { preserveState: true });
                    }}
                  >
                    连接 Helm
                  </button>
                )}
                {selectedHelmSavedProfile && !isEmbeddedHelmDeck ? (
                  <button
                    className="secondary helm-destroy-button"
                    type="button"
                    onClick={() =>
                      setPendingHelmDeleteProfile(selectedHelmSavedProfile)
                    }
                    title="仅删除 Deck 前端保存的 Helm 配置，不销毁远端 Helm 进程或后端配置"
                  >
                    删除配置
                  </button>
                ) : null}
              </div>
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
              <section className="helm-inventory-list-section">
                <div className="helm-inventory-section-head">
                  <h3>项目列表</h3>
                  <button
                    className="secondary helm-list-add-button"
                    type="button"
                    disabled={!selectedHelmIsConnected}
                    aria-label="添加项目"
                    title="添加项目"
                    onClick={() =>
                      setFleetProjectFormOpen((current) => !current)
                    }
                  >
                    +
                  </button>
                </div>
                {fleetProjectFormOpen ? (
                  <form
                    className="helm-inline-add-form helm-inline-add-form-project"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (
                        !selectedHelmSocket ||
                        !fleetProjectDraft.path.trim()
                      ) {
                        return;
                      }
                      const projectPath = fleetProjectDraft.path
                        .trim()
                        .replace(/\\/g, "/");
                      const fallbackProjectName =
                        projectPath.split("/").filter(Boolean).at(-1) ??
                        projectPath;
                      const projectName =
                        fleetProjectDraft.name.trim() || fallbackProjectName;
                      const projectId = createProjectId(selectedHelmProjects);
                      const workspaceId = `${projectId}-workspace`;
                      setFleetProjectSaveMessage(
                        `正在保存项目：${projectName}...`,
                      );
                      dispatch(selectedHelmSocket, {
                        type: "project.save",
                        requestId: nextRequestId(requestCounter),
                        project: {
                          id: projectId,
                          name: projectName,
                          helmId: selectedHelmId,
                          path: projectPath,
                          workspaceIds: [workspaceId],
                          defaultWorkspaceId: workspaceId,
                          defaultAgentId:
                            defaultAgentId(selectedHelmAgents) ?? undefined,
                        },
                      });
                      setFleetProjectDraft({ name: "", path: "" });
                      setFleetProjectFormOpen(false);
                    }}
                  >
                    <input
                      value={fleetProjectDraft.name}
                      onChange={(event) =>
                        setFleetProjectDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="项目名称，例如 Tiller"
                    />
                    <input
                      value={fleetProjectDraft.path}
                      onChange={(event) =>
                        setFleetProjectDraft((current) => ({
                          ...current,
                          path: event.target.value,
                        }))
                      }
                      placeholder="项目路径，例如 D:/projects/my-app"
                    />
                    <button
                      className="primary"
                      type="submit"
                      disabled={!fleetProjectDraft.path.trim()}
                    >
                      保存项目
                    </button>
                  </form>
                ) : null}
                {fleetProjectSaveMessage ? (
                  <p className="muted compact helm-inline-save-message">
                    {fleetProjectSaveMessage}
                  </p>
                ) : null}
                {selectedHelmProjects.length ? (
                  <ul className="helm-simple-list">
                    {selectedHelmProjects.map((project) => (
                      <li key={project.id}>
                        <details className="helm-simple-detail-row">
                          <summary>
                            <strong>{project.name}</strong>
                            <span>
                              {project.path
                                ? `路径 · ${project.path}`
                                : `项目 · ${project.id}`}
                            </span>
                          </summary>
                          <dl>
                            <div>
                              <dt>Project ID</dt>
                              <dd>
                                {resolveProjectDisplayId(
                                  project,
                                  selectedHelmProjects,
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>Path</dt>
                              <dd>{project.path ?? "-"}</dd>
                            </div>
                            <div>
                              <dt>Helm ID</dt>
                              <dd>{project.helmId}</dd>
                            </div>
                            <div>
                              <dt>默认分支</dt>
                              <dd>
                                {resolveProjectWorkspaceLabel(
                                  project,
                                  selectedHelmWorkspaces,
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>Default Agent</dt>
                              <dd>{project.defaultAgentId ?? "-"}</dd>
                            </div>
                          </dl>
                        </details>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="empty-state">
                    {selectedHelmIsConnected
                      ? "当前 Helm 暂无项目数据"
                      : "请先连接该 Helm 后加载项目"}
                  </div>
                )}
              </section>

              <section className="helm-inventory-list-section">
                <div className="helm-inventory-section-head">
                  <h3>ACP 舰员</h3>
                  <div className="helm-section-actions-inline">
                    <button
                      className="secondary helm-list-add-button"
                      type="button"
                      disabled={!selectedHelmIsConnected}
                      aria-label="添加 ACP"
                      title="添加 ACP"
                      onClick={() =>
                        setFleetAgentFormOpen((current) => !current)
                      }
                    >
                      +
                    </button>
                  </div>
                </div>
                {fleetAgentFormOpen ? (
                  <form
                    className="helm-inline-add-form helm-inline-add-form-agent"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (
                        !selectedHelmSocket ||
                        !fleetAgentDraft.command.trim()
                      ) {
                        return;
                      }
                      const providerId = slugify(
                        fleetAgentDraft.name || fleetAgentDraft.command,
                      );
                      const agentArgs = fleetAgentDraft.args
                        .map((item) => item.trim())
                        .filter(Boolean);
                      dispatch(selectedHelmSocket, {
                        type: "agent.save",
                        requestId: nextRequestId(requestCounter),
                        provider: {
                          id: providerId,
                          name: fleetAgentDraft.name.trim() || providerId,
                          kind: "custom",
                          command: fleetAgentDraft.command.trim(),
                          args: agentArgs,
                          installHint: `请确认命令 \`${[fleetAgentDraft.command.trim(), ...agentArgs].join(" ")}\` 可以在终端运行。`,
                        },
                      });
                      setFleetAgentDraft({ name: "", command: "", args: [""] });
                      setFleetAgentFormOpen(false);
                    }}
                  >
                    <div className="helm-agent-core-row">
                      <input
                        value={fleetAgentDraft.name}
                        onChange={(event) =>
                          setFleetAgentDraft((current) => ({
                            ...current,
                            name: event.target.value,
                          }))
                        }
                        placeholder="舰员名称"
                      />
                      <input
                        value={fleetAgentDraft.command}
                        onChange={(event) =>
                          setFleetAgentDraft((current) => ({
                            ...current,
                            command: event.target.value,
                          }))
                        }
                        placeholder="command"
                      />
                      <button
                        className="primary"
                        type="submit"
                        disabled={!fleetAgentDraft.command.trim()}
                      >
                        保存 ACP
                      </button>
                    </div>
                    <div className="helm-agent-args-column">
                      <div className="helm-agent-args-head">
                        <span>args 数组</span>
                        <button
                          className="secondary helm-arg-action-button"
                          type="button"
                          onClick={() =>
                            setFleetAgentDraft((current) => ({
                              ...current,
                              args: [...current.args, ""],
                            }))
                          }
                        >
                          + 参数
                        </button>
                      </div>
                      {fleetAgentDraft.args.map((arg, index) => (
                        <div
                          className="helm-agent-arg-row"
                          key={`fleet-agent-arg-${index}`}
                        >
                          <span className="helm-agent-arg-index">
                            args[{index}]
                          </span>
                          <input
                            value={arg}
                            onChange={(event) =>
                              setFleetAgentDraft((current) => ({
                                ...current,
                                args: current.args.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? event.target.value
                                    : item,
                                ),
                              }))
                            }
                            placeholder={index === 0 ? "acp" : "--pure"}
                          />
                          <button
                            className="secondary helm-arg-icon-button"
                            type="button"
                            aria-label={`删除第 ${index + 1} 个参数`}
                            title="删除参数"
                            onClick={() =>
                              setFleetAgentDraft((current) => ({
                                ...current,
                                args:
                                  current.args.length > 1
                                    ? current.args.filter(
                                        (_, itemIndex) => itemIndex !== index,
                                      )
                                    : [""],
                              }))
                            }
                          >
                            −
                          </button>
                        </div>
                      ))}
                    </div>
                  </form>
                ) : null}
                {selectedHelmAgents.length ? (
                  <ul className="helm-simple-list">
                    {selectedHelmAgents.map((agent) => (
                      <li key={agent.id}>
                        <details className="helm-simple-detail-row">
                          <summary>
                            <strong>{agent.name}</strong>
                            <span>
                              {`${agent.command} ${(agent.args ?? []).join(" ")}`.trim()}
                            </span>
                          </summary>
                          <dl>
                            <div>
                              <dt>Agent ID</dt>
                              <dd>{agent.id}</dd>
                            </div>
                            <div>
                              <dt>Command</dt>
                              <dd>{agent.command}</dd>
                            </div>
                            <div>
                              <dt>Arguments</dt>
                              <dd>{(agent.args ?? []).join(" ") || "-"}</dd>
                            </div>
                            <div>
                              <dt>Transport</dt>
                              <dd>{agent.transport}</dd>
                            </div>
                            <div>
                              <dt>Protocol</dt>
                              <dd>{agent.protocol}</dd>
                            </div>
                          </dl>
                        </details>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="empty-state">
                    {selectedHelmIsConnected
                      ? copy.noAgents
                      : "请先连接该 Helm 后加载舰员"}
                  </div>
                )}
              </section>
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
