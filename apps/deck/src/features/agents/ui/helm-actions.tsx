import type {
  Dispatch,
  FormEvent,
  MutableRefObject,
  SetStateAction,
} from "react";
import type { DaemonProfile } from "../../helm-connection/daemon-profiles";
import type { HelmCard } from "./helm-hub";

type ConnectionState = "connecting" | "connected" | "disconnected";

type HelmActionsProps = {
  connectDaemonProfile: (profile: DaemonProfile) => void;
  connectToDaemon: (
    event?: FormEvent<HTMLFormElement>,
    options?: { preserveState?: boolean },
  ) => Promise<void> | void;
  helmSocketRefs: MutableRefObject<Map<string, WebSocket>>;
  isEmbeddedHelmDeck: boolean;
  lastFilesScopeKeyRef: MutableRefObject<string | null>;
  manualDisconnectRef: MutableRefObject<string | null>;
  selectedHelm: HelmCard;
  selectedHelmConnection: ConnectionState;
  selectedHelmIsConnected: boolean;
  selectedHelmIsCurrent: boolean;
  selectedHelmSavedProfile: DaemonProfile | null;
  setConnection: Dispatch<SetStateAction<ConnectionState>>;
  setHelmConnectionState: (profileKey: string, state: ConnectionState) => void;
  setPendingHelmDeleteProfile: Dispatch<SetStateAction<DaemonProfile | null>>;
  socketRef: MutableRefObject<WebSocket | null>;
};

export function HelmActions({
  connectDaemonProfile,
  connectToDaemon,
  helmSocketRefs,
  isEmbeddedHelmDeck,
  lastFilesScopeKeyRef,
  manualDisconnectRef,
  selectedHelm,
  selectedHelmConnection,
  selectedHelmIsConnected,
  selectedHelmIsCurrent,
  selectedHelmSavedProfile,
  setConnection,
  setHelmConnectionState,
  setPendingHelmDeleteProfile,
  socketRef,
}: HelmActionsProps) {
  return (
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
              setHelmConnectionState(selectedHelm.key, "disconnected");
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
        <span className="helm-state-chip helm-state-connecting">连接中</span>
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
          onClick={() => setPendingHelmDeleteProfile(selectedHelmSavedProfile)}
          title="仅删除 Deck 前端保存的 Helm 配置，不销毁远端 Helm 进程或后端配置"
        >
          删除配置
        </button>
      ) : null}
    </div>
  );
}
