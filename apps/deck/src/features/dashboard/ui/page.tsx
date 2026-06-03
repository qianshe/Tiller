import { useState } from "react";
import type { PermissionDecision } from "@tiller/shared";
import { AgentIcon, Icon, StatusDot } from "../../../shared/ui";

type DashboardHelm = {
  id: string;
  name: string;
  endpoint: string;
  agentCount: number;
  projectCount: number;
  sessionCount: number;
  status: "active" | "idle";
};

type DashboardApproval = {
  id: string;
  kind: string;
  target: string;
  allowDecision: PermissionDecision;
  agentName?: string;
  sessionName?: string;
  resolving?: boolean;
};

type DashboardActivity = {
  id: string;
  sessionId?: string;
  time: string;
  tone: "active" | "primary" | "warning" | "danger" | "idle";
  pulse?: boolean;
  icon: "message" | "shield" | "activity";
  title: string;
  meta: string;
  type: "会话" | "权限";
  agentName?: string | null;
  stateLabel: "已选中" | "运行中" | "出错" | "未选中" | "待审批";
  planSummary?: DashboardSession["planSummary"];
};

type DashboardSession = {
  id: string;
  title: string;
  agentName?: string | null;
  status?: string;
  selected?: boolean;
  updatedAt?: string;
  planSummary?: {
    completed: number;
    total: number;
    label: string;
  };
};

export type DashboardPageProps = {
  activeHelmLabel: string;
  onlineHelmCount: number;
  totalHelmCount: number;
  activeSessionCount: number;
  pendingApprovalCount: number;
  planSessionCount: number;
  completedPlanSessionCount: number;
  toolCallCount: number;
  sessions?: DashboardSession[];
  helms?: DashboardHelm[];
  approvals?: DashboardApproval[];
  onNavigateAgents: () => void;
  onOpenSession?: (sessionId: string) => void;
  onRespondApproval?: (approvalRequestId: string, decision: PermissionDecision) => void;
  isMobile?: boolean;
};

const FALLBACK_APPROVALS: DashboardApproval[] = [
  { id: "file.write", kind: "file.write", target: "等待权限请求", allowDecision: "allow", agentName: "codex" },
];

function formatActivityTime(value?: string) {
  if (!value) return "--:--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function resolveSessionActivityState(
  status: string | undefined,
  selected: boolean,
): Pick<DashboardActivity, "tone" | "pulse" | "stateLabel"> {
  const normalized = (status ?? "").toLowerCase();
  if (normalized.includes("error") || normalized.includes("fail")) {
    return { tone: "danger", stateLabel: "出错" };
  }
  if (normalized === "running" || normalized === "starting") {
    return { tone: "active", pulse: true, stateLabel: "运行中" };
  }
  if (normalized === "waiting_for_permission") {
    return { tone: "warning", stateLabel: "待审批" };
  }
  if (selected) {
    return { tone: "primary", stateLabel: "已选中" };
  }
  return { tone: "idle", stateLabel: "未选中" };
}

function buildActivities(
  sessions: DashboardSession[] = [],
  approvals: DashboardApproval[] = [],
): DashboardActivity[] {
  const list: DashboardActivity[] = [];

  // 1. 会话事件
  sessions.forEach((session, index) => {
    const state = resolveSessionActivityState(session.status, session.selected ?? index === 0);
    list.push({
      id: `session-${session.id}`,
      sessionId: session.id,
      time: formatActivityTime(session.updatedAt),
      ...state,
      icon: "message" as const,
      title: session.title || session.id,
      meta: session.id,
      type: "会话",
      agentName: session.agentName || "Agent",
      planSummary: session.planSummary,
    });
  });

  // 2. 权限事件（待审批）
  approvals.forEach((app) => {
    list.push({
      id: `approval-${app.id}`,
      time: formatActivityTime(new Date().toISOString()),
      tone: "warning" as const,
      icon: "shield" as const,
      title: app.sessionName ?? app.target,
      meta: `${app.kind} · ${app.target}`,
      type: "权限",
      agentName: app.agentName || "Agent",
      stateLabel: "待审批" as const,
    });
  });

  if (list.length > 0) return list;

  return [
    {
      id: "empty",
      time: "--:--:--",
      tone: "idle" as const,
      icon: "activity" as const,
      title: "等待本地 Helm 活动",
      meta: "连接后会显示会话、权限与工具调用事件",
      type: "会话",
      agentName: "Helm",
      stateLabel: "未选中" as const,
    },
  ];
}

export function DashboardPage({
  activeHelmLabel,
  onlineHelmCount,
  totalHelmCount,
  activeSessionCount,
  pendingApprovalCount,
  planSessionCount,
  completedPlanSessionCount,
  toolCallCount,
  sessions = [],
  helms = [],
  approvals = [],
  onNavigateAgents,
  onOpenSession,
  onRespondApproval,
  isMobile = false,
}: DashboardPageProps) {
  const [activeTab, setActiveTab] = useState<"全部" | "会话" | "权限">("全部");

  const approvalRows = approvals.length > 0 ? approvals : FALLBACK_APPROVALS;
  const helmRows = helms.length > 0 ? helms : [
    {
      id: "active",
      name: "workstation",
      endpoint: activeHelmLabel,
      agentCount: 0,
      projectCount: 0,
      sessionCount: activeSessionCount,
      status: onlineHelmCount > 0 ? ("active" as const) : ("idle" as const),
    },
  ];

  const rawActivities = buildActivities(sessions, approvals);
  const filteredActivities = activeTab === "全部"
    ? rawActivities
    : rawActivities.filter((a) => a.type === activeTab);

  const kpis = [
    { label: "在线 Helm", value: `${onlineHelmCount} / ${totalHelmCount}`, sub: `${Math.max(totalHelmCount - onlineHelmCount, 0)} idle`, icon: "server" as const, tone: onlineHelmCount > 0 ? ("active" as const) : ("idle" as const) },
    { label: "活跃会话", value: String(activeSessionCount), sub: activeSessionCount > 0 ? "streaming" : "idle", icon: "activity" as const, tone: activeSessionCount > 0 ? ("primary" as const) : ("idle" as const) },
    { label: "待审批", value: String(pendingApprovalCount), sub: "权限请求", icon: "shield" as const, tone: pendingApprovalCount > 0 ? ("warning" as const) : ("idle" as const) },
    { label: "计划", value: String(planSessionCount), sub: `${completedPlanSessionCount} 已完成 · ${toolCallCount} 工具`, icon: "activity" as const, tone: planSessionCount > completedPlanSessionCount ? ("primary" as const) : ("idle" as const) },
  ];

  if (isMobile) {
    return (
      <div className="px-3 py-3">
        {/* KPI · 2x2 */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          {kpis.map(m => (
            <div key={m.label} className="wb-pane p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded grid place-items-center bg-surface-sunken text-muted-foreground shrink-0">
                  <Icon name={m.icon} size={13} />
                </div>
                <span className="text-meta text-muted-foreground uppercase tracking-wider truncate">{m.label}</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-[24px] font-semibold tabular leading-none">{m.value}</span>
                <StatusDot tone={m.tone} size={6} pulse={m.tone === "active" || m.tone === "primary"} />
              </div>
              <div className="font-mono text-meta text-muted-foreground tabular mt-1 truncate">{m.sub}</div>
            </div>
          ))}
        </div>

        {/* 待审批 · 移到上方(高优先) */}
        <section className="wb-pane mb-3">
          <div className="wb-pane-head min-h-9">
            <span className="wb-pane-head-title">待审批</span>
            <span className="ml-1.5 font-mono text-action font-medium text-warning tabular">{pendingApprovalCount}</span>
            <div className="flex-1" />
          </div>
          <ul className="divide-y divide-border-ghost">
            {approvalRows.map((p, i) => (
              <li key={p.id || i} className="px-3 py-2.5 flex items-center gap-2.5">
                <Icon name="shield" size={15} className="text-warning shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-mono text-section tabular text-foreground truncate">{p.sessionName ?? p.kind}</span>
                    <AgentIcon name={p.agentName} size={11} />
                  </div>
                  <div className="font-mono text-meta text-muted-foreground tabular truncate mt-0.5">
                    {p.sessionName ? `${p.kind} · ${p.target}` : p.target}
                  </div>
                </div>
                <button
                  type="button"
                  className="h-8 px-3 rounded text-section font-medium bg-primary text-on-primary active:opacity-90 shrink-0 dashboard-allow-btn disabled:opacity-50"
                  disabled={p.resolving || !onRespondApproval}
                  aria-busy={p.resolving || undefined}
                  onClick={() => onRespondApproval?.(p.id, p.allowDecision)}
                >
                  {p.resolving ? "..." : "Allow"}
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Helm 矩阵 */}
        <section className="wb-pane mb-3">
          <div className="wb-pane-head min-h-9">
            <span className="wb-pane-head-title">Helm 矩阵</span>
            <div className="flex-1" />
            <button onClick={onNavigateAgents} className="text-meta text-muted-foreground active:text-foreground">
              管理 ›
            </button>
          </div>
          <ul className="divide-y divide-border-ghost">
            {helmRows.map(h => (
              <li key={h.id} className="px-3 py-2.5 flex items-center gap-2.5">
                <StatusDot tone={h.status === "active" ? "active" : "idle"} pulse={h.status === "active"} />
                <div className="flex-1 min-w-0">
                  <div className="text-section truncate">{h.name}</div>
                  <div className="font-mono text-meta text-muted-foreground tabular truncate mt-0.5">{h.endpoint}</div>
                </div>
                <div className="font-mono text-meta text-muted-foreground tabular text-right shrink-0 leading-tight">
                  <div>{h.agentCount}A · {h.projectCount}P</div>
                  <div>{h.sessionCount} sess</div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* 活动流 */}
        <section className="wb-pane">
          <div className="wb-pane-head min-h-9">
            <span className="wb-pane-head-title">活动流</span>
            <div className="flex-1" />
            <StatusDot tone="primary" pulse size={5} />
            <span className="font-mono text-meta text-muted-foreground tabular ml-1">实时</span>
          </div>
          <ul className="divide-y divide-border-ghost">
            {filteredActivities.slice(0, 4).map(a => (
              <li key={a.id}>
                <button
                  type="button"
                  className="overview-session-item-btn overview-activity-row flex w-full items-center gap-2 px-3 py-2 text-left active:bg-surface-sunken disabled:cursor-default"
                  disabled={!a.sessionId || !onOpenSession}
                  aria-label={`${a.type}: ${a.title}. ${a.stateLabel}. ${a.agentName ?? "Agent"}`}
                  onClick={() => a.sessionId ? onOpenSession?.(a.sessionId) : undefined}
                >
                  <span className="w-[58px] shrink-0 font-mono text-meta tabular text-muted-foreground">{a.time}</span>
                  <div className="grid h-6 w-6 shrink-0 place-items-center rounded bg-surface-sunken text-muted-foreground" aria-hidden="true">
                    <Icon name={a.icon} size={12} />
                  </div>
                  <StatusDot tone={a.tone} pulse={a.pulse} size={6} />
                  <span className="min-w-0 flex-1 truncate text-section">{a.title}</span>
                  <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {a.planSummary ? <span className="rounded border border-border-ghost px-1.5 py-0.5 font-mono text-meta tabular text-muted-foreground">{a.planSummary.label}</span> : null}
                    <span className="overview-activity-agent flex max-w-[84px] items-center gap-1 rounded bg-surface-sunken px-1.5 py-0.5 text-meta text-muted-foreground">
                      <AgentIcon name={a.agentName ?? undefined} size={10} />
                      <span className="truncate">{a.agentName ?? "Agent"}</span>
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-border-ghost px-3 py-2.5 flex items-baseline gap-2">
            <span className="font-mono text-meta text-muted-foreground uppercase tracking-wider">24h</span>
            <Sparkline />
          </div>
        </section>
      </div>
    );
  }

  return (
    <section className="dashboard-page mx-auto max-w-[1280px] px-4 py-4" aria-label="Dashboard">
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <article key={kpi.label} className="wb-pane flex items-start gap-2.5 p-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded bg-surface-sunken text-muted-foreground">
              <Icon name={kpi.icon} size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <strong className="tabular text-display font-semibold leading-none">{kpi.value}</strong>
                <StatusDot tone={kpi.tone} size={6} pulse={kpi.tone === "active" || kpi.tone === "primary"} />
              </div>
              <p className="mt-1 text-meta uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
              <p className="mt-0.5 font-mono text-meta tabular text-muted-foreground">{kpi.sub}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <section className="wb-pane flex min-h-[520px] flex-col lg:col-span-2">
          <div className="wb-pane-head min-h-9">
            <span className="wb-pane-head-title">活动流</span>
            <div className="ml-2 flex items-center gap-1">
              {(["全部", "会话", "权限"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setActiveTab(item)}
                  className={`h-6 rounded px-2 text-meta ${activeTab === item ? "bg-surface-sunken font-medium text-foreground" : "text-muted-foreground hover:bg-surface-sunken"}`}
                >
                  {item}
                </button>
              ))}
            </div>
            <span className="ml-auto font-mono text-meta tabular text-muted-foreground">实时</span>
            <StatusDot tone="primary" pulse size={5} />
          </div>
          <ul className="flex-1 overflow-auto">
            {filteredActivities.map((activity) => (
              <li key={activity.id} className="border-b border-border-ghost last:border-b-0">
                <button
                  type="button"
                  className="overview-activity-row flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-sunken disabled:cursor-default"
                  disabled={!activity.sessionId || !onOpenSession}
                  aria-label={`${activity.type}: ${activity.title}. ${activity.stateLabel}. ${activity.agentName ?? "Agent"}`}
                  onClick={() => activity.sessionId ? onOpenSession?.(activity.sessionId) : undefined}
                >
                  <span className="w-[68px] shrink-0 font-mono text-meta tabular text-muted-foreground">{activity.time}</span>
                  <div className="grid h-6 w-6 shrink-0 place-items-center rounded bg-surface-sunken text-muted-foreground" aria-hidden="true">
                    <Icon name={activity.icon} size={12} />
                  </div>
                  <StatusDot tone={activity.tone} pulse={activity.pulse} size={6} />
                  <span className="min-w-0 flex-1 truncate text-section">{activity.title}</span>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    {activity.planSummary ? <span className="rounded border border-border-ghost px-1.5 py-0.5 font-mono text-meta tabular text-muted-foreground">{activity.planSummary.label}</span> : null}
                    <span className="overview-activity-agent flex max-w-[120px] items-center gap-1.5 rounded bg-surface-sunken px-2 py-1 text-meta text-muted-foreground">
                      <AgentIcon name={activity.agentName ?? undefined} size={11} />
                      <span className="truncate">{activity.agentName ?? "Agent"}</span>
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline gap-2 border-t border-border-ghost px-3 py-2.5">
            <span className="font-mono text-meta uppercase tracking-wider text-muted-foreground">24h</span>
            <Sparkline />
            <span className="ml-auto font-mono text-meta tabular text-muted-foreground">{planSessionCount} plan · {toolCallCount} tool</span>
          </div>
        </section>

        <aside className="flex flex-col gap-3">
          <section className="wb-pane">
            <div className="wb-pane-head min-h-9">
              <span className="wb-pane-head-title">Helm 矩阵</span>
              <button type="button" onClick={onNavigateAgents} className="ml-auto text-meta text-muted-foreground hover:text-foreground">管理 ›</button>
            </div>
            <ul className="divide-y divide-border-ghost">
              {helmRows.map((helm) => (
                <li key={helm.id} className="flex items-center gap-2.5 px-3 py-2">
                  <StatusDot tone={helm.status === "active" ? "active" : "idle"} pulse={helm.status === "active"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-section">{helm.name}</p>
                    <p className="mt-0.5 truncate font-mono text-meta tabular text-muted-foreground">{helm.endpoint}</p>
                  </div>
                  <div className="text-right font-mono text-meta tabular leading-tight text-muted-foreground">
                    <p>{helm.agentCount}A · {helm.projectCount}P</p>
                    <p>{helm.sessionCount} sess</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="wb-pane">
            <div className="wb-pane-head min-h-9">
              <span className="wb-pane-head-title">待审批</span>
              <span className="ml-1.5 font-mono text-action font-medium tabular text-warning">{pendingApprovalCount}</span>
              <button type="button" className="ml-auto text-meta text-muted-foreground hover:text-foreground">查看全部 ›</button>
            </div>
            <ul className="divide-y divide-border-ghost">
              {approvalRows.map((approval) => (
                <li key={approval.id} className="flex items-center gap-2.5 px-3 py-2.5">
                  <Icon name="shield" size={14} className="shrink-0 text-warning" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-action tabular text-foreground truncate">{approval.sessionName ?? approval.kind}</span>
                      <AgentIcon name={approval.agentName} size={10} />
                    </div>
                    <p className="mt-0.5 truncate font-mono text-meta tabular text-muted-foreground">
                      {approval.sessionName ? `${approval.kind} · ${approval.target}` : approval.target}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="h-7 shrink-0 rounded bg-primary px-3 text-action font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
                    disabled={approval.resolving || !onRespondApproval}
                    aria-busy={approval.resolving || undefined}
                    onClick={() => onRespondApproval?.(approval.id, approval.allowDecision)}
                  >
                    {approval.resolving ? "..." : "Allow"}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </section>
  );
}

function Sparkline() {
  const points = [3, 5, 4, 8, 6, 9, 7, 12, 10, 14, 11, 16, 13, 19, 15, 17, 14, 20, 18, 22, 17, 25, 19, 23];
  const max = Math.max(...points);
  return (
    <svg width="180" height="20" viewBox={`0 0 ${points.length * 6} 20`} className="text-primary" aria-hidden="true">
      {points.map((point, index) => {
        const height = Math.max(2, (point / max) * 18);
        return (
          <rect key={`${point}-${index}`} x={index * 6} y={20 - height} width="4" height={height} fill="currentColor" opacity={0.6 + (index / points.length) * 0.4} rx="1" />
        );
      })}
    </svg>
  );
}
