import { isRequestTimeoutError } from "@tiller/sync-protocol";

/** 探测间隔略长于 Helm 侧 WebSocket 心跳(30s),避免两侧同频互相打架。 */
export const DEFAULT_HELM_LIVENESS_PROBE_INTERVAL_MS = 45_000;

export type HelmLivenessRequestProbeOptions = {
  /** 一次轻量 RPC。必须自带超时,否则半开连接下它永远不会 settle。 */
  request: () => Promise<unknown>;
};

/**
 * 把一次 RPC 收敛成"链路还活着吗"这一个问题。
 *
 * 关键在于:服务端返回的错误同样是一次回应,证明链路通畅。只有请求彻底
 * 没有得到回应(超时)才说明连接已死。把任何失败都当断线会误伤未完成设备
 * 认证的连接——配对流程里 socket 已 open 但 Helm 会拒绝业务请求。
 */
export function createHelmLivenessRequestProbe(
  options: HelmLivenessRequestProbeOptions,
): () => Promise<void> {
  return async () => {
    try {
      await options.request();
    } catch (error) {
      if (isRequestTimeoutError(error)) {
        throw error;
      }
    }
  };
}

export type HelmLivenessProbeOptions = {
  /** 判定链路是否存活的一次探测;reject 即视为连接已死。 */
  probe: () => Promise<unknown>;
  onDead: (reason: string) => void;
  intervalMs?: number;
  setInterval?: (handler: () => void, intervalMs: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

/**
 * 浏览器无法主动发 WebSocket ping,半开连接下 readyState 会一直停在 OPEN,
 * Deck 因此以为自己还连着:状态不再刷新,取消请求也石沉大海。用一次真实
 * 往返来判定连接是否还活着,死了就交给既有的重连链路。
 */
export function startHelmLivenessProbe(options: HelmLivenessProbeOptions): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_HELM_LIVENESS_PROBE_INTERVAL_MS;
  const startInterval = options.setInterval ?? setInterval;
  const stopInterval = options.clearInterval
    ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));

  let inFlight = false;
  let stopped = false;
  let handle: unknown;

  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    stopInterval(handle);
  };

  handle = startInterval(() => {
    if (stopped || inFlight) {
      return;
    }
    const declareDead = (error: unknown) => {
      inFlight = false;
      if (stopped) {
        return;
      }
      stop();
      options.onDead(error instanceof Error ? error.message : "Helm 未响应");
    };
    inFlight = true;
    try {
      void options.probe().then(() => {
        inFlight = false;
      }, declareDead);
    } catch (error) {
      declareDead(error);
    }
  }, intervalMs);

  return stop;
}
