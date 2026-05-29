import { dedupeRuntimeOverviewItems } from "./workspace-runtime-overview";
import {
  formatAcpConnectionStatus,
  formatRuntimeSessionCount,
  normalizeWorktreePath,
} from "./runtime-display";

type RuntimeOverviewParams = {
  agentConnectionInventory: any[];
  agents: any[];
  worktrees: any[];
  sessions: any[];
  projects: any[];
  statuses: Record<string, string>;
  statusLabels: Record<string, string>;
  pendingAcpReconnects: Record<string, string | null>;
  selectedProjectId?: string | null;
  selectedCwd?: string | null;
  activeSession?: any;
  activeSessionRestoreGate?: { canChat?: boolean };
  agentModelOptions?: Record<string, any>;
  draftWorktreeOptions?: any[];
};

function acpReconnectKey(agentId?: string, cwd?: string) {
  return `${agentId ?? "unknown"}::${cwd ?? "global"}`;
}

export function buildRuntimeOverviewItems({
  agentConnectionInventory,
  agents,
  worktrees,
  sessions,
  projects,
  statuses,
  statusLabels,
  pendingAcpReconnects,
  selectedProjectId,
  selectedCwd,
  activeSession,
  activeSessionRestoreGate = {},
  agentModelOptions = {},
  draftWorktreeOptions = [],
}: RuntimeOverviewParams) {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const items: any[] = agentConnectionInventory.map((connection) => {
    const agent = agents.find((item) => item.id === connection.providerId);
    const worktree = (worktrees ?? []).find(
      (item: any) => normalizeWorktreePath(item.path) === normalizeWorktreePath(connection.cwd),
    );
    const children = (connection.sessions ?? []).map((runtimeSession: any) => {
      const session = sessionById.get(runtimeSession.tillerSessionId) as any;
      const status = session ? (statuses[session.id] ?? session.status) : runtimeSession.status;
      const statusLabel = statusLabels[status] ?? status;
      const projectName =
        projects.find((project: any) => project.id === session?.projectId)?.name ??
        session?.projectName ??
        "未选项目";
      return {
        id: runtimeSession.tillerSessionId,
        projectName,
        branchName: worktree?.name ?? session?.worktreeName ?? connection.worktreeName ?? connection.cwd,
        status: statusLabel,
        model: session?.model ?? runtimeSession.model,
        reasoningEffort: session?.reasoningEffort ?? runtimeSession.reasoningEffort,
      };
    });
    const reconnectKey = acpReconnectKey(connection.providerId, connection.cwd);
    const reconnectPending = reconnectKey in pendingAcpReconnects;
    return {
      id: `acp:${connection.providerId}:${connection.cwd}`,
      agentId: connection.providerId,
      projectId: selectedProjectId ?? undefined,
      cwd: connection.cwd,
      label: agent?.name ?? connection.providerId ?? "ACP",
      meta: reconnectPending ? "等待重新连接成功" : connection.lastError ?? worktree?.name ?? connection.cwd ?? "Worktree",
      status: reconnectPending ? "未连接" : formatAcpConnectionStatus(connection.status),
      runtimeSessionId: formatRuntimeSessionCount(
        connection.activeSessionCount ?? children.length,
        Math.max(0, (connection.activeSessionCount ?? children.length) - (connection.pendingSessionCount ?? 0)),
      ),
      model: children[0]?.model,
      reasoningEffort: children[0]?.reasoningEffort,
      canReconnect: !reconnectPending,
      canConnect: reconnectPending,
      children,
    };
  });

  if (activeSession?.agentId && activeSession.cwd) {
    const agent = agents.find((item) => item.id === activeSession.agentId);
    const worktree = (worktrees ?? []).find(
      (item: any) => normalizeWorktreePath(item.path) === normalizeWorktreePath(activeSession.cwd),
    );
    const status = statuses[activeSession.id] ?? activeSession.status;
    items.push({
      id: `acp:${activeSession.agentId}:${activeSession.cwd}:active-session`,
      agentId: activeSession.agentId,
      projectId: activeSession.projectId ?? selectedProjectId ?? undefined,
      cwd: activeSession.cwd,
      label: agent?.name ?? activeSession.agentName ?? activeSession.agentId ?? "ACP",
      meta: worktree?.name ?? activeSession.worktreeName ?? activeSession.cwd,
      status: activeSessionRestoreGate.canChat ? "已连接" : "连接中",
      runtimeSessionId: formatRuntimeSessionCount(1, activeSessionRestoreGate.canChat ? 1 : 0),
      model: activeSession.model,
      reasoningEffort: activeSession.reasoningEffort,
      canReconnect: true,
      canConnect: false,
      children: [
        {
          id: activeSession.id,
          projectName: activeSession.projectName ?? "未选项目",
          branchName: worktree?.name ?? activeSession.worktreeName ?? activeSession.cwd,
          status: statusLabels[status] ?? status,
          model: activeSession.model,
          reasoningEffort: activeSession.reasoningEffort,
        },
      ],
    });
  }

  for (const [key, entry] of Object.entries(agentModelOptions ?? {}) as Array<[string, any]>) {
    const [agentId, cwd] = key.split("::");
    if (!entry?.runtimeSessionId || items.some((item) => item.agentId === agentId && item.cwd === cwd)) {
      continue;
    }
    const agentName = agents.find((agent: any) => agent.id === agentId)?.name ?? agentId ?? "ACP";
    const worktreeName =
      draftWorktreeOptions.find((worktree: any) => worktree.path === cwd)?.name ??
      cwd ??
      "Worktree";
    items.push({
      id: `acp:${agentId}:${cwd}:prewarm`,
      agentId,
      cwd,
      label: agentName,
      meta: worktreeName,
      status: entry.loading ? "预热中" : "已预热",
      runtimeSessionId: `${worktreeName} · 预热连接`,
      model: entry.state?.model,
      reasoningEffort: entry.state?.reasoningEffort,
      canReconnect: true,
    });
  }

  const overviewConnectCwd = selectedCwd ?? activeSession?.cwd;
  for (const agent of agents) {
    const hasConnection = items.some((item) => item.agentId === agent.id);
    if (hasConnection) {
      continue;
    }
    items.push({
      id: `acp:${agent.id ?? agent.name ?? "acp"}`,
      agentId: agent.id,
      projectId: selectedProjectId ?? undefined,
      cwd: overviewConnectCwd ?? undefined,
      label: agent.name ?? agent.id ?? "ACP",
      meta: "暂无连接",
      status: "未连接",
      runtimeSessionId: "暂无连接",
      canConnect: Boolean(agent.id && overviewConnectCwd),
      canReconnect: false,
    });
  }

  const agentOrder = new Map(
    agents.map((agent, index) => [agent.id, index]),
  );
  return dedupeRuntimeOverviewItems(items).sort(
    (left, right) =>
      (agentOrder.get(left.agentId) ?? Number.MAX_SAFE_INTEGER) -
        (agentOrder.get(right.agentId) ?? Number.MAX_SAFE_INTEGER) ||
      left.label.localeCompare(right.label),
  );
}
