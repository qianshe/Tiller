import { useEffect, type MutableRefObject } from "react";
import type { ConnectionState } from "../../../store/facade";
import type { DeckRpcClient } from "../rpc-client";
import { createHelmLivenessRequestProbe, startHelmLivenessProbe } from "../liveness-probe";

/** 探测请求自带超时,半开连接才会以 reject 而不是永久挂起的形式暴露。 */
const PROBE_TIMEOUT_MS = 10_000;

type UseHelmLivenessProbeOptions = {
  connection: ConnectionState;
  missionVisualMode: boolean;
  rpcClientRef: MutableRefObject<DeckRpcClient | null>;
};

/**
 * 连接标记为 connected 后周期性验证它确实还活着。浏览器不会主动发 ping,
 * 半开连接下 readyState 一直是 OPEN,自动重连因此永远不会触发。探测失败
 * 就主动关掉 socket,交给既有的 close -> disconnected -> 重连链路。
 */
export function useHelmLivenessProbe({
  connection,
  missionVisualMode,
  rpcClientRef,
}: UseHelmLivenessProbeOptions) {
  useEffect(() => {
    if (missionVisualMode || connection !== "connected") {
      return;
    }
    const client = rpcClientRef.current;
    if (!client) {
      return;
    }
    return startHelmLivenessProbe({
      probe: createHelmLivenessRequestProbe({
        request: () => client.request("helm/list", {}, { timeoutMs: PROBE_TIMEOUT_MS }),
      }),
      onDead: () => {
        // close 会走既有的 socket close 处理器,把连接状态翻回 disconnected。
        client.close();
      },
    });
  }, [connection, missionVisualMode, rpcClientRef]);
}
