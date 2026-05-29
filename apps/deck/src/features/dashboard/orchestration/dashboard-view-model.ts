import type {
  HelmSummary,
  PermissionDecision,
  PermissionRequestOption,
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
  toolCalls: Record<string, unknown[]>;
  approvalItemsById: Record<string, any>;
  resolveDisplaySessionTitle: (session: SessionSummary) => string;
};

function dashboardText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  const approvals = Object.values(input.approvalItemsById ?? {}).map((item) => {
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
      kind: commandDisplay.title,
      target: dashboardText(request.reason)
        ?? commandDisplay.detail
        ?? dashboardText(request.description)
        ?? dashboardText(request.path)
        ?? dashboardText(request.url)
        ?? "权限请求",
      allowDecision: resolveDashboardApprovalDecision(request.options),
      agentName: session?.agentName ?? request.agentName ?? request.agentId,
      sessionName: session
        ? input.resolveDisplaySessionTitle(session)
        : dashboardText(sessionId) ?? "未知会话",
      resolving: Boolean(item.resolving),
    };
  });

  const toolCallCount = Object.values(input.toolCalls ?? {}).reduce(
    (total, calls) => total + (Array.isArray(calls) ? calls.length : 0),
    0,
  );

  return {
    activeHelmLabel,
    onlineHelmCount: input.connection === "connected" ? 1 : 0,
    totalHelmCount: Math.max(helms.length, 1),
    activeSessionCount: input.sessions.length,
    pendingApprovalCount: approvals.length,
    localMessageCount: input.sessions.length,
    toolCallCount,
    sessions: input.sessions,
    helms,
    approvals,
  };
}
