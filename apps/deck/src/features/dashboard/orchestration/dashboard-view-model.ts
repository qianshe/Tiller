import type {
  AgentPlan,
  CanonicalApproval,
  HelmSummary,
  PermissionDecision,
  PermissionRequestOption,
  SessionStatus,
  SessionSummary,
} from "@tiller/shared";
import { resolvePermissionCommandDisplay } from "../../mission/facade";

type DashboardInput = {
  connection: string;
  daemonHost: string;
  daemonPort: string;
  defaultDaemonHost: string;
  defaultDaemonPort: string;
  activeHelm?: { id?: string; name?: string; host?: string; port?: string | number } | null;
  helms?: Array<Partial<HelmSummary> & Record<string, unknown>>;
  agents: unknown[];
  projects: unknown[];
  sessions: SessionSummary[];
  statuses?: Record<string, SessionStatus | undefined>;
  activeSessionId?: string | null;
  openChatSessionIds?: string[];
  focusedChatWindowId?: string | null;
  sessionPlans?: Record<string, AgentPlan | undefined>;
  toolCalls: Record<string, unknown[]>;
  approvalItemsById: Record<string, any>;
  approvalHistory?: CanonicalApproval[];
  notifications?: DashboardNotification[];
  resolveDisplaySessionTitle: (session: SessionSummary) => string;
};

type DashboardPlanSummary = {
  completed: number;
  total: number;
  label: string;
};

export type DashboardNotification = {
  id: string;
  kind: "error" | "warning" | "info";
  message: string;
  source?: string;
  code?: string;
  sessionId?: string;
  sessionName?: string;
  createdAt: string;
};

const DASHBOARD_APPROVAL_DECISIONS: PermissionDecision[] = [
  "deny",
  "allow",
  "allow_session",
  "allow_always",
];

function dashboardText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function summarizeDashboardPlan(plan: AgentPlan | undefined): DashboardPlanSummary | null {
  if (!plan?.entries.length) {
    return null;
  }
  const completed = plan.entries.filter((entry) => entry.status === "completed").length;
  const total = plan.entries.length;
  return {
    completed,
    total,
    label: completed === total ? `${completed}/${total} 已完成` : `${completed}/${total} 进行中`,
  };
}

function resolveFocusedSessionId(focusedChatWindowId: string | null | undefined): string | null {
  return focusedChatWindowId?.startsWith("session:")
    ? focusedChatWindowId.slice("session:".length)
    : null;
}

function resolveSelectedSessionIds(input: Pick<
  DashboardInput,
  "activeSessionId" | "focusedChatWindowId" | "openChatSessionIds"
>): Set<string> {
  return new Set([
    input.activeSessionId,
    resolveFocusedSessionId(input.focusedChatWindowId),
    ...(input.openChatSessionIds ?? []),
  ].filter((id): id is string => typeof id === "string" && id.length > 0));
}

export function resolveDashboardApprovalDecision(
  options: PermissionRequestOption[] | undefined,
): PermissionDecision {
  if (!Array.isArray(options)) {
    return "allow";
  }
  return options.find((option) => option.decision === "allow")?.decision
    ?? options.find((option) => option.decision.startsWith("allow"))?.decision
    ?? "allow";
}

export function resolveDashboardApprovalDecisions(): PermissionDecision[] {
  return [...DASHBOARD_APPROVAL_DECISIONS];
}

function buildDashboardApprovalRow(
  item: any,
  sessionsById: Map<string, SessionSummary>,
  resolveDisplaySessionTitle: (session: SessionSummary) => string,
) {
  const request = item.request ?? {};
  const sessionId = item.sessionId ?? request.sessionId;
  const session = sessionId ? sessionsById.get(sessionId) : undefined;
  const command = dashboardText(request.command)
    ?? dashboardText(request.toolName)
    ?? dashboardText(request.kind)
    ?? dashboardText(request.type)
    ?? "权限请求";
  const commandDisplay = resolvePermissionCommandDisplay(command);
  return {
    id: String(item.id ?? request.id ?? item.requestId ?? item.createdAt),
    sessionId: dashboardText(sessionId) ?? undefined,
    kind: commandDisplay.title,
    target: dashboardText(request.reason)
      ?? commandDisplay.detail
      ?? dashboardText(request.description)
      ?? dashboardText(request.path)
      ?? dashboardText(request.url)
      ?? "权限请求",
    allowDecision: resolveDashboardApprovalDecision(request.options),
    decisions: resolveDashboardApprovalDecisions(),
    agentName: session?.agentName ?? request.agentName ?? request.agentId,
    projectName: session?.projectName,
    worktreeName: session?.worktreeName,
    sessionName: session
      ? resolveDisplaySessionTitle(session)
      : dashboardText(sessionId) ?? "未知会话",
    resolving: Boolean(item.resolving) || item.status === "resolving",
    status: item.status ?? (item.resolving ? "resolving" : "pending"),
    decision: item.decision,
    createdAt: item.createdAt ?? item.updatedAt,
    updatedAt: item.updatedAt ?? item.createdAt,
  };
}

export function buildDashboardViewModel(input: DashboardInput) {
  const activeHelmLabel = input.activeHelm
    ? `${input.activeHelm.name ?? "Local Helm"} · ${input.activeHelm.host ?? input.defaultDaemonHost}:${input.activeHelm.port ?? input.defaultDaemonPort}`
    : `${input.daemonHost || input.defaultDaemonHost}:${input.daemonPort || input.defaultDaemonPort}`;

  const helms = (input.helms ?? []).map((helm) => ({
    id: String(helm.id ?? `${helm.host}:${helm.port}`),
    name: String(helm.name ?? "Local Helm"),
    endpoint: `${helm.host ?? input.defaultDaemonHost}:${helm.port ?? input.defaultDaemonPort}`,
    agentCount: Number(helm.agentCount ?? helm.agentsCount ?? input.agents.length),
    projectCount: Number(helm.projectCount ?? helm.projectsCount ?? input.projects.length),
    sessionCount: Number(helm.sessionCount ?? helm.sessions ?? input.sessions.length),
    status: helm.status === "connected" || helm.status === "active" ? "active" as const : "idle" as const,
  }));

  const sessionsById = new Map(input.sessions.map((session) => [session.id, session]));
  const approvals = Object.values(input.approvalItemsById ?? {}).map((item) =>
    buildDashboardApprovalRow(item, sessionsById, input.resolveDisplaySessionTitle)
  );
  const approvalHistory = (input.approvalHistory ?? []).map((item) => {
    const activeItem = input.approvalItemsById[item.id];
    const projectedItem = activeItem?.sessionId === item.sessionId
      && (item.status === "pending" || item.status === "resolving")
      ? { ...item, status: activeItem.resolving ? "resolving" : "pending" }
      : item;
    return {
      ...buildDashboardApprovalRow(
        projectedItem,
        sessionsById,
        input.resolveDisplaySessionTitle,
      ),
      id: JSON.stringify([item.sessionId, item.runtimeInstanceId, item.id]),
    };
  });

  const toolCallCount = Object.values(input.toolCalls ?? {}).reduce(
    (total, calls) => total + (Array.isArray(calls) ? calls.length : 0),
    0,
  );
  const selectedSessionIds = resolveSelectedSessionIds(input);
  const sessions = input.sessions.map((session) => ({
    id: session.id,
    title: input.resolveDisplaySessionTitle(session),
    projectName: session.projectName,
    worktreeName: session.worktreeName,
    agentName: session.agentName,
    status: input.statuses?.[session.id] ?? session.status,
    updatedAt: session.updatedAt,
    selected: selectedSessionIds.has(session.id),
    planSummary: summarizeDashboardPlan(input.sessionPlans?.[session.id]) ?? undefined,
  }));
  const planSessionCount = sessions.filter((session) => session.planSummary).length;
  const completedPlanSessionCount = sessions.filter(
    (session) =>
      session.planSummary &&
      session.planSummary.completed === session.planSummary.total,
  ).length;

  return {
    activeHelmLabel,
    onlineHelmCount: input.connection === "connected" ? 1 : 0,
    totalHelmCount: Math.max(helms.length, 1),
    activeSessionCount: input.sessions.length,
    pendingApprovalCount: approvals.length,
    planSessionCount,
    completedPlanSessionCount,
    toolCallCount,
    sessions,
    helms,
    approvals,
    approvalHistory,
    notifications: (input.notifications ?? []).map((notification) => {
      const session = notification.sessionId ? sessionsById.get(notification.sessionId) : undefined;
      return {
        ...notification,
        sessionName: session
          ? input.resolveDisplaySessionTitle(session)
          : notification.sessionId,
      };
    }),
  };
}
