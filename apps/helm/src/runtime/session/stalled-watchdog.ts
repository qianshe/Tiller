import type { SessionSummary } from "@tiller/shared";
import {
  createRuntimeReachability,
  detectStalledActiveSessions,
  type RuntimeReachabilityInput,
  type StalledSession,
} from "./stalled-detection";

/** 与 WebSocket 心跳同频:失联会话最多滞留一个扫描周期。 */
export const DEFAULT_STALLED_SESSION_SWEEP_INTERVAL_MS = 30_000;

export type StalledSessionSweepDeps = {
  listSessionSummaries: () => readonly SessionSummary[];
  hasRuntimeRecord: (sessionId: string) => boolean;
  listConnections: () => RuntimeReachabilityInput["connections"];
  markStalled: (session: StalledSession) => void;
  now?: () => string;
  graceMs?: number;
  logError?: (message: string) => void;
};

/**
 * 扫描一轮:把停在活跃状态但运行时已不可达的会话交给 `markStalled`。
 * 单个会话标记失败不影响同轮其余会话。
 */
export function runStalledSessionSweep(deps: StalledSessionSweepDeps): StalledSession[] {
  const stalled = detectStalledActiveSessions({
    summaries: deps.listSessionSummaries(),
    isRuntimeReachable: createRuntimeReachability({
      hasRuntimeRecord: deps.hasRuntimeRecord,
      connections: deps.listConnections(),
    }),
    now: deps.now?.(),
    graceMs: deps.graceMs,
  });
  const marked: StalledSession[] = [];
  for (const session of stalled) {
    try {
      deps.markStalled(session);
      marked.push(session);
    } catch (error) {
      deps.logError?.(
        `[tiller] session.stalled.mark_failed sessionId=${session.id} message=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return marked;
}

export type StalledSessionWatchdogOptions = StalledSessionSweepDeps & {
  intervalMs?: number;
  setInterval?: (handler: () => void, intervalMs: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

/**
 * 周期性回收失联会话,兜住那些不会再产生任何运行时事件的 running/waiting 状态。
 */
export function startStalledSessionWatchdog(
  options: StalledSessionWatchdogOptions,
): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_STALLED_SESSION_SWEEP_INTERVAL_MS;
  const startInterval = options.setInterval ?? setInterval;
  const stopInterval = options.clearInterval
    ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));

  const handle = startInterval(() => {
    try {
      runStalledSessionSweep(options);
    } catch (error) {
      options.logError?.(
        `[tiller] session.stalled.sweep_failed message=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }, intervalMs);
  (handle as { unref?: () => void })?.unref?.();

  return () => stopInterval(handle);
}
