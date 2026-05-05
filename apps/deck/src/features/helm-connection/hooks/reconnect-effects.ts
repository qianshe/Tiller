import { useEffect, type MutableRefObject } from "react";
import type { ConnectionState } from "../../../store/slices/connection-slice";
import type { ConnectToDaemonOptions } from "../sockets";
import {
  shouldAttemptSilentReconnect,
  shouldEnsureLiveConnection,
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
}: UseReconnectEffectsOptions) {
  useEffect(() => {
    if (missionVisualMode || (!tokenPresent && !embedded)) {
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
    const attemptKey = `silent:${activeProfileId}`;
    if (autoConnectAttemptRef.current === attemptKey) {
      return;
    }
    autoConnectAttemptRef.current = attemptKey;
    connectToDaemon(undefined, { preserveState: true, auto: true });
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
    if (autoConnectAttemptRef.current === attemptKey) {
      return;
    }
    autoConnectAttemptRef.current = attemptKey;
    connectToDaemon(undefined, { preserveState: true, auto: true });
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
}
