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

function buildActivities(sessions: SessionSummary[] = []): DashboardActivity[] {
  const activities = sessions.slice(0, 6).map((session, index) => ({
    id: session.id,
    time: formatActivityTime(session.updatedAt),
    tone: index === 0 ? "primary" as const : "idle" as const,
    icon: index === 0 ? "message" as const : "activity" as const,
    title: index === 0 ? "最新会话 · session update" : "会话活动 · session",
    meta: resolveSessionTitle(session),
  }));

  if (activities.length > 0) return activities;
  return [
    {
      id: "empty",
      time: "--:--:--",
      tone: "idle",
      icon: "server",
      title: "等待本地 Helm 活动",
      meta: "连接后会显示会话、权限与工具调用事件",
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
}: DashboardPageProps) {
  const activities = buildActivities(sessions);
  const approvalRows = approvals.length > 0 ? approvals : FALLBACK_APPROVALS;
  const helmRows = helms.length > 0 ? helms : [
    {
      id: "active",
      name: "workstation",
      endpoint: activeHelmLabel,
      agentCount: 0,
      projectCount: 0,
      sessionCount: activeSessionCount,
      status: onlineHelmCount > 0 ? "active" as const : "idle" as const,
    },
  ];
  const kpis = [
    { label: "在线 Helm", value: `${onlineHelmCount} / ${totalHelmCount}`, sub: `${Math.max(totalHelmCount - onlineHelmCount, 0)} idle`, icon: "server" as const, tone: onlineHelmCount > 0 ? "active" as const : "idle" as const },
    { label: "活跃会话", value: String(activeSessionCount), sub: activeSessionCount > 0 ? "streaming" : "idle", icon: "activity" as const, tone: activeSessionCount > 0 ? "primary" as const : "idle" as const },
    { label: "待审批", value: String(pendingApprovalCount), sub: "权限请求", icon: "shield" as const, tone: pendingApprovalCount > 0 ? "warning" as const : "idle" as const },
    { label: "本日消息", value: String(localMessageCount), sub: `+${toolCallCount} 工具调用`, icon: "activity" as const, tone: "idle" as const },
  ];

  return (
    <section className="dashboard-page mx-auto max-w-[1280px] px-4 py-4" aria-label="Dashboard">
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <article key={kpi.label} className="wb-pane flex items-start gap-2.5 p-3">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded bg-surface-sunken text-muted-foreground">
              <Icon name={kpi.icon} size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <strong className="tabular text-[20px] font-semibold">{kpi.value}</strong>
                <StatusDot tone={kpi.tone} size={5} pulse={kpi.tone === "active" || kpi.tone === "primary"} />
              </div>
              <p className="text-2xs uppercase tracking-wider text-muted-foreground">{kpi.label}</p>
              <p className="mt-1 font-mono text-2xs tabular text-muted-foreground">{kpi.sub}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <section className="wb-pane flex min-h-[520px] flex-col lg:col-span-2">
          <div className="wb-pane-head">
            <span className="wb-pane-head-eyebrow">活动流</span>
            <div className="ml-2 flex items-center gap-1">
              {['全部', '会话', '权限', '系统'].map((item, index) => (
                <button key={item} type="button" className={`h-5 rounded px-1.5 text-2xs ${index === 0 ? 'bg-surface-sunken' : 'text-muted-foreground hover:bg-surface-sunken'}`}>
                  {item}
                </button>
              ))}
            </div>
            <span className="ml-auto font-mono text-2xs tabular text-muted-foreground">实时</span>
            <StatusDot tone="primary" pulse size={5} />
          </div>
          <ul className="flex-1 overflow-auto">
            {activities.map((activity) => (
              <li key={activity.id} className="flex items-start gap-2 border-b border-border-ghost px-3 py-2 transition-colors last:border-b-0 hover:bg-surface-sunken">
                <span className="w-[60px] shrink-0 pt-0.5 font-mono text-2xs tabular text-muted-foreground">{activity.time}</span>
                <div className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded bg-surface-sunken text-muted-foreground">
                  <Icon name={activity.icon} size={11} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <StatusDot tone={activity.tone} size={5} />
                    <span className="truncate text-[12.5px]">{activity.title}</span>
                  </div>
                  <p className="truncate font-mono text-2xs tabular text-muted-foreground">{activity.meta}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline gap-2 border-t border-border-ghost px-3 py-2">
            <span className="font-mono text-2xs uppercase tracking-wider text-muted-foreground">24H</span>
            <Sparkline />
            <span className="ml-auto font-mono text-2xs tabular text-muted-foreground">{localMessageCount} msg · {toolCallCount} tool</span>
          </div>
        </section>

        <aside className="flex flex-col gap-3">
          <section className="wb-pane">
            <div className="wb-pane-head">
              <span className="wb-pane-head-eyebrow">Helm 矩阵</span>
              <button type="button" onClick={onNavigateAgents} className="ml-auto text-2xs text-muted-foreground hover:text-foreground">管理 ›</button>
            </div>
            <ul className="divide-y divide-border-ghost">
              {helmRows.map((helm) => (
                <li key={helm.id} className="flex items-center gap-2 px-2.5 py-1.5">
                  <StatusDot tone={helm.status === "active" ? "active" : "idle"} pulse={helm.status === "active"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px]">{helm.name}</p>
                    <p className="truncate font-mono text-2xs tabular text-muted-foreground">{helm.endpoint}</p>
                  </div>
                  <div className="text-right font-mono text-2xs tabular text-muted-foreground">
                    <p>{helm.agentCount}A · {helm.projectCount}P</p>
                    <p>{helm.sessionCount} sess</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="wb-pane">
            <div className="wb-pane-head">
              <span className="wb-pane-head-eyebrow">待审批</span>
              <span className="ml-1.5 font-mono text-2xs tabular text-warning">{pendingApprovalCount}</span>
              <button type="button" className="ml-auto text-2xs text-muted-foreground hover:text-foreground">查看全部 ›</button>
            </div>
            <ul className="divide-y divide-border-ghost">
              {approvalRows.map((approval) => (
                <li key={approval.id} className="flex items-center gap-2 px-2.5 py-1.5">
                  <Icon name="shield" size={12} className="text-warning" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-2xs tabular text-foreground">{approval.kind}</span>
                      <AgentIcon name={approval.agentName} size={10} />
                    </div>
                    <p className="truncate font-mono text-2xs tabular text-muted-foreground">{approval.target}</p>
                  </div>
                  <button type="button" className="h-5 rounded bg-primary px-1.5 text-2xs text-on-primary">Allow</button>
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
