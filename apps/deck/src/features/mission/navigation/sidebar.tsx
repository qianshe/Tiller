import type {
  CSSProperties,
  Dispatch,
  ReactNode,
  SetStateAction,
  UIEvent,
} from "react";
import { useMemo, useState } from "react";
import type {
  HelmSummary,
  ProjectSummary,
  SessionStatus,
  SessionSummary,
} from "@tiller/shared";
import { daemonProfileKey } from "../../helm-connection/facade";
import { Badge, Button, Icon, Input, StatusDot } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import type { MissionMobilePane } from "../hooks/layout";
import { SidebarProjectNode } from "./sidebar-project-node";
type ConnectionState = "connecting" | "connected" | "disconnected";

type MissionRuntimeOverviewChild = {
  activeSessionCount?: number;
  branchName: string;
  id: string;
  model?: string | null;
  projectName: string;
  reasoningEffort?: string | null;
  sessionCount?: number;
  status: string;
};

type MissionRuntimeOverviewItem = {
  agentId?: string | null;
  canConnect?: boolean;
  canReconnect?: boolean;
  children?: MissionRuntimeOverviewChild[];
  cwd?: string | null;
  id: string;
  label: string;
  meta: string;
  model?: string | null;
  reasoningEffort?: string | null;
  runtimeSessionId: string;
  status: string;
};

type MissionSidebarProps = {
  effectiveSidebarCollapsed: boolean;
  missionSidebarCollapsed: boolean;
  missionSidebarPaneStyle: CSSProperties;
  handleMissionTreeScroll: (event: UIEvent<HTMLElement>) => void;
  setMissionSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  missionHelms: HelmSummary[];
  effectiveMissionHelmId: string | null;
  expandedMissionHelmIds: ReadonlySet<string>;
  projects: ProjectSummary[];
  helmConnectionStates: Record<string, ConnectionState>;
  activeProfileId: string;
  connection: ConnectionState;
  toggleMissionHelmNode: (helmId: string) => void;
  missionSelectedProjectId: string | null;
  expandedMissionProjectIds: ReadonlySet<string>;
  sessions: SessionSummary[];
  sessionCountsByProject: Record<string, number>;
  currentGitBranch: string | null;
  missionDiffCount: number;
  runtimeOverviewItems: MissionRuntimeOverviewItem[];
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  statuses: Record<string, SessionStatus>;
  completedUnreadSessionIds: Readonly<Record<string, true>>;
  copy: { status: Record<SessionStatus, string> };
  activeSessionId: string | null;
  highlightedSessionId: string | null;
  openSessionIds: ReadonlySet<string>;
  openSession: (sessionId: string) => void;
  renderMissionAgentIcon: (agentName: string) => ReactNode;
  resolveDisplaySessionTitle: (session: SessionSummary) => string;
  regenerateSessionTitle: (session: SessionSummary) => void;
  regeneratingIds: ReadonlySet<string>;
  formatRelativeTime: (value: string) => string;
  setPendingSessionCleanup: Dispatch<SetStateAction<SessionSummary | null>>;
  sessionHistoryState: {
    nextCursor?: string;
    hasMore: boolean;
    loading: boolean;
  };
  toggleMissionProjectNode: (projectId: string) => void;
  setSelectedMissionMobilePane: Dispatch<SetStateAction<MissionMobilePane>>;
  isMobile?: boolean;
  resizer: ReactNode;
};
export function MissionSidebar({
  effectiveSidebarCollapsed,
  missionSidebarCollapsed,
  missionSidebarPaneStyle,
  handleMissionTreeScroll,
  setMissionSidebarCollapsed,
  missionHelms,
  effectiveMissionHelmId,
  expandedMissionHelmIds,
  projects,
  helmConnectionStates,
  activeProfileId,
  connection,
  toggleMissionHelmNode,
  missionSelectedProjectId,
  expandedMissionProjectIds,
  sessions,
  sessionCountsByProject,
  runtimeOverviewItems,
  setActiveSessionId,
  statuses,
  completedUnreadSessionIds,
  copy,
  activeSessionId,
  highlightedSessionId,
  openSessionIds,
  openSession,
  renderMissionAgentIcon,
  resolveDisplaySessionTitle,
  regenerateSessionTitle,
  regeneratingIds,
  formatRelativeTime,
  setPendingSessionCleanup,
  sessionHistoryState,
  toggleMissionProjectNode,
  setSelectedMissionMobilePane,
  isMobile = false,
  resizer,
}: MissionSidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const searchableProjects = useMemo(
    () =>
      normalizedSearchQuery
        ? projects.filter((project) =>
            matchesMissionSidebarSearch(project, sessions, normalizedSearchQuery),
          )
        : projects,
    [normalizedSearchQuery, projects, sessions],
  );
  const sidebarClassName = [
    "chat-session-sidebar mission-pane mission-pane-sidebar col-start-1 col-end-2 flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface-sunken border-r border-border-ghost shadow-none",
    effectiveSidebarCollapsed ? "collapsed hidden" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <aside
        className={sidebarClassName}
        style={missionSidebarPaneStyle}
        aria-label="任务导航：Helm、项目与任务"
        data-mission-mobile-pane="project"
      >
        {!effectiveSidebarCollapsed ? (
          <>
            <div className="wb-pane-head bg-transparent">
              <span className="wb-pane-head-eyebrow whitespace-nowrap">Helm · 任务</span>
              <div className="flex-1" />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setSearchOpen((open) => !open)}
                aria-expanded={searchOpen}
                aria-label="搜索任务"
                title="搜索任务"
              >
                <Icon name="search" size={12} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="mission-sidebar-toggle text-muted-foreground hover:text-foreground"
                onClick={() => setMissionSidebarCollapsed(true)}
                aria-expanded="true"
                aria-label="收起任务导航"
                title="收起任务导航"
              >
                ‹
              </Button>
            </div>
            {searchOpen || searchQuery ? (
              <div className="px-1.5 pb-1.5">
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  placeholder="搜索项目、任务或 Agent"
                  aria-label="任务搜索关键字"
                  className="h-7"
                />
              </div>
            ) : null}
          </>
        ) : null}
        {missionSidebarCollapsed ? null : (
          <div
            className="sidebar-section mission-tree-switcher flex-1 overflow-auto p-1"
            onScroll={handleMissionTreeScroll}
          >
            <div className="section-head section-head-soft sidebar-heading-block mb-1 flex items-center gap-2 px-1.5 py-1 text-2xs uppercase tracking-wider text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">项目</span>
              <Badge variant="secondary" className="px-1.5 py-0 text-2xs">
                {projects.length} 个
              </Badge>
            </div>
            <div className="mission-tree grid gap-1" role="tree" aria-label="任务层级树">
              {missionHelms.map((helm) => {
                const selectedHelm = helm.id === effectiveMissionHelmId;
                const helmExpanded = expandedMissionHelmIds.has(helm.id);
                const helmMatchesSearch = Boolean(
                  normalizedSearchQuery &&
                    helm.name.toLowerCase().includes(normalizedSearchQuery),
                );
                const helmProjects = [
                  ...(helmMatchesSearch ? projects : searchableProjects),
                ]
                  .filter((project) => project.helmId === helm.id)
                  .sort(
                    (left, right) =>
                      left.name.localeCompare(right.name, undefined, {
                        sensitivity: "base",
                      }) || left.id.localeCompare(right.id),
                  );
                const helmKey = daemonProfileKey(helm.host, String(helm.port));
                const helmConnectionState =
                  helmConnectionStates[helmKey] ??
                  (helmKey === activeProfileId ? connection : "disconnected");
                return (
                  <div
                    key={helm.id}
                    className="mission-tree-group grid gap-1"
                    role="group"
                  >
                    <button
                      type="button"
                      className={cn(
                        "mission-tree-row mission-tree-row-helm grid w-full grid-cols-[12px_14px_minmax(0,1fr)_auto] items-center gap-1.5 px-1.5 h-6 text-left text-section text-foreground transition hover:bg-surface-emphasis/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                        selectedHelm && "active bg-surface-emphasis/70 text-foreground",
                      )}
                      onClick={() => toggleMissionHelmNode(helm.id)}
                      role="treeitem"
                      aria-level={1}
                      aria-expanded={helmExpanded}
                      aria-selected={selectedHelm}
                    >
                      <span className="mission-tree-caret text-2xs text-muted-foreground">
                        {helmExpanded ? "▾" : "▸"}
                      </span>
                      <StatusDot
                        tone={
                          helmConnectionState === "connected"
                            ? "active"
                            : helmConnectionState === "connecting"
                              ? "primary"
                              : "idle"
                        }
                        pulse={helmConnectionState === "connecting"}
                      />
                      <span className="mission-tree-main flex min-w-0 items-center gap-1.5">
                        <Icon name="server" size={11} className="shrink-0 text-muted-foreground" />
                        <span className="truncate text-section">{helm.name}</span>
                      </span>
                      <span className="shrink-0 font-mono text-2xs tabular text-muted-foreground">
                        {helmProjects.length}
                      </span>
                    </button>
                    {helmExpanded ? (
                      <div
                        className="mission-tree-children mission-tree-children-projects ml-3 grid gap-1.5 pl-0"
                        role="group"
                      >
                        {helmProjects.map((project) => {
                          const selectedProject =
                            project.id === missionSelectedProjectId;
                          const projectExpanded = expandedMissionProjectIds.has(
                            project.id,
                          );
                          return (
                            <SidebarProjectNode
                              key={project.id}
                              project={project}
                              projects={projects}
                              sessions={sessions}
                              selectedProject={selectedProject}
                              projectExpanded={projectExpanded}
                              sessionCountsByProject={sessionCountsByProject}
                              setActiveSessionId={setActiveSessionId}
                              statuses={statuses}
                              completedUnreadSessionIds={completedUnreadSessionIds}
                              copy={copy}
                              activeSessionId={activeSessionId}
                              highlightedSessionId={highlightedSessionId}
                              openSessionIds={openSessionIds}
                              openSession={openSession}
                              renderMissionAgentIcon={renderMissionAgentIcon}
                              resolveDisplaySessionTitle={
                                resolveDisplaySessionTitle
                              }
                              regenerateSessionTitle={regenerateSessionTitle}
                              regeneratingIds={regeneratingIds}
                              formatRelativeTime={formatRelativeTime}
                              setPendingSessionCleanup={
                                setPendingSessionCleanup
                              }
                              toggleMissionProjectNode={
                                toggleMissionProjectNode
                              }
                              setSelectedMissionMobilePane={
                                setSelectedMissionMobilePane
                              }
                              isMobile={isMobile}
                            />
                          );
                        })}
                        {!helmProjects.length ? (
                          <div className="mission-tree-empty rounded bg-surface-sunken p-2.5 text-meta text-muted-foreground">
                            {normalizedSearchQuery ? "没有匹配任务。" : "这个 Helm 还没有项目。"}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {!missionHelms.length ? (
                <div className="empty-state sidebar-empty rounded border border-border-ghost bg-surface-sunken p-3 text-meta text-muted-foreground">暂无 Helm。</div>
              ) : null}
              {sessionHistoryState.loading ? (
                <div className="mission-tree-empty rounded bg-surface-sunken p-2.5 text-meta text-muted-foreground"> 正在加载更多任务... </div>
              ) : null}
            </div>
          </div>
        )}
        <div className="border-t border-border-ghost px-2 py-1 text-2xs text-muted-foreground">
          <details open className="group px-0.5 py-0.5">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-1 text-foreground/80 outline-none [&::-webkit-details-marker]:hidden">
              <Icon name="server" size={10} />
              <span className="font-medium">ACP</span>
              <span className="font-mono tabular text-muted-foreground">{runtimeOverviewItems.length}</span>
              <span aria-hidden="true" className="ml-auto text-2xs text-muted-foreground/50">
                ▾
              </span>
            </summary>
            <div className="mt-1 grid max-h-40 gap-1 overflow-auto pr-0.5">
              {runtimeOverviewItems.length ? (
                runtimeOverviewItems.map((item) => (
                  <details
                    key={item.id}
                    className="rounded border border-border-ghost/70 bg-surface px-2 py-1"
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-1.5 outline-none [&::-webkit-details-marker]:hidden">
                      <Icon
                        name={item.canReconnect ? "server" : item.canConnect ? "plus" : "inspect"}
                        size={10}
                      />
                      <span className="min-w-0 truncate font-medium text-foreground">
                        {item.label}
                      </span>
                      <Badge
                        variant={resolveRuntimeOverviewStatusVariant(item.status)}
                        className={cn(
                          "ml-auto shrink-0 rounded-sm border border-transparent px-1.5 py-0 text-[10px] font-medium",
                          item.status === "已连接" &&
                            "border-success/50 bg-success/20 text-success font-semibold",
                        )}
                      >
                        {item.status}
                      </Badge>
                    </summary>
                    <div className="mt-1 grid gap-0.5 pl-4 text-[10px] leading-snug text-muted-foreground">
                      {!item.children?.length ? (
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="min-w-0 truncate">{item.meta}</span>
                          <span className="shrink-0 font-mono tabular">{item.runtimeSessionId}</span>
                        </div>
                      ) : null}
                      {item.children?.length ? (
                        <div className="grid gap-0.5">
                          {item.children.slice(0, 3).map((child) => (
                            <div
                              key={child.id}
                              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5"
                              title={child.branchName ? `Worktree：${child.branchName}` : undefined}
                            >
                              <span className="min-w-0 truncate text-foreground/80">
                                {child.projectName}
                              </span>
                              <span className="shrink-0 rounded bg-surface-emphasis px-1 py-0.5 font-mono text-[9px] text-muted-foreground">
                                {formatRuntimeOverviewChildStatus(child)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </details>
                ))
              ) : (
                <div className="rounded border border-dashed border-border-ghost bg-surface px-2 py-1 text-muted-foreground">
                  暂无 ACP 连接。
                </div>
              )}
            </div>
          </details>
        </div>
      </aside>
      {resizer}
    </>
  );
}

function resolveRuntimeOverviewStatusVariant(status: string) {
  if (status === "已连接") {
    return "success" as const;
  }
  if (status === "连接中") {
    return "warning" as const;
  }
  return "secondary" as const;
}

function formatRuntimeOverviewChildStatus(child: MissionRuntimeOverviewChild) {
  if (typeof child.sessionCount !== "number") {
    return child.status.replaceAll(" 个会话", " 会话").replace(" · 0 活跃", "");
  }
  if (
    typeof child.activeSessionCount === "number" &&
    child.activeSessionCount > 0 &&
    child.activeSessionCount !== child.sessionCount
  ) {
    return `${child.sessionCount} 会话 · ${child.activeSessionCount} 活跃`;
  }
  return `${child.sessionCount} 会话`;
}

function matchesMissionSidebarSearch(
  project: ProjectSummary,
  sessions: SessionSummary[],
  normalizedQuery: string,
) {
  const projectText = [
    project.name,
    project.path,
    ...(project.worktrees ?? []).map((worktree) => worktree.name ?? worktree.path),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (projectText.includes(normalizedQuery)) {
    return true;
  }
  return sessions.some((session) => {
    if (session.projectId !== project.id) {
      return false;
    }
    return [
      session.title,
      session.agentName,
      session.projectName,
      session.worktreeName,
      session.cwd,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
}
