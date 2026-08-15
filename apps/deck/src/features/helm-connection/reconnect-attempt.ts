import type { MutableRefObject } from "react";
import type { ConnectToDaemonOptions } from "./sockets";

const RETRY_BACKOFF_MS = [1_500, 3_000, 6_000, 12_000, 30_000];

// 记录每个重连尝试已失败的次数，用于退避节奏；连接成功后由
// useReconnectEffects 在 connection 回到 connected 时清理。
const attemptFailureCounts = new Map<string, number>();
const activeReconnectAttempts = new Map<string, {
  resume: () => void;
  stop: () => void;
}>();

export function getReconnectAttemptFailureCount(attemptKey: string) {
  return attemptFailureCounts.get(attemptKey) ?? 0;
}

export function clearReconnectAttemptFailure(attemptKey: string) {
  attemptFailureCounts.set(attemptKey, 0);
  activeReconnectAttempts.get(attemptKey)?.stop();
}

export function resumeReconnectAttempt(attemptKey: string) {
  activeReconnectAttempts.get(attemptKey)?.resume();
}

export function cancelReconnectAttempt(attemptKey: string) {
  activeReconnectAttempts.get(attemptKey)?.stop();
}

type ReconnectAttemptOptions = {
  activeProfileId: string;
  attemptKey: string;
  autoConnectAttemptRef: MutableRefObject<string | null>;
  manualDisconnectRef: MutableRefObject<string | null>;
  connectToDaemon: (
    event?: never,
    options?: ConnectToDaemonOptions,
  ) => void | Promise<void>;
  isPageVisible?: () => boolean;
  setTimeout?: (handler: () => void, timeoutMs: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

/**
 * Starts or retries an automatic Helm reconnect attempt without duplicate live effects.
 *
 * 重试采用退避节奏（1.5s -> 3s -> 6s -> 12s -> 上限 30s）：每次失败计数递增，
 * 下一次按对应档位延迟。连接成功后由连接状态回到 connected 的 effect 清理计数。
 */
export function requestReconnectAttempt({
  activeProfileId,
  attemptKey,
  autoConnectAttemptRef,
  manualDisconnectRef,
  connectToDaemon,
  isPageVisible = () =>
    typeof document === "undefined" || document.visibilityState !== "hidden",
  setTimeout: schedule = setTimeout,
  clearTimeout: cancel = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: ReconnectAttemptOptions) {
  if (manualDisconnectRef.current === activeProfileId) {
    return () => undefined;
  }

  const existingAttempt = activeReconnectAttempts.get(attemptKey);
  if (existingAttempt) {
    return () => undefined;
  }

  let stopped = false;
  let retryTimer: unknown;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (retryTimer !== undefined) {
      cancel(retryTimer);
      retryTimer = undefined;
    }
    if (activeReconnectAttempts.get(attemptKey)?.stop === stop) {
      activeReconnectAttempts.delete(attemptKey);
    }
  };

  const connect = () => {
    void connectToDaemon(undefined, { preserveState: true, auto: true });
  };

  const scheduleRetry = () => {
    if (stopped) return;
    const failures = attemptFailureCounts.get(attemptKey) ?? 0;
    const nextDelay = failures < RETRY_BACKOFF_MS.length
      ? RETRY_BACKOFF_MS[failures]!
      : RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]!;
    attemptFailureCounts.set(attemptKey, failures + 1);

    retryTimer = schedule(() => {
      retryTimer = undefined;
      if (
        stopped ||
        autoConnectAttemptRef.current !== attemptKey ||
        manualDisconnectRef.current === activeProfileId
      ) {
        stop();
        return;
      }
      if (!isPageVisible()) {
        return;
      }
      connect();
      scheduleRetry();
    }, nextDelay);
  };

  const resume = () => {
    if (
      stopped ||
      autoConnectAttemptRef.current !== attemptKey ||
      manualDisconnectRef.current === activeProfileId ||
      !isPageVisible()
    ) {
      return;
    }
    if (retryTimer !== undefined) {
      cancel(retryTimer);
      retryTimer = undefined;
    }
    connect();
    scheduleRetry();
  };

  activeReconnectAttempts.set(attemptKey, { resume, stop });

  if (autoConnectAttemptRef.current !== attemptKey) {
    autoConnectAttemptRef.current = attemptKey;
    attemptFailureCounts.set(attemptKey, 0);
    connect();
  }
  scheduleRetry();

  return stop;
}
