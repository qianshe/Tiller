import type { DaemonProfile } from "../../helm-connection/facade";
import { resolveHelmConnectionState } from "../utils/fleet-helpers";

type ConnectionState = "connecting" | "connected" | "disconnected";

export type HelmCard = {
  key: string;
  name: string;
  host: string;
  port: string;
  isCurrent: boolean;
  profile: DaemonProfile | null;
};

type HelmHubProps = {
  connection: ConnectionState;
  currentHelmKey: string;
  helmCards: HelmCard[];
  helmConnectionStates: Record<string, ConnectionState>;
  isEmbeddedHelmDeck: boolean;
  onAddHelm: () => void;
  selectedHelm: HelmCard;
  setSelectedHelmKey: (key: string) => void;
};

export function HelmHub({
  connection,
  currentHelmKey,
  helmCards,
  helmConnectionStates,
  isEmbeddedHelmDeck,
  onAddHelm,
  selectedHelm,
  setSelectedHelmKey,
}: HelmHubProps) {
  return (
    <section className="fleet-hub" aria-label="舰队 Helm 节点">
      <div className="fleet-hub-head">
        <div>
          <div className="fleet-hub-title-row">
            <h3>Helm</h3>
            <span>{helmCards.length} Helm</span>
          </div>
        </div>
        {!isEmbeddedHelmDeck ? (
          <button className="primary" type="button" onClick={onAddHelm}>
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
            className={[
              "fleet-hub-node",
              selectedHelm.key === helm.key ? "active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            key={helm.key}
            type="button"
            role="listitem"
            onClick={() => setSelectedHelmKey(helm.key)}
            aria-pressed={selectedHelm.key === helm.key}
            title={`${helm.name} · ${helm.host}:${helm.port}`}
          >
            <span
              className={`helm-status-dot helm-status-${resolveHelmConnectionState(
                helm,
                currentHelmKey,
                connection,
                helmConnectionStates,
              )}`}
              aria-hidden="true"
            />
            <span>{helm.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
