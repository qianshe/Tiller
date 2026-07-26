import type { SessionSummary } from "@tiller/shared";

type SessionSummaryStoreLike = {
  list: () => SessionSummary[];
  upsert: (summary: SessionSummary) => void;
};

const ACTIVE_SESSION_STATUSES: ReadonlySet<SessionSummary["status"]> = new Set([
  "starting",
  "running",
  "waiting_for_permission",
]);

/**
 * Helm 重启会丢失内存中的活跃 runtime,而 sqlite 摘要仍停留在重启前的
 * starting/running/waiting 状态。启动时(尚无任何活跃 runtime)把这些
 * 孤儿会话归一为 cancelled,让前端一连接就看到真实状态,避免对"影子
 * 会话"继续操作(如取消时误报 Session not found)。
 */
export function normalizeOrphanedActiveSessions(
  store: SessionSummaryStoreLike,
  now = new Date().toISOString(),
): string[] {
  const normalized: string[] = [];
  for (const summary of store.list()) {
    if (!ACTIVE_SESSION_STATUSES.has(summary.status)) {
      continue;
    }
    store.upsert({ ...summary, status: "cancelled", updatedAt: now });
    normalized.push(summary.id);
  }
  return normalized;
}
