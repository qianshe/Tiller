import { useEffect, type MutableRefObject } from "react";
import type { ConnectionState } from "../../../store/facade";
import {
  clearReconnectAttemptFailure,
  requestReconnectAttempt,
  resumeReconnectAttempt,
} from "../reconnect-attempt";
import type { ConnectToDaemonOptions } from "../sockets";
import {
  shouldAttemptSilentReconnect,
  shouldRunSilentReconnect,
  shouldEnsureLiveConnection,
  shouldCheckHelmHealth,
  resolveHelmHealthStatus,
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

function usesLiveConnection(activeView: AppView) {
  return shouldEnsureLiveConnection(activeView);
}

function shouldReconnectNow(input: {
  missionVisualMode: boolean;
  activeView: AppView;
  connection: ConnectionState;
  tokenPresent: boolean;
  embedded: boolean;
  host: string;
  port: string;
}) {
  return usesLiveConnection(input.activeView)
    ? shouldAttemptSilentReconnect(input)
    : shouldRunSilentReconnect(input);
}

function reconnectAttemptKey({
  activeView,
  activeProfileId,
}: {
  activeView: AppView;
  activeProfileId: string;
}) {
  const live = usesLiveConnection(activeView);
  return `${live ? "live" : "silent"}:${activeView}:${activeProfileId}`;
}

function isExperienceHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

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
  // 每个页面只允许一个自动重连 effect，避免 silent/live 两条路径同时创建 socket。
  useEffect(() => {
    if (missionVisualMode || isExperienceHidden()) {
      return;
    }
    const shouldReconnect = shouldReconnectNow({
      missionVisualMode,
      activeView,
      connection,
      tokenPresent,
      embedded,
      host: daemonHost,
      port: daemonPort,
    });
    if (!shouldReconnect) return;
    if (manualDisconnectRef.current === activeProfileId) {
      return;
    }
    const attemptKey = reconnectAttemptKey({ activeView, activeProfileId });
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

  // 连接成功后清空退避计数，保证下一次断线的重试从 1.5s 档重新开始。
  useEffect(() => {
    if (missionVisualMode || connection !== "connected") {
      return;
    }
    clearReconnectAttemptFailure(reconnectAttemptKey({ activeView, activeProfileId }));
  }, [activeProfileId, activeView, connection, missionVisualMode]);

  // 页面重新可见时立即尝试一次重连，无需等到下一档退避。
  useEffect(() => {
    if (missionVisualMode) {
      return;
    }
    const handleVisibility = () => {
      if (isExperienceHidden()) {
        return;
      }
      if (manualDisconnectRef.current === activeProfileId) {
        return;
      }
      const shouldReconnect = shouldReconnectNow({
        missionVisualMode,
        activeView,
        connection,
        tokenPresent,
        embedded,
        host: daemonHost,
        port: daemonPort,
      });
      if (!shouldReconnect) {
        return;
      }
      // 重置 attempt 标记，让下一次主 effect / 本 handler 走全新连接尝试，
      // 从而立即发起一次重连，而不是等待退避档。
      const attemptKey = reconnectAttemptKey({ activeView, activeProfileId });
      if (autoConnectAttemptRef.current === attemptKey) {
        resumeReconnectAttempt(attemptKey);
        return;
      }
      autoConnectAttemptRef.current = null;
      requestReconnectAttempt({
        activeProfileId,
        attemptKey,
        autoConnectAttemptRef,
        manualDisconnectRef,
        connectToDaemon,
      });
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [
    activeProfileId,
    activeView,
    missionVisualMode,
    autoConnectAttemptRef,
    manualDisconnectRef,
    connectToDaemon,
    connection,
    tokenPresent,
    embedded,
    daemonHost,
    daemonPort,
  ]);

  // 概览页只展示主连接状态，避免额外的短连接造成连接风暴。
  useEffect(() => {
    if (missionVisualMode || !shouldCheckHelmHealth(activeView)) {
      return;
    }
    setHelmHealthStatus?.(
      resolveHelmHealthStatus({
        connection,
        host: daemonHost,
        port: daemonPort,
      }),
    );
  }, [
    activeView,
    connection,
    daemonHost,
    daemonPort,
    missionVisualMode,
    setHelmHealthStatus,
  ]);
}
