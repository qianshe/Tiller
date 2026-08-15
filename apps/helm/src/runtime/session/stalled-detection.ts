import type { SessionSummary } from "@tiller/shared";

const ACTIVE_SESSION_STATUSES: ReadonlySet<SessionSummary["status"]> = new Set([
  "starting",
  "running",
  "waiting_for_permission",
]);

const UNREACHABLE_CONNECTION_STATUSES: ReadonlySet<string> = new Set(["closed", "error"]);

/**
 * 会话摘要写入与运行时注册之间存在窗口期,宽限期避免误伤刚创建/正在恢复的会话。
 * 必须大于 ACP 的 session/new、session/load、session/resume 请求超时(120s),
 * 否则一次慢启动就会被当成失联。
 */
export const DEFAULT_STALLED_SESSION_GRACE_MS = 180_000;

export type RuntimeReachabilityInput = {
  hasRuntimeRecord: (sessionId: string) => boolean;
  connections: readonly {
    status: string;
    sessions: readonly { tillerSessionId: string }[];
  }[];
};

/**
 * 判断一个会话是否还存在可以送达运行时事件的 ACP 通道。
 * 不可达意味着它再也不会自行离开 running/waiting 状态。
 */
export function createRuntimeReachability(
  input: RuntimeReachabilityInput,
): (sessionId: string) => boolean {
  const connectionStatusBySession = new Map<string, string>();
  for (const connection of input.connections) {
    for (const session of connection.sessions) {
      connectionStatusBySession.set(session.tillerSessionId, connection.status);
    }
  }
  return (sessionId) => {
    if (!input.hasRuntimeRecord(sessionId)) {
      return false;
    }
    const connectionStatus = connectionStatusBySession.get(sessionId);
    if (!connectionStatus) {
      // 内存里还留着 runtime 记录,但没有任何连接认领它:连接已被替换或丢弃。
      return false;
    }
    return !UNREACHABLE_CONNECTION_STATUSES.has(connectionStatus);
  };
}

export type StalledSessionDetectionInput = {
  summaries: readonly SessionSummary[];
  isRuntimeReachable: (sessionId: string) => boolean;
  now?: string;
  graceMs?: number;
};

export type StalledSession = {
  id: string;
  status: SessionSummary["status"];
};

/**
 * 找出停在活跃状态、但运行时已不可达的会话。
 */
export function detectStalledActiveSessions(
  input: StalledSessionDetectionInput,
): StalledSession[] {
  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  const graceMs = input.graceMs ?? DEFAULT_STALLED_SESSION_GRACE_MS;
  const stalled: StalledSession[] = [];
  for (const summary of input.summaries) {
    if (!ACTIVE_SESSION_STATUSES.has(summary.status)) {
      continue;
    }
    if (input.isRuntimeReachable(summary.id)) {
      continue;
    }
    const updatedAtMs = Date.parse(summary.updatedAt);
    if (Number.isFinite(updatedAtMs) && nowMs - updatedAtMs < graceMs) {
      continue;
    }
    stalled.push({ id: summary.id, status: summary.status });
  }
  return stalled;
}
