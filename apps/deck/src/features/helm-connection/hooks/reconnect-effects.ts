import { useEffect, type MutableRefObject } from "react";
import type { ConnectionState } from "../../../store/facade";
import { requestReconnectAttempt } from "../reconnect-attempt";
import type { ConnectToDaemonOptions } from "../sockets";
import {
  shouldAttemptSilentReconnect,
  shouldRunSilentReconnect,
  shouldEnsureLiveConnection,
  shouldCheckHelmHealth,
  type AppView,
} from "../reconnect-policy";

type UseReconnectEffectsOptions = {
  activeProfileId: string;
  activeView: AppView;
  connection: ConnectionState;
  daemonHost: string;
  daemonPort: string;
  embedded: boolean;
  missionVisualMode: boolean;
  tokenPresent: boolean;
  autoConnectAttemptRef: MutableRefObject<string | null>;
  manualDisconnectRef: MutableRefObject<string | null>;
  connectToDaemon: (
    event?: never,
    options?: ConnectToDaemonOptions,
  ) => void | Promise<void>;
  setHelmHealthStatus?: (status: "unknown" | "healthy" | "unhealthy") => void;
};

/**
 * Coordinates silent and live reconnect attempts without duplicating attempts.
 */
export function useReconnectEffects({
  activeProfileId,
  activeView,
  connection,
  daemonHost,
  daemonPort,
  embedded,
  missionVisualMode,
  tokenPresent,
  autoConnectAttemptRef,
  manualDisconnectRef,
  connectToDaemon,
  setHelmHealthStatus,
}: UseReconnectEffectsOptions) {
  // 静默重连 effect
  useEffect(() => {
    if (
      !shouldRunSilentReconnect({
        missionVisualMode,
        connection,
        tokenPresent,
        embedded,
        host: daemonHost,
        port: daemonPort,
      })
    ) {
      return;
    }
    if (manualDisconnectRef.current === activeProfileId) {
      return;
    }
    const attemptKey = `silent:${activeProfileId}`;
    return requestReconnectAttempt({
      activeProfileId,
      attemptKey,
      autoConnectAttemptRef,
      manualDisconnectRef,
      connectToDaemon,
    });
  }, [
    activeProfileId,
    connection,
    daemonHost,
    daemonPort,
    embedded,
    missionVisualMode,
    tokenPresent,
  ]);

  useEffect(() => {
    if (missionVisualMode || !shouldEnsureLiveConnection(activeView)) {
      return;
    }
    if (
      !shouldAttemptSilentReconnect({
        connection,
        tokenPresent,
        embedded,
        host: daemonHost,
        port: daemonPort,
      })
    ) {
      return;
    }
    if (manualDisconnectRef.current === activeProfileId) {
      return;
    }
    const attemptKey = `live:${activeView}:${activeProfileId}`;
    return requestReconnectAttempt({
      activeProfileId,
      attemptKey,
      autoConnectAttemptRef,
      manualDisconnectRef,
      connectToDaemon,
    });
  }, [
    activeProfileId,
    activeView,
    connection,
    daemonHost,
    daemonPort,
    embedded,
    missionVisualMode,
    tokenPresent,
  ]);

  // 健康检查 effect（轻量级，不建立持久连接）
  useEffect(() => {
    if (missionVisualMode || !shouldCheckHelmHealth(activeView)) {
      return;
    }

    // 如果已经连接，直接标记为健康
    if (connection === "connected") {
      setHelmHealthStatus?.("healthy");
      return;
    }

    // 如果没有配置 Helm 地址，标记为未知
    const host = daemonHost.trim();
    const port = daemonPort.trim();
    if (!host || !port) {
      setHelmHealthStatus?.("unknown");
      return;
    }

    // 执行轻量级健康检查：尝试建立短暂的 WebSocket 连接
    const HEALTH_CHECK_TIMEOUT_MS = 5000;
    let healthCheckSocket: WebSocket | null = null;
    let healthCheckTimer: number | null = null;
    let didRespond = false;

    const wsUrl = embedded
      ? `ws://${window.location.host}/helm`
      : `ws://${host}:${port}`;

    // 设置超时
    healthCheckTimer = window.setTimeout(() => {
      if (!didRespond && healthCheckSocket) {
        healthCheckSocket.close();
        setHelmHealthStatus?.("unhealthy");
      }
    }, HEALTH_CHECK_TIMEOUT_MS);

    try {
      healthCheckSocket = new WebSocket(wsUrl);

      healthCheckSocket.addEventListener("open", () => {
        didRespond = true;
        if (healthCheckTimer) {
          window.clearTimeout(healthCheckTimer);
        }
        setHelmHealthStatus?.("healthy");
        // 立即关闭连接，我们只是检查健康状态
        healthCheckSocket?.close();
      });

      healthCheckSocket.addEventListener("error", () => {
        didRespond = true;
        if (healthCheckTimer) {
          window.clearTimeout(healthCheckTimer);
        }
        setHelmHealthStatus?.("unhealthy");
      });
    } catch (error) {
      didRespond = true;
      if (healthCheckTimer) {
        window.clearTimeout(healthCheckTimer);
      }
      setHelmHealthStatus?.("unhealthy");
    }

    // Cleanup
    return () => {
      if (healthCheckTimer) {
        window.clearTimeout(healthCheckTimer);
      }
      if (healthCheckSocket && healthCheckSocket.readyState !== WebSocket.CLOSED) {
        healthCheckSocket.close();
      }
    };
  }, [
    activeView,
    connection,
    daemonHost,
    daemonPort,
    embedded,
    missionVisualMode,
    setHelmHealthStatus,
  ]);
}
