export function isManagedWorktreeWorktree(worktree: { path?: string }) {
  const normalizedPath = worktree.path?.replace(/\\/g, "/") ?? "";
  return Boolean(
    normalizedPath.includes("/.worktrees/") ||
      normalizedPath.includes("/.tiller/worktrees/"),
  );
}

export function acpReconnectKey(agentId?: string, cwd?: string) {
  return `${agentId ?? "unknown"}::${cwd ?? "global"}`;
}

export function normalizeWorktreePath(path: string | undefined | null) {
  return path?.replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
}

export function formatRuntimeSessionCount(sessionCount: number, activeSessionCount?: number) {
  const base = `${sessionCount} 个会话`;
  if (
    activeSessionCount === undefined ||
    activeSessionCount === 0 ||
    activeSessionCount === sessionCount
  ) {
    return base;
  }
  return `${base} · ${activeSessionCount} 活跃`;
}

export function formatAcpConnectionStatus(status: string) {
  switch (status) {
    case "ready":
      return "已连接";
    case "opening":
      return "连接中";
    case "error":
      return "连接异常";
    case "closed":
      return "已关闭";
    default:
      return status || "未知";
  }
}
