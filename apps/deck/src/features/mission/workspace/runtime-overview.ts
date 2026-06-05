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
    const runtimeSessions = connection.sessions ?? [];
    const sessionCount = Math.max(connection.activeSessionCount ?? 0, runtimeSessions.length);
    const children = groupRuntimeSessionsByProject({
      runtimeSessions,
      sessionById,
      projects,
      statuses,
      worktreeName: worktree?.name ?? connection.worktreeName ?? connection.cwd,
      fallbackIdPrefix: `${connection.providerId}:${connection.cwd}`,
    });
    const activeSessionCount = children.length
      ? children.reduce((total, child) => total + (child.activeSessionCount ?? 0), 0)
      : Math.max(0, sessionCount - (connection.pendingSessionCount ?? 0));
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
      runtimeSessionId: formatRuntimeSessionCount(sessionCount, activeSessionCount),
      sessionCount,
      activeSessionCount,
      model: children[0]?.model,
      reasoningEffort: children[0]?.reasoningEffort,
      canReconnect: !reconnectPending,
      canConnect: reconnectPending,
      children,
    };
  });

  const activeSessionHasRuntimeConnection = items.some(
    (item) =>
      item.agentId === activeSession?.agentId &&
      normalizeWorktreePath(item.cwd) === normalizeWorktreePath(activeSession?.cwd),
  );
  if (activeSession?.agentId && activeSession.cwd && !activeSessionHasRuntimeConnection) {
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
      sessionCount: 1,
      activeSessionCount: activeSessionRestoreGate.canChat ? 1 : 0,
      model: activeSession.model,
      reasoningEffort: activeSession.reasoningEffort,
      canReconnect: true,
      canConnect: false,
      children: [
        createRuntimeProjectChild({
          id: activeSession.id,
          projectId: activeSession.projectId,
          projectName: activeSession.projectName ?? "未选项目",
          branchName: worktree?.name ?? activeSession.worktreeName ?? activeSession.cwd,
          active: isActiveRuntimeSessionStatus(status),
          model: activeSession.model,
          reasoningEffort: activeSession.reasoningEffort,
        }),
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
      sessionCount: 0,
      activeSessionCount: 0,
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
      sessionCount: 0,
      activeSessionCount: 0,
      canConnect: Boolean(agent.id && overviewConnectCwd),
      canReconnect: false,
    });
  }

  const agentOrder = new Map(
    agents.map((agent, index) => [agent.id, index]),
  );
  return mergeRuntimeOverviewItemsByAgent(items).sort(
    (left, right) =>
      (agentOrder.get(left.agentId) ?? Number.MAX_SAFE_INTEGER) -
        (agentOrder.get(right.agentId) ?? Number.MAX_SAFE_INTEGER) ||
      left.label.localeCompare(right.label),
  );
}

function groupRuntimeSessionsByProject({
  runtimeSessions,
  sessionById,
  projects,
  statuses,
  worktreeName,
  fallbackIdPrefix,
}: {
  runtimeSessions: any[];
  sessionById: Map<string, any>;
  projects: any[];
  statuses: Record<string, string>;
  worktreeName?: string | null;
  fallbackIdPrefix: string;
}) {
  return mergeRuntimeProjectChildren(
    runtimeSessions.map((runtimeSession: any, index: number) => {
      const session = sessionById.get(runtimeSession.tillerSessionId) as any;
      const status = session ? (statuses[session.id] ?? session.status) : runtimeSession.status;
      const projectName =
        projects.find((project: any) => project.id === session?.projectId)?.name ??
        session?.projectName ??
        "未选项目";
      return createRuntimeProjectChild({
        id: runtimeSession.tillerSessionId ?? runtimeSession.id ?? `${fallbackIdPrefix}:${index}`,
        projectId: session?.projectId,
        projectName,
        branchName: worktreeName ?? session?.worktreeName,
        active: isActiveRuntimeSessionStatus(status),
        model: session?.model ?? runtimeSession.model,
        reasoningEffort: session?.reasoningEffort ?? runtimeSession.reasoningEffort,
      });
    }),
  );
}

function createRuntimeProjectChild({
  id,
  projectId,
  projectName,
  branchName,
  active,
  model,
  reasoningEffort,
}: {
  id: string;
  projectId?: string | null;
  projectName: string;
  branchName?: string | null;
  active: boolean;
  model?: string | null;
  reasoningEffort?: string | null;
}) {
  return {
    id: projectId ?? `project:${projectName}`,
    projectName,
    branchName: branchName ?? "Worktree",
    status: formatRuntimeSessionCount(1),
    sessionCount: 1,
    activeSessionCount: active ? 1 : 0,
    sessionIds: [id],
    activeSessionIds: active ? [id] : [],
    model,
    reasoningEffort,
  };
}

function mergeRuntimeOverviewItemsByAgent<T extends { agentId?: string; [key: string]: any }>(items: T[]): T[] {
  const byAgent = new Map<string, T>();
  const passthrough: T[] = [];
  for (const item of items) {
    if (!item.agentId) {
      passthrough.push(item);
      continue;
    }
    const current = byAgent.get(item.agentId);
    byAgent.set(item.agentId, current ? mergeRuntimeOverviewItem(current, item) : item);
  }
  return [...byAgent.values(), ...passthrough].map(finalizeRuntimeOverviewItem) as T[];
}

function mergeRuntimeOverviewItem<T extends { [key: string]: any }>(left: T, right: T): T {
  const children = mergeRuntimeProjectChildren([...(left.children ?? []), ...(right.children ?? [])]);
  const sessionCount = (left.sessionCount ?? 0) + (right.sessionCount ?? 0);
  const activeSessionCount = (left.activeSessionCount ?? 0) + (right.activeSessionCount ?? 0);
  const preferred = preferRuntimeOverviewItem(left, right);
  return {
    ...left,
    ...right,
    ...preferred,
    id: `acp:${preferred.agentId}`,
    cwd: preferred.cwd ?? left.cwd ?? right.cwd,
    children,
    sessionCount,
    activeSessionCount,
    model: preferred.model ?? left.model ?? right.model,
    reasoningEffort: preferred.reasoningEffort ?? left.reasoningEffort ?? right.reasoningEffort,
    status: mergeRuntimeStatus(left.status, right.status),
    canReconnect: Boolean(left.canReconnect || right.canReconnect),
    canConnect: Boolean(left.canConnect || right.canConnect) &&
      !Boolean(left.canReconnect || right.canReconnect),
  };
}

function finalizeRuntimeOverviewItem<T extends { [key: string]: any }>(item: T): T {
  const children = mergeRuntimeProjectChildren(item.children ?? []);
  const sessionCount = children.length
    ? children.reduce((total, child) => total + (child.sessionCount ?? 0), 0)
    : item.sessionCount ?? 0;
  const activeSessionCount = children.length
    ? children.reduce((total, child) => total + (child.activeSessionCount ?? 0), 0)
    : item.activeSessionCount ?? 0;
  const displayItem = { ...item };
  delete displayItem.sessionCount;
  delete displayItem.activeSessionCount;
  return {
    ...displayItem,
    id: item.agentId ? `acp:${item.agentId}` : item.id,
    meta: children.length ? `${children.length} 个项目` : item.meta,
    runtimeSessionId: sessionCount > 0
      ? formatRuntimeSessionCount(sessionCount, activeSessionCount)
      : item.runtimeSessionId,
    ...(children.length ? { children } : {}),
  };
}

function mergeRuntimeProjectChildren(children: any[]) {
  const byProject = new Map<string, any>();
  for (const child of children) {
    const current = byProject.get(child.id);
    if (!current) {
      byProject.set(child.id, child);
      continue;
    }
    const sessionIds = uniqueStrings([...(current.sessionIds ?? []), ...(child.sessionIds ?? [])]);
    const activeSessionIds = uniqueStrings([...(current.activeSessionIds ?? []), ...(child.activeSessionIds ?? [])]);
    const branchNames = uniqueStrings([current.branchName, child.branchName].filter(Boolean));
    byProject.set(child.id, {
      ...current,
      ...child,
      projectName: current.projectName ?? child.projectName,
      branchName: branchNames.join("、") || current.branchName || child.branchName,
      sessionIds,
      activeSessionIds,
      sessionCount: sessionIds.length,
      activeSessionCount: activeSessionIds.length,
      status: formatRuntimeSessionCount(sessionIds.length, activeSessionIds.length),
      model: current.model ?? child.model,
      reasoningEffort: current.reasoningEffort ?? child.reasoningEffort,
    });
  }
  return [...byProject.values()].sort((left, right) =>
    left.projectName.localeCompare(right.projectName, undefined, { sensitivity: "base" }),
  );
}

function preferRuntimeOverviewItem<T extends { [key: string]: any }>(left: T, right: T): T {
  if (left.status !== "未连接" && right.status === "未连接") {
    return left;
  }
  if (right.status !== "未连接" && left.status === "未连接") {
    return right;
  }
  if (Boolean(left.model) !== Boolean(right.model)) {
    return left.model ? left : right;
  }
  return left;
}

function mergeRuntimeStatus(left: string, right: string) {
  const statuses = [left, right];
  if (statuses.includes("已连接")) {
    return "已连接";
  }
  if (statuses.includes("连接中")) {
    return "连接中";
  }
  if (statuses.includes("连接异常")) {
    return "连接异常";
  }
  if (statuses.includes("已预热")) {
    return "已预热";
  }
  return left || right || "未知";
}

function isActiveRuntimeSessionStatus(status: string | undefined) {
  return status === "starting" || status === "running" || status === "waiting_for_permission";
}

function uniqueStrings(values: Array<string | undefined | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
