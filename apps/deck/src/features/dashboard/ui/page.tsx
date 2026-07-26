import type { PermissionDecision } from "@tiller/shared";
import { Icon, StatusDot } from "../../../shared/ui";
import {
  DashboardActivityStream,
  type DashboardActivityApproval,
  type DashboardActivitySession,
} from "./activity-stream";
import {
  DashboardNotificationList,
} from "./notification-list";
import type { DashboardNotification } from "../orchestration/dashboard-view-model";

type DashboardHelm = {
  id: string;
  name: string;
  endpoint: string;
  agentCount: number;
  projectCount: number;
  sessionCount: number;
  status: "active" | "idle";
};

type DashboardApproval = DashboardActivityApproval & {
  id: string;
  kind: string;
  target: string;
  allowDecision: PermissionDecision;
  decisions?: PermissionDecision[];
  resolving?: boolean;
};

type DashboardSession = DashboardActivitySession;

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
  approvalHistory?: DashboardActivityApproval[];
  notifications?: DashboardNotification[];
  onNavigateAgents: () => void;
  onOpenSession?: (sessionId: string) => void;
  onRespondApproval?: (approvalRequestId: string, decision: PermissionDecision) => void;
  onClearNotifications?: () => void;
  onClearApprovalHistory?: () => void;
  isMobile?: boolean;
};

function formatApprovalScope(approval: DashboardApproval) {
  return [approval.projectName, approval.worktreeName]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" / ") || approval.target;
}

const DASHBOARD_APPROVAL_ACTION_LABELS: Record<PermissionDecision, string> = {
  deny: "取消",
  allow: "单次",
  allow_session: "会话",
  allow_always: "全局",
  deny_always: "禁用",
};

const DASHBOARD_APPROVAL_ACTION_TITLES: Record<PermissionDecision, string> = {
  deny: "取消本次审批",
  allow: "仅本次允许",
  allow_session: "本会话允许",
  allow_always: "全局允许",
  deny_always: "始终拒绝",
};

function resolveApprovalDecisions(approval: DashboardApproval): PermissionDecision[] {
  return approval.decisions?.length
    ? approval.decisions
    : ["deny", "allow", "allow_session", "allow_always"];
}

function DashboardApprovalActions({
  approval,
  onRespondApproval,
}: {
  approval: DashboardApproval;
  onRespondApproval?: (approvalRequestId: string, decision: PermissionDecision) => void;
}) {
  return (
    <div className="dashboard-approval-actions grid grid-cols-4 gap-1 rounded bg-surface-sunken p-0.5">
      {resolveApprovalDecisions(approval).map((decision) => (
        <button
          key={decision}
          type="button"
          className={`h-7 rounded px-1.5 text-[11px] font-medium tabular transition-colors disabled:opacity-50 ${
            decision === "allow"
              ? "bg-primary text-on-primary hover:opacity-90"
              : "text-muted-foreground hover:bg-surface-emphasis hover:text-foreground"
          }`}
          title={DASHBOARD_APPROVAL_ACTION_TITLES[decision]}
          disabled={approval.resolving || !onRespondApproval}
          aria-busy={approval.resolving || undefined}
          onClick={() => onRespondApproval?.(approval.id, decision)}
        >
          {approval.resolving ? "..." : DASHBOARD_APPROVAL_ACTION_LABELS[decision]}
        </button>
      ))}
    </div>
  );
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
  approvalHistory = approvals,
  notifications = [],
  onNavigateAgents,
  onOpenSession,
  onRespondApproval,
  onClearNotifications,
  onClearApprovalHistory,
  isMobile = false,
}: DashboardPageProps) {
  const approvalRows = approvals;
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
              <li key={p.id || i} className="grid gap-2 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Icon name="shield" size={15} className="text-warning shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-section tabular text-foreground truncate">{p.kind}</div>
                    <div className="font-mono text-meta text-muted-foreground tabular truncate mt-0.5">
                      {formatApprovalScope(p)}
                    </div>
                  </div>
                </div>
                <DashboardApprovalActions approval={p} onRespondApproval={onRespondApproval} />
              </li>
            ))}
          </ul>
        </section>

        <div className="mb-3">
          <DashboardNotificationList
            notifications={notifications}
            onOpenSession={onOpenSession}
            onClear={onClearNotifications}
          />
        </div>

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

        <DashboardActivityStream
          sessions={sessions}
          approvals={approvalHistory}
          planSessionCount={planSessionCount}
          toolCallCount={toolCallCount}
          onOpenSession={onOpenSession}
          onClearApprovalHistory={onClearApprovalHistory}
          isMobile
        />
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
        <DashboardActivityStream
          sessions={sessions}
          approvals={approvalHistory}
          planSessionCount={planSessionCount}
          toolCallCount={toolCallCount}
          notifications={notifications}
          onOpenSession={onOpenSession}
          onClearNotifications={onClearNotifications}
          onClearApprovalHistory={onClearApprovalHistory}
        />

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
                    <div className="font-mono text-action tabular text-foreground truncate">{approval.kind}</div>
                    <p className="mt-0.5 truncate font-mono text-meta tabular text-muted-foreground">
                      {formatApprovalScope(approval)}
                    </p>
                  </div>
                  <DashboardApprovalActions approval={approval} onRespondApproval={onRespondApproval} />
                </li>
              ))}
            </ul>
          </section>

        </aside>
      </div>
    </section>
  );
}
