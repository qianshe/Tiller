import { useState, type CSSProperties } from "react";
import type { ApprovalStatus, PermissionDecision } from "@tiller/shared";
import { AgentIcon, Icon, StatusDot } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import type { DashboardNotification } from "../orchestration/dashboard-view-model";
import type { DashboardRecentActivitySummary } from "../types";
import { DashboardNotificationList } from "./notification-list";

export type DashboardActivityApproval = {
  id: string;
  sessionId?: string;
  kind: string;
  target: string;
  status?: ApprovalStatus;
  decision?: PermissionDecision;
  createdAt?: string;
  updatedAt?: string;
  agentName?: string;
  projectName?: string;
  worktreeName?: string;
  sessionName?: string;
};

export type DashboardActivitySession = {
  id: string;
  title: string;
  projectName?: string | null;
  worktreeName?: string | null;
  agentName?: string | null;
  status?: string;
  selected?: boolean;
  createdAt?: string;
  updatedAt?: string;
  planSummary?: {
    completed: number;
    total: number;
    label: string;
  };
};

type DashboardActivity = {
  id: string;
  sessionId?: string;
  time: string;
  timestampMs?: number;
  tone: "active" | "primary" | "warning" | "danger" | "idle";
  title: string;
  type: "会话" | "权限";
  agentName?: string | null;
  projectName?: string | null;
  worktreeName?: string | null;
  statusLabel:
    | "启动中"
    | "运行中"
    | "等待审批"
    | "处理中"
    | "已允许"
    | "已拒绝"
    | "已过期"
    | "错误"
    | "已取消"
    | "空闲";
  selected?: boolean;
  detail?: string;
  planSummary?: DashboardActivitySession["planSummary"];
};

type DashboardActivityStreamProps = {
  sessions: DashboardActivitySession[];
  approvals: DashboardActivityApproval[];
  notifications?: DashboardNotification[];
  onOpenSession?: (sessionId: string) => void;
  onClearNotifications?: () => void;
  onClearApprovalHistory?: () => void;
  isMobile?: boolean;
};

type ActivityTab = "最近" | "权限" | "通知" | "7天前";

const ACTIVITY_GRID_COLUMNS = "grid grid-cols-[76px_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,var(--dashboard-activity-acp-width))] gap-2";
const ACTIVITY_SPARKLINE_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;
const ACTIVITY_RECENT_LIMIT = 15;
const ACTIVITY_OLD_MS = 7 * 24 * HOUR_MS;

function formatActivityField(value?: string | null) {
  return value?.trim() || "—";
}

function parseActivityTimestamp(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  const timestampMs = date.getTime();
  return Number.isNaN(timestampMs) ? null : timestampMs;
}

function formatActivityTimeFromTimestamp(timestampMs: number | null) {
  if (timestampMs === null) return "--:--:--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestampMs));
}

function resolveSessionActivityState(status: string | undefined): Pick<DashboardActivity, "tone" | "statusLabel"> {
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "running") {
    return { tone: "primary", statusLabel: "运行中" };
  }
  if (normalized === "starting") {
    return { tone: "idle", statusLabel: "启动中" };
  }
  if (normalized === "waiting_for_permission") {
    return { tone: "warning", statusLabel: "等待审批" };
  }
  if (normalized === "error" || normalized.includes("fail")) {
    return { tone: "danger", statusLabel: "错误" };
  }
  if (normalized === "cancelled" || normalized === "canceled") {
    return { tone: "idle", statusLabel: "已取消" };
  }
  return { tone: "idle", statusLabel: "空闲" };
}

function formatApprovalDetail(approval: DashboardActivityApproval) {
  if (approval.status === "expired") return "请求已失效";
  if (approval.status === "resolving") return "正在提交";
  if (approval.status !== "resolved") return "待处理";
  switch (approval.decision) {
    case "deny":
      return "已拒绝";
    case "allow_session":
      return "已允许 · 本会话";
    case "allow_always":
      return "已允许 · 始终";
    default:
      return "已允许 · 本次";
  }
}

function resolveApprovalActivityState(
  approval: DashboardActivityApproval,
): Pick<DashboardActivity, "tone" | "statusLabel"> {
  if (approval.status === "resolving") {
    return { tone: "primary", statusLabel: "处理中" };
  }
  if (approval.status === "resolved") {
    return approval.decision === "deny"
      ? { tone: "danger", statusLabel: "已拒绝" }
      : { tone: "active", statusLabel: "已允许" };
  }
  if (approval.status === "expired") {
    return { tone: "idle", statusLabel: "已过期" };
  }
  return { tone: "warning", statusLabel: "等待审批" };
}

function resolveActivityDetail(activity: DashboardActivity) {
  return activity.planSummary?.label ?? activity.detail ?? "—";
}

function resolveAcpColumnWidth(activities: DashboardActivity[]) {
  const maxAgentNameLength = Math.max(
    "ACP".length,
    ...activities.map((activity) => (activity.agentName ?? "Agent").trim().length),
  );
  return `${Math.max(56, maxAgentNameLength * 8 + 24)}px`;
}

function buildActivities(
  sessions: DashboardActivitySession[] = [],
  approvals: DashboardActivityApproval[] = [],
): DashboardActivity[] {
  const list: DashboardActivity[] = [];

  sessions.forEach((session) => {
    const state = resolveSessionActivityState(session.status);
    const timestampMs = parseActivityTimestamp(session.updatedAt);
    list.push({
      id: `session-${session.id}`,
      sessionId: session.id,
      time: formatActivityTimeFromTimestamp(timestampMs),
      timestampMs: timestampMs ?? undefined,
      ...state,
      title: session.title || session.id,
      type: "会话",
      agentName: session.agentName || "Agent",
      projectName: session.projectName,
      worktreeName: session.worktreeName,
      selected: Boolean(session.selected),
      planSummary: session.planSummary,
    });
  });

  approvals.forEach((approval) => {
    const timestampMs = parseActivityTimestamp(approval.updatedAt ?? approval.createdAt);
    list.push({
      id: `approval-${approval.id}`,
      sessionId: approval.sessionId,
      time: formatActivityTimeFromTimestamp(timestampMs),
      timestampMs: timestampMs ?? undefined,
      ...resolveApprovalActivityState(approval),
      title: approval.kind || approval.target,
      type: "权限",
      agentName: approval.agentName || "Agent",
      projectName: approval.projectName,
      worktreeName: approval.worktreeName,
      detail: formatApprovalDetail(approval),
    });
  });

  if (list.length > 0) return list;

  return [
    {
      id: "empty",
      time: "--:--:--",
      tone: "idle" as const,
      title: "等待本地 Helm 活动",
      type: "会话",
      agentName: "Helm",
      statusLabel: "空闲" as const,
    },
  ];
}

function formatActivityAriaLabel(activity: DashboardActivity) {
  return `${activity.type}: ${activity.title}. ${activity.statusLabel}. ${activity.agentName ?? "Agent"}. ${formatActivityField(activity.projectName)}. ${formatActivityField(activity.worktreeName)}. ${resolveActivityDetail(activity)}`;
}

function buildActivitySparkline(activities: DashboardActivity[], now = Date.now()) {
  const points = Array.from({ length: ACTIVITY_SPARKLINE_HOURS }, () => 0);
  const start = now - ACTIVITY_SPARKLINE_HOURS * HOUR_MS;
  for (const activity of activities) {
    if (activity.timestampMs === undefined || activity.timestampMs < start || activity.timestampMs > now) {
      continue;
    }
    const bucket = Math.min(points.length - 1, Math.floor((activity.timestampMs - start) / HOUR_MS));
    points[bucket] = (points[bucket] ?? 0) + 1;
  }
  return points;
}

export function buildDashboardActivitySummary(
  sessions: DashboardActivitySession[] = [],
  approvals: DashboardActivityApproval[] = [],
  now = Date.now(),
): DashboardRecentActivitySummary {
  const sparklinePoints = buildActivitySparkline(buildActivities(sessions, approvals), now);
  return {
    sparklinePoints,
    recentActivityCount: sparklinePoints.reduce((total, value) => total + value, 0),
  };
}

function sortActivitiesByRecency(activities: DashboardActivity[]) {
  return activities
    .map((activity, index) => ({ activity, index }))
    .sort((left, right) => {
      const recency = (right.activity.timestampMs ?? 0) - (left.activity.timestampMs ?? 0);
      return recency || left.index - right.index;
    })
    .map(({ activity }) => activity);
}

function filterActivitiesByTab(activeTab: ActivityTab, activities: DashboardActivity[], now = Date.now()) {
  if (activeTab === "权限") {
    return activities.filter((activity) => activity.type === "权限");
  }
  if (activeTab === "7天前") {
    const oldActivityCutoff = now - ACTIVITY_OLD_MS;
    return activities.filter((activity) => activity.timestampMs !== undefined && activity.timestampMs <= oldActivityCutoff);
  }
  return activities.slice(0, ACTIVITY_RECENT_LIMIT);
}

export function DashboardActivityStream({
  sessions,
  approvals,
  notifications = [],
  onOpenSession,
  onClearNotifications,
  onClearApprovalHistory,
  isMobile = false,
}: DashboardActivityStreamProps) {
  const [activeTab, setActiveTab] = useState<ActivityTab>("最近");
  const rawActivities = buildActivities(sessions, approvals);
  const orderedActivities = sortActivitiesByRecency(rawActivities);
  const filteredActivities = filterActivitiesByTab(activeTab, orderedActivities);
  const processedApprovalCount = approvals.filter(
    (approval) => approval.status === "resolved" || approval.status === "expired",
  ).length;
  const acpColumnStyle = {
    "--dashboard-activity-acp-width": resolveAcpColumnWidth(rawActivities),
  } as CSSProperties;

  if (isMobile) {
    return (
      <section className="wb-pane min-w-0 overflow-hidden">
        <div className="wb-pane-head min-h-9">
          <span className="wb-pane-head-title">活动流</span>
          <div className="flex-1" />
          <StatusDot tone="primary" pulse size={5} />
          <span className="font-mono text-meta text-muted-foreground tabular ml-1">实时</span>
        </div>
        <ul className="divide-y divide-border-ghost">
          {filteredActivities.slice(0, 4).map((activity) => (
            <li key={activity.id}>
              <button
                type="button"
                className={cn(
                  "overview-session-item-btn overview-activity-row relative grid w-full gap-1.5 px-3 py-2 text-left active:bg-surface-sunken disabled:cursor-default",
                  activity.selected && "bg-surface-emphasis/35 text-foreground before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-primary",
                )}
                disabled={!activity.sessionId || !onOpenSession}
                aria-label={formatActivityAriaLabel(activity)}
                aria-current={activity.selected ? "true" : undefined}
                onClick={() => activity.sessionId ? onOpenSession?.(activity.sessionId) : undefined}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <StatusDot tone={activity.tone} size={6} />
                  <span className="min-w-0 flex-1 truncate text-section">{activity.title}</span>
                  <span className="font-mono text-meta tabular text-muted-foreground">{activity.statusLabel}</span>
                </span>
                <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <span className="truncate font-mono text-meta tabular text-muted-foreground">
                    {formatActivityField(activity.projectName)} · {formatActivityField(activity.worktreeName)}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="max-w-[120px] truncate font-mono text-meta tabular text-muted-foreground">{resolveActivityDetail(activity)}</span>
                    <span className="overview-activity-agent flex max-w-[84px] items-center gap-1 text-meta text-muted-foreground">
                      <AgentIcon name={activity.agentName ?? undefined} size={10} />
                      <span className="truncate">{activity.agentName ?? "Agent"}</span>
                    </span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <section className="wb-pane flex min-h-[520px] flex-col lg:col-span-2" style={acpColumnStyle}>
      <div className="wb-pane-head min-h-9">
        <span className="wb-pane-head-title">活动流</span>
        <div className="ml-2 flex items-center gap-1" role="tablist" aria-label="活动分类">
          {(["最近", "权限", "通知", "7天前"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setActiveTab(item)}
              className={`inline-flex h-6 items-center gap-1 rounded px-2 text-meta ${activeTab === item ? "bg-surface-sunken font-medium text-foreground" : "text-muted-foreground hover:bg-surface-sunken"}`}
              role="tab"
              aria-selected={activeTab === item}
            >
              {item}
              {item === "通知" && notifications.length > 0 ? (
                <span className="font-mono tabular text-warning">{notifications.length}</span>
              ) : null}
            </button>
          ))}
        </div>
        {activeTab === "通知" ? (
          <>
            <span className="ml-auto font-mono text-meta tabular text-muted-foreground">{notifications.length} 条</span>
            {notifications.length > 0 && onClearNotifications ? (
              <button
                type="button"
                className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
                title="清空通知"
                aria-label="清空通知"
                onClick={onClearNotifications}
              >
                <Icon name="trash" size={12} />
              </button>
            ) : null}
          </>
        ) : activeTab === "权限" ? (
          <>
            <span className="ml-auto font-mono text-meta tabular text-muted-foreground">{approvals.length} 条</span>
            {processedApprovalCount > 0 && onClearApprovalHistory ? (
              <button
                type="button"
                className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-surface-sunken hover:text-foreground"
                title="清理已处理"
                aria-label="清理已处理权限记录"
                onClick={onClearApprovalHistory}
              >
                <Icon name="trash" size={12} />
              </button>
            ) : null}
          </>
        ) : (
          <>
            <span className="ml-auto font-mono text-meta tabular text-muted-foreground">实时</span>
            <StatusDot tone="primary" pulse size={5} />
          </>
        )}
      </div>
      {activeTab === "通知" ? (
        <DashboardNotificationList
          embedded
          notifications={notifications}
          onOpenSession={onOpenSession}
        />
      ) : null}
      <div
        className={`${ACTIVITY_GRID_COLUMNS} border-b border-border-ghost px-3 py-2 font-mono text-meta uppercase tracking-wider text-muted-foreground`}
        hidden={activeTab === "通知"}
      >
        <span>状态</span>
        <span>名称</span>
        <span>项目</span>
        <span>Worktree</span>
        <span>计划 / 权限</span>
        <span>ACP</span>
      </div>
      <ul className="flex-1 overflow-y-auto overflow-x-hidden" hidden={activeTab === "通知"}>
        {filteredActivities.map((activity) => (
          <li key={activity.id} className="border-b border-border-ghost last:border-b-0">
            <button
              type="button"
              className={cn(
                `overview-activity-row ${ACTIVITY_GRID_COLUMNS} relative w-full items-center px-3 py-2.5 text-left transition-colors hover:bg-surface-sunken disabled:cursor-default`,
                activity.selected && "bg-surface-emphasis/35 text-foreground before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-primary",
              )}
              disabled={!activity.sessionId || !onOpenSession}
              aria-label={formatActivityAriaLabel(activity)}
              aria-current={activity.selected ? "true" : undefined}
              onClick={() => activity.sessionId ? onOpenSession?.(activity.sessionId) : undefined}
            >
              <span className="flex min-w-0 items-center gap-2">
                <StatusDot tone={activity.tone} size={6} />
                <span className="grid min-w-0 gap-0.5">
                  <span className="truncate text-section">{activity.statusLabel}</span>
                  <span className="truncate font-mono text-meta tabular text-muted-foreground">{activity.time}</span>
                </span>
              </span>
              <span className="min-w-0 truncate text-section">{activity.title}</span>
              <span className="truncate font-mono text-meta tabular text-muted-foreground">{formatActivityField(activity.projectName)}</span>
              <span className="truncate font-mono text-meta tabular text-muted-foreground">{formatActivityField(activity.worktreeName)}</span>
              <span className="truncate font-mono text-meta tabular text-muted-foreground">{resolveActivityDetail(activity)}</span>
              <span className="overview-activity-agent flex items-center gap-1.5 text-meta text-muted-foreground">
                <AgentIcon name={activity.agentName ?? undefined} size={11} />
                <span>{activity.agentName ?? "Agent"}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
