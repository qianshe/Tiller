import type { PermissionDecision } from "@tiller/shared";
import { Suspense, useState, type CSSProperties, type ReactNode } from "react";
import { Icon, SidebarInset, SidebarProvider, SidebarTrigger, StatusDot } from "../../../shared/ui";
import {
  DashboardActivityStream,
  type DashboardActivityApproval,
  type DashboardActivitySession,
} from "./activity/stream";
import { DashboardActivityTrend } from "./activity/trend";
import { DashboardNotificationList } from "./notification-list";
import {
  DashboardSidebar,
  DASHBOARD_SIDEBAR_DEFAULT_WIDTH,
  type DashboardNavigationActions,
} from "./sidebar";
import { DashboardSessionSearchDialog } from "./sessions/search-dialog";
import { DashboardQuickCreateDialog, readDraftPrompt } from "./quick-create/dialog";
import { DashboardTaskWorkspace } from "./tasks/workspace";
import type { DashboardNotification } from "../orchestration/view-model";
import type {
  DashboardActivityTrendPoint,
  DashboardQuickCreateHelm,
  DashboardQuickCreateProject,
  DashboardQuickCreatePreset,
  DashboardQuickCreateRequest,
  DashboardSection,
} from "../types";
import { cn } from "../../../shared/utils/cn";

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

type DashboardMetricTone = "active" | "idle" | "primary" | "warning";

type DashboardMetric = {
  label: string;
  value: string;
  sub: string;
  icon: "server" | "activity" | "terminal" | "shield";
  tone: DashboardMetricTone;
};

export type DashboardPageProps = {
  activeHelmLabel: string;
  onlineHelmCount: number;
  totalHelmCount: number;
  runningAcpCount?: number;
  totalAcpCount?: number;
  runningSessionCount: number;
  totalSessionCount: number;
  pendingApprovalCount: number;
  planSessionCount: number;
  completedPlanSessionCount: number;
  sessions?: DashboardSession[];
  activityTrend?: DashboardActivityTrendPoint[];
  activityTrendHourly?: DashboardActivityTrendPoint[];
  helms?: DashboardHelm[];
  approvals?: DashboardApproval[];
  approvalHistory?: DashboardActivityApproval[];
  notifications?: DashboardNotification[];
  activeSection?: DashboardSection;
  onSelectSection?: (section: DashboardSection) => void;
  onOpenMission?: () => void;
  embeddedContent?: ReactNode;
  quickCreateHelms?: DashboardQuickCreateHelm[];
  quickCreateProjects?: DashboardQuickCreateProject[];
  onCreateTask?: (request: DashboardQuickCreateRequest) => boolean | void;
  preparations?: DashboardSession[];
  onOpenSession?: (sessionId: string) => void;
  onOpenSearchSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string, title: string) => void;
  onDeleteSession?: (sessionId: string) => void;
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

function DashboardMetricCard({ metric }: { metric: DashboardMetric }) {
  return (
    <article className="dashboard-metric-card wb-pane min-w-0 p-2.5 transition-colors hover:bg-surface-emphasis/35">
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-sunken text-muted-foreground">
          <Icon name={metric.icon} size={14} />
        </span>
        <span className="min-w-0 truncate text-meta font-medium text-muted-foreground">
          {metric.label}
        </span>
      </div>
      <div className="mt-2 flex min-w-0 items-baseline justify-between gap-2">
        <strong className="shrink-0 tabular text-display font-semibold leading-none">
          {metric.value}
        </strong>
        <span className="flex min-w-0 items-center gap-1 font-mono text-2xs tabular text-muted-foreground">
          <StatusDot
            tone={metric.tone}
            size={5}
            pulse={metric.tone === "active" || metric.tone === "primary"}
          />
          <span className="truncate">{metric.sub}</span>
        </span>
      </div>
    </article>
  );
}

function DashboardApprovalPanel({
  approvals,
  pendingApprovalCount,
  onRespondApproval,
}: {
  approvals: DashboardApproval[];
  pendingApprovalCount: number;
  onRespondApproval?: (approvalRequestId: string, decision: PermissionDecision) => void;
}) {
  return (
    <section className="wb-pane" aria-labelledby="dashboard-approvals-title">
      <div className="wb-pane-head min-h-10 px-3">
        <span id="dashboard-approvals-title" className="wb-pane-head-title">待审批</span>
        <span className="font-mono text-action font-medium tabular text-warning">{pendingApprovalCount}</span>
      </div>
      {approvals.length > 0 ? (
        <ul className="divide-y divide-border-ghost">
          {approvals.map((approval) => (
            <li key={approval.id} className="grid gap-2 px-3 py-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <Icon name="shield" size={14} className="mt-0.5 shrink-0 text-warning" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-action tabular text-foreground">{approval.kind}</p>
                  <p className="mt-0.5 truncate font-mono text-meta tabular text-muted-foreground">
                    {formatApprovalScope(approval)}
                  </p>
                </div>
              </div>
              <DashboardApprovalActions approval={approval} onRespondApproval={onRespondApproval} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-3 py-5 font-mono text-meta text-muted-foreground">暂无待处理请求</div>
      )}
    </section>
  );
}

function DashboardHeader({
  sectionTitle,
  showSidebarTrigger = false,
}: {
  sectionTitle: string;
  showSidebarTrigger?: boolean;
}) {
  return (
    <header
      className="dashboard-site-header flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-border-ghost px-4 py-2.5"
      data-slot="site-header"
    >
      <div className="flex min-w-0 items-center gap-2 font-mono text-meta tabular text-muted-foreground">
        {showSidebarTrigger ? <SidebarTrigger className="-ml-2 shrink-0" /> : null}
        {showSidebarTrigger ? <span className="h-4 w-px bg-border-ghost" aria-hidden="true" /> : null}
        <span className="hidden sm:inline">Tiller</span>
        <Icon name="chevronRight" size={12} />
        <span className="truncate text-foreground">{sectionTitle}</span>
      </div>
    </header>
  );
}

function DashboardEmbeddedFallback({ section }: { section: "agents" | "settings" }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6" role="status" aria-live="polite">
      <span className="font-mono text-meta text-muted-foreground">
        正在加载{section === "agents" ? " Agents" : "设置"}...
      </span>
    </div>
  );
}

function DashboardEmbeddedContent({
  section,
  content,
}: {
  section: "agents" | "settings";
  content?: ReactNode;
}) {
  const title = section === "agents" ? "Agents" : "设置";
  return (
    <section
      className="dashboard-embedded-content flex min-h-0 min-w-0 w-full flex-1 overflow-hidden"
      data-slot="dashboard-embedded-content"
      data-dashboard-section={section}
      aria-label={title}
    >
      <Suspense fallback={<DashboardEmbeddedFallback section={section} />}>
        {content}
      </Suspense>
    </section>
  );
}

function DashboardRoadmapView({ section }: { section: "automations" | "issues" }) {
  const isAutomation = section === "automations";
  const title = isAutomation ? "自动化" : "Issues";
  const description = isAutomation
    ? "把重复任务编排成可复用的工作流。"
    : "集中查看并分配需要 Agent 处理的问题。";

  return (
    <section
      className="wb-pane flex min-h-64 flex-col items-center justify-center px-6 py-10 text-center"
      aria-labelledby={`dashboard-${section}-title`}
    >
      <span className="grid size-10 place-items-center rounded-md bg-surface-sunken text-muted-foreground">
        <Icon name={isAutomation ? "branch" : "fileText"} size={18} />
      </span>
      <h1
        id={`dashboard-${section}-title`}
        className="mt-4 text-section font-semibold text-foreground"
      >
        {title}
      </h1>
      <p className="mt-1 max-w-sm text-meta text-muted-foreground">{description}</p>
      <span className="mt-4 rounded-full border border-border-ghost px-2.5 py-1 font-mono text-2xs text-muted-foreground">
        即将推出
      </span>
    </section>
  );
}

function resolveDashboardSectionTitle(section: DashboardSection) {
  switch (section) {
    case "tasks":
      return "任务";
    case "agents":
      return "Agents";
    case "settings":
      return "设置";
    case "automations":
      return "自动化";
    case "issues":
      return "Issues";
    default:
      return "概览";
  }
}

export function DashboardPage({
  onlineHelmCount,
  totalHelmCount,
  runningAcpCount = 0,
  totalAcpCount = runningAcpCount,
  runningSessionCount,
  totalSessionCount,
  pendingApprovalCount,
  sessions = [],
  activityTrend = [],
  activityTrendHourly = [],
  approvals = [],
  approvalHistory = approvals,
  notifications = [],
  activeSection,
  onSelectSection,
  onOpenMission,
  embeddedContent,
  quickCreateHelms,
  quickCreateProjects,
  onCreateTask,
  onOpenSession,
  onOpenSearchSession,
  onRenameSession,
  onDeleteSession,
  preparations = [],
  onRespondApproval,
  onClearNotifications,
  onClearApprovalHistory,
  isMobile = false,
}: DashboardPageProps) {
  const [internalSection, setInternalSection] = useState<DashboardSection>("overview");
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreatePreset, setQuickCreatePreset] = useState<DashboardQuickCreatePreset | null>(null);
  const [quickCreateHasDraft, setQuickCreateHasDraft] = useState(() =>
    Boolean(readDraftPrompt().trim()),
  );
  const [sidebarWidth, setSidebarWidth] = useState(DASHBOARD_SIDEBAR_DEFAULT_WIDTH);
  const selectedSection = activeSection ?? internalSection;
  const selectSection = (section: DashboardSection) => {
    setInternalSection(section);
    onSelectSection?.(section);
  };
  const createTask = (request: DashboardQuickCreateRequest) => {
    const accepted = onCreateTask?.(request);
    if (accepted === false) {
      return false;
    }
    selectSection("tasks");
    return true;
  };
  const openQuickCreate = () => {
    setQuickCreatePreset(null);
    setQuickCreateOpen(true);
  };
  const configureReadySession = (session: DashboardSession) => {
    setQuickCreatePreset({
      projectId: session.projectId,
      helmKey: session.helmKey,
      cwd: session.cwd,
      prompt: session.content ?? session.lastMessagePreview ?? session.title,
      title: session.title,
      preparationId: session.preparationId,
      revision: session.revision,
      agentId: session.agentId,
      focusTarget: !session.projectId || !session.cwd ? "project" : !session.agentId ? "agent" : undefined,
    });
    setQuickCreateOpen(true);
  };
  const sectionTitle = resolveDashboardSectionTitle(selectedSection);
  const approvalRows = approvals;
  const isEmbeddedSection = selectedSection === "agents" || selectedSection === "settings";
  const searchSession = onOpenSearchSession ?? onOpenSession;

  const metrics: DashboardMetric[] = [
    {
      label: "在线 Helm",
      value: `${onlineHelmCount} / ${totalHelmCount}`,
      sub: totalHelmCount > onlineHelmCount
        ? `${Math.max(totalHelmCount - onlineHelmCount, 0)} 个离线`
        : "全部在线",
      icon: "server",
      tone: onlineHelmCount > 0 ? "active" : "idle",
    },
    {
      label: "ACP Agent",
      value: `${runningAcpCount} / ${totalAcpCount}`,
      sub: totalAcpCount > 0 ? "在线/总数" : "暂无 ACP Agent",
      icon: "terminal",
      tone: runningAcpCount > 0 ? "primary" : "idle",
    },
    {
      label: "运行中会话",
      value: `${runningSessionCount} / ${totalSessionCount}`,
      sub: totalSessionCount > 0 ? "运行中/总数" : "暂无会话",
      icon: "activity",
      tone: runningSessionCount > 0 ? "primary" : "idle",
    },
    {
      label: "待审批",
      value: String(pendingApprovalCount),
      sub: pendingApprovalCount > 0 ? "需要你处理" : "暂无权限请求",
      icon: "shield",
      tone: pendingApprovalCount > 0 ? "warning" : "idle",
    },
  ];

  const navigationActions: DashboardNavigationActions = {
    activeSection: selectedSection,
    onSelectSection: selectSection,
    onOpenMission,
    onSearchSessions: () => setSessionSearchOpen(true),
    onOpenQuickCreate: openQuickCreate,
    quickCreateHelms,
    quickCreateProjects,
    quickCreateHasDraft,
  };

  const quickCreateDialog = (
    <DashboardQuickCreateDialog
      open={quickCreateOpen}
      helms={quickCreateHelms ?? []}
      projects={quickCreateProjects ?? []}
      preset={quickCreatePreset}
      onOpenChange={setQuickCreateOpen}
      onDraftChange={setQuickCreateHasDraft}
      onCreateTask={createTask}
    />
  );

  return (
    <>
      <SidebarProvider
        className="dashboard-page h-full min-h-0 overflow-hidden"
        data-slot="sidebar-provider"
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        <DashboardSidebar
          actions={navigationActions}
          width={sidebarWidth}
          onWidthChange={setSidebarWidth}
        />
        <SidebarInset className="dashboard-sidebar-inset h-full min-h-0 overflow-hidden md:mr-0!" data-slot="sidebar-inset">
          <DashboardHeader
            sectionTitle={sectionTitle}
            showSidebarTrigger
          />
          <div
            className={cn(
              "flex min-h-0 min-w-0 w-full flex-1 flex-col",
              isEmbeddedSection
                ? "max-w-none gap-0 overflow-y-auto overflow-x-hidden px-0 py-0"
                : isMobile
                  ? "gap-3 overflow-y-auto overflow-x-hidden px-3 py-3"
                  : "gap-4 overflow-y-auto overflow-x-hidden px-8 py-5",
            )}
            data-slot="dashboard-content"
            aria-label={sectionTitle}
          >
            {selectedSection === "overview" ? (
              <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-3 lg:gap-4">
                <div
                  className="grid grid-cols-2 gap-2 md:grid-cols-4"
                  data-slot="dashboard-metrics"
                >
                  {metrics.map((metric) => <DashboardMetricCard key={metric.label} metric={metric} />)}
                </div>
                <DashboardActivityTrend
                  points={activityTrend}
                  hourlyPoints={activityTrendHourly}
                />
                {isMobile ? (
                  <>
                    <DashboardApprovalPanel
                      approvals={approvalRows}
                      pendingApprovalCount={pendingApprovalCount}
                      onRespondApproval={onRespondApproval}
                    />
                    <DashboardNotificationList
                      notifications={notifications}
                      onOpenSession={onOpenSession}
                      onClear={onClearNotifications}
                    />
                  </>
                ) : (
                  <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">
                    <div className="min-w-0 lg:col-span-8">
                      <DashboardActivityStream
                        sessions={sessions}
                        approvals={approvalHistory}
                        notifications={notifications}
                        onOpenSession={onOpenSession}
                        onClearNotifications={onClearNotifications}
                        onClearApprovalHistory={onClearApprovalHistory}
                      />
                    </div>
                    <aside className="flex min-w-0 flex-col gap-4 lg:col-span-4">
                      <DashboardApprovalPanel
                        approvals={approvalRows}
                        pendingApprovalCount={pendingApprovalCount}
                        onRespondApproval={onRespondApproval}
                      />
                    </aside>
                  </div>
                )}
              </div>
            ) : selectedSection === "tasks" ? (
              <DashboardTaskWorkspace
                sessions={sessions}
                preparations={preparations}
                onOpenSession={onOpenSession}
                onConfigureReadySession={configureReadySession}
                onRenameSession={onRenameSession}
                onDeleteSession={onDeleteSession}
              />
            ) : selectedSection === "agents" || selectedSection === "settings" ? (
              <DashboardEmbeddedContent
                section={selectedSection}
                content={embeddedContent}
              />
            ) : (
              <DashboardRoadmapView section={selectedSection} />
            )}
          </div>
        </SidebarInset>
      </SidebarProvider>
      <DashboardSessionSearchDialog
        open={sessionSearchOpen}
        sessions={sessions}
        onOpenChange={setSessionSearchOpen}
        onOpenSession={searchSession}
      />
      {quickCreateDialog}
    </>
  );
}
