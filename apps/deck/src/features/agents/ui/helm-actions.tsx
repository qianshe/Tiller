import type {
  Dispatch,
  FormEvent,
  MutableRefObject,
  SetStateAction,
} from "react";
import { Badge, Button } from "@/shared/ui";
import type { DaemonProfile, DeckRpcClient, DispatchToHelm } from "../../helm-connection/facade";
import type { HelmCard } from "./helm-hub";

type ConnectionState = "connecting" | "connected" | "disconnected";

type HelmActionsProps = {
  connectDaemonProfile: (profile: DaemonProfile) => void;
  connectToDaemon: (
    event?: FormEvent<HTMLFormElement>,
    options?: { preserveState?: boolean },
  ) => Promise<void> | void;
  dispatch: DispatchToHelm;
  helmSocketRefs: MutableRefObject<Map<string, WebSocket>>;
  isEmbeddedHelmDeck: boolean;
  lastFilesScopeKeyRef: MutableRefObject<string | null>;
  manualDisconnectRef: MutableRefObject<string | null>;
  selectedHelm: HelmCard;
  selectedHelmConnection: ConnectionState;
  selectedHelmIsConnected: boolean;
  selectedHelmIsCurrent: boolean;
  selectedHelmRpcClient: DeckRpcClient | null;
  selectedHelmSavedProfile: DaemonProfile | null;
  setConnection: Dispatch<SetStateAction<ConnectionState>>;
  setHelmConnectionState: (profileKey: string, state: ConnectionState) => void;
  setPendingHelmDeleteProfile: Dispatch<SetStateAction<DaemonProfile | null>>;
  socketRef: MutableRefObject<WebSocket | null>;
};

export function HelmActions({
  connectDaemonProfile,
  connectToDaemon,
  dispatch,
  helmSocketRefs,
  isEmbeddedHelmDeck,
  lastFilesScopeKeyRef,
  manualDisconnectRef,
  selectedHelm,
  selectedHelmConnection,
  selectedHelmIsConnected,
  selectedHelmIsCurrent,
  selectedHelmRpcClient,
  selectedHelmSavedProfile,
  setConnection,
  setHelmConnectionState,
  setPendingHelmDeleteProfile,
  socketRef,
}: HelmActionsProps) {
  const markSelectedHelmDisconnected = () => {
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
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {selectedHelmIsConnected ? (
        <>
          <Button
            variant="outline"
            type="button"
            onClick={markSelectedHelmDisconnected}
          >
            断开连接
          </Button>
          {selectedHelmRpcClient ? (
            <Button
              variant="destructive"
              type="button"
              onClick={async () => {
                await dispatch(selectedHelmRpcClient, "daemon/shutdown", {});
                markSelectedHelmDisconnected();
              }}
              title="优雅关闭 Helm 进程，并让后端清理已连接的 ACP provider 进程"
            >
              关闭 Helm
            </Button>
          ) : null}
        </>
      ) : selectedHelmConnection === "connecting" ? (
        <Badge variant="secondary" className="min-h-10 px-4">
          连接中
        </Badge>
      ) : (
        <Button
          variant="outline"
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
        </Button>
      )}
      {selectedHelmSavedProfile && !isEmbeddedHelmDeck ? (
        <Button
          variant="destructive"
          type="button"
          onClick={() => setPendingHelmDeleteProfile(selectedHelmSavedProfile)}
          title="仅删除 Deck 前端保存的 Helm 配置，不销毁远端 Helm 进程或后端配置"
        >
          删除配置
        </Button>
      ) : null}
    </div>
  );
}
