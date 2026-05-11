import type { MutableRefObject } from "react";
import type { ConnectToDaemonOptions } from "./sockets";

const DEFAULT_RECONNECT_RETRY_DELAY_MS = 1_500;

type ReconnectAttemptOptions = {
  activeProfileId: string;
  attemptKey: string;
  autoConnectAttemptRef: MutableRefObject<string | null>;
  manualDisconnectRef: MutableRefObject<string | null>;
  connectToDaemon: (
    event?: never,
    options?: ConnectToDaemonOptions,
  ) => void | Promise<void>;
  retryDelayMs?: number;
  setTimeout?: (handler: () => void, timeoutMs: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

/**
 * Starts or retries an automatic Helm reconnect attempt without duplicate live effects.
 */
export function requestReconnectAttempt({
  activeProfileId,
  attemptKey,
  autoConnectAttemptRef,
  manualDisconnectRef,
  connectToDaemon,
  retryDelayMs = DEFAULT_RECONNECT_RETRY_DELAY_MS,
  setTimeout: schedule = setTimeout,
  clearTimeout: cancel = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: ReconnectAttemptOptions) {
  if (manualDisconnectRef.current === activeProfileId) {
    return () => undefined;
  }

  const connect = () => {
    void connectToDaemon(undefined, { preserveState: true, auto: true });
  };

  if (autoConnectAttemptRef.current !== attemptKey) {
    autoConnectAttemptRef.current = attemptKey;
    connect();
    return () => undefined;
  }

  const retryTimer = schedule(() => {
    if (
      autoConnectAttemptRef.current === attemptKey &&
      manualDisconnectRef.current !== activeProfileId
    ) {
      connect();
    }
  }, retryDelayMs);

  return () => cancel(retryTimer);
}
