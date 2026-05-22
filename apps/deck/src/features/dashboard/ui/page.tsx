import { useState } from "react";
import type { SessionSummary } from "@tiller/shared";
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
  agentName?: string;
};

type DashboardActivity = {
  id: string;
  time: string;
  tone: "active" | "primary" | "warning" | "idle";
  icon: "message" | "shield" | "activity" | "server" | "branch";
  title: string;
  meta: string;
  type: string;
};

export type DashboardPageProps = {
  activeHelmLabel: string;
  onlineHelmCount: number;
  totalHelmCount: number;
  activeSessionCount: number;
  pendingApprovalCount: number;
  localMessageCount: number;
  toolCallCount: number;
  sessions?: SessionSummary[];
  helms?: DashboardHelm[];
  approvals?: DashboardApproval[];
  onNavigateAgents: () => void;
  isMobile?: boolean;
};

const FALLBACK_APPROVALS: DashboardApproval[] = [
  { id: "file.write", kind: "file.write", target: "等待权限请求", agentName: "codex" },
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

function resolveSessionTitle(session: SessionSummary) {
  return session.title || session.id;
}

function buildActivities(
  sessions: SessionSummary[] = [],
  approvals: DashboardApproval[] = [],
  helms: DashboardHelm[] = []
): DashboardActivity[] {
  const list: DashboardActivity[] = [];

  // 1. 会话事件
  sessions.forEach((session, index) => {
    list.push({
      id: `session-${session.id}`,
      time: formatActivityTime(session.updatedAt),
      tone: index === 0 ? ("primary" as const) : ("idle" as const),
      icon: "message" as const,
      title: `会话活动 · ${session.agentName || "Agent"}`,
      meta: resolveSessionTitle(session),
      type: "会话",
    });
  });

  // 2. 权限事件（待审批）
  approvals.forEach((app) => {
    list.push({
      id: `approval-${app.id}`,
      time: formatActivityTime(new Date().toISOString()),
      tone: "warning" as const,
      icon: "shield" as const,
      title: `权限请求 · ${app.kind}`,
      meta: `${app.agentName || "Agent"} 请求操作: ${app.target}`,
      type: "权限",
    });
  });

  // 3. 系统事件
  helms.forEach((h) => {
    list.push({
      id: `helm-${h.id}`,
      time: formatActivityTime(new Date().toISOString()),
      tone: h.status === "active" ? ("active" as const) : ("idle" as const),
      icon: "server" as const,
      title: `Helm 节点 · ${h.name}`,
      meta: `节点状态变更为: ${h.status === "active" ? "活动" : "空闲"} (${h.endpoint})`,
      type: "系统",
    });
  });

  if (list.length > 0) return list;

  return [
    {
      id: "empty",
      time: "--:--:--",
      tone: "idle" as const,
      icon: "server" as const,
      title: "等待本地 Helm 活动",
      meta: "连接后会显示会话、权限与工具调用事件",
      type: "系统",
    },
  ];
}

export function DashboardPage({
  activeHelmLabel,
  onlineHelmCount,
  totalHelmCount,
  activeSessionCount,
  pendingApprovalCount,
  localMessageCount,
  toolCallCount,
  sessions = [],
  helms = [],
  approvals = [],
  onNavigateAgents,
  isMobile = false,
}: DashboardPageProps) {
  const [activeTab, setActiveTab] = useState<"全部" | "会话" | "权限" | "系统">("全部");

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

  const rawActivities = buildActivities(sessions, approvals, helmRows);
  const filteredActivities = activeTab === "全部"
    ? rawActivities
    : rawActivities.filter((a) => a.type === activeTab || (activeTab === "系统" && a.id === "empty"));

  const kpis = [
    { label: "在线 Helm", value: `${onlineHelmCount} / ${totalHelmCount}`, sub: `${Math.max(totalHelmCount - onlineHelmCount, 0)} idle`, icon: "server" as const, tone: onlineHelmCount > 0 ? ("active" as const) : ("idle" as const) },
    { label: "活跃会话", value: String(activeSessionCount), sub: activeSessionCount > 0 ? "streaming" : "idle", icon: "activity" as const, tone: activeSessionCount > 0 ? ("primary" as const) : ("idle" as const) },
    { label: "待审批", value: String(pendingApprovalCount), sub: "权限请求", icon: "shield" as const, tone: pendingApprovalCount > 0 ? ("warning" as const) : ("idle" as const) },
    { label: "本日消息", value: String(localMessageCount), sub: `+${toolCallCount} 工具调用`, icon: "activity" as const, tone: "idle" as const },
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
                    <span className="font-mono text-section tabular text-foreground">{p.kind}</span>
                    <AgentIcon name={p.agentName} size={11} />
                  </div>
                  <div className="font-mono text-meta text-muted-foreground tabular truncate mt-0.5">{p.target}</div>
                </div>
                <button className="h-8 px-3 rounded text-section font-medium bg-primary text-on-primary active:opacity-90 shrink-0 dashboard-allow-btn">
                  Allow
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
              <li
                key={a.id}
                className="flex items-start gap-2.5 px-3 py-2.5 active:bg-surface-sunken overview-session-item-btn"
              >
                <span className="font-mono text-meta text-muted-foreground tabular pt-0.5 w-[58px] shrink-0">{a.time}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <StatusDot tone={a.tone} size={6} />
                    <span className="text-section truncate">{a.title}</span>
                  </div>
                  <div className="font-mono text-meta text-muted-foreground tabular truncate mt-0.5">{a.meta}</div>
                </div>
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
              {(["全部", "会话", "权限", "系统"] as const).map((item) => (
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
              <li key={activity.id} className="flex items-start gap-2.5 border-b border-border-ghost last:border-b-0 px-3 py-2.5 transition-colors hover:bg-surface-sunken">
                <span className="w-[68px] shrink-0 pt-0.5 font-mono text-meta tabular text-muted-foreground">{activity.time}</span>
                <div className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded bg-surface-sunken text-muted-foreground">
                  <Icon name={activity.icon} size={12} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <StatusDot tone={activity.tone} size={6} />
                    <span className="truncate text-section">{activity.title}</span>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-meta tabular text-muted-foreground">{activity.meta}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline gap-2 border-t border-border-ghost px-3 py-2.5">
            <span className="font-mono text-meta uppercase tracking-wider text-muted-foreground">24h</span>
            <Sparkline />
            <span className="ml-auto font-mono text-meta tabular text-muted-foreground">{localMessageCount} msg · {toolCallCount} tool</span>
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
                      <span className="font-mono text-action tabular text-foreground">{approval.kind}</span>
                      <AgentIcon name={approval.agentName} size={10} />
                    </div>
                    <p className="mt-0.5 truncate font-mono text-meta tabular text-muted-foreground">{approval.target}</p>
                  </div>
                  <button type="button" className="h-7 shrink-0 rounded bg-primary px-3 text-action font-medium text-on-primary hover:opacity-90">Allow</button>
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
