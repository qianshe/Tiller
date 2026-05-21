import type {
  CSSProperties,
  Dispatch,
  ReactNode,
  SetStateAction,
  UIEvent,
} from "react";
import { useMemo, useState } from "react";
import type {
  AcpAgentProvider,
  HelmSummary,
  ProjectSummary,
  SessionStatus,
  SessionSummary,
} from "@tiller/shared";
import {
  daemonProfileKey,
  formatConnectionStatus,
} from "../../helm-connection/facade";
import { Badge, Button, Icon, Input, StatusDot } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import type { MissionMobilePane } from "../hooks/layout";
import { SidebarProjectNode } from "./sidebar-project-node";
type ConnectionState = "connecting" | "connected" | "disconnected";
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
  agents: AcpAgentProvider[];
  selectedAgentId: string | null;
  agentPickerOpen: boolean;
  selectDraftAgent: (agentId: string) => void;
  setSelectedMissionHelmId: Dispatch<SetStateAction<string | null>>;
  setSelectedProjectId: Dispatch<SetStateAction<string | null>>;
  setSelectedCwd: Dispatch<SetStateAction<string | null>>;
  setSelectedAgentId: Dispatch<SetStateAction<string | null>>;
  setAgentPickerOpen: Dispatch<SetStateAction<boolean>>;
  setExpandedMissionProjectIds: Dispatch<SetStateAction<Set<string>>>;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  statuses: Record<string, SessionStatus>;
  copy: { status: Record<SessionStatus, string> };
  activeSessionId: string | null;
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
  currentGitBranch,
  missionDiffCount,
  agents,
  selectedAgentId,
  agentPickerOpen,
  selectDraftAgent,
  setSelectedMissionHelmId,
  setSelectedProjectId,
  setSelectedCwd,
  setSelectedAgentId,
  setAgentPickerOpen,
  setExpandedMissionProjectIds,
  setActiveSessionId,
  statuses,
  copy,
  activeSessionId,
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
  const openNewTaskFromSidebar = () => {
    const targetProject =
      projects.find((project) => project.id === missionSelectedProjectId) ??
      searchableProjects[0] ??
      projects[0];
    if (!targetProject) {
      return;
    }
    setSelectedMissionHelmId(targetProject.helmId);
    setSelectedProjectId(targetProject.id);
    setSelectedCwd(targetProject.path ?? targetProject.worktrees?.[0]?.path ?? null);
    setSelectedAgentId(null);
    setAgentPickerOpen(true);
    setExpandedMissionProjectIds(
      (current) => new Set([...current, targetProject.id]),
    );
    setActiveSessionId(null);
  };
  const sidebarClassName = [
    "chat-session-sidebar mission-pane mission-pane-sidebar col-start-1 col-end-2 flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface-sunken border-r border-border-ghost shadow-none",
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
              <span className="wb-pane-head-eyebrow">Helm · 任务</span>
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
                className="text-muted-foreground hover:text-primary"
                onClick={openNewTaskFromSidebar}
                disabled={!projects.length}
                aria-label="新建任务"
                title="新建任务"
              >
                <Icon name="plus" size={12} />
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
                        "mission-tree-row mission-tree-row-helm grid w-full grid-cols-[12px_14px_minmax(0,1fr)_auto] items-center gap-1.5 rounded px-1.5 h-6 text-left text-section text-foreground transition hover:bg-surface-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                        selectedHelm && "active bg-primary-soft text-foreground",
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
                        className="mission-tree-children mission-tree-children-projects ml-3 grid gap-1.5 border-l border-border-ghost pl-2"
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
                              agents={agents}
                              selectedAgentId={selectedAgentId}
                              agentPickerOpen={agentPickerOpen}
                              selectDraftAgent={selectDraftAgent}
                              setSelectedMissionHelmId={setSelectedMissionHelmId}
                              setSelectedProjectId={setSelectedProjectId}
                              setSelectedCwd={setSelectedCwd}
                              setSelectedAgentId={setSelectedAgentId}
                              setAgentPickerOpen={setAgentPickerOpen}
                              setExpandedMissionProjectIds={
                                setExpandedMissionProjectIds
                              }
                              setActiveSessionId={setActiveSessionId}
                              statuses={statuses}
                              copy={copy}
                              activeSessionId={activeSessionId}
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
        <div className="border-t border-border-ghost px-2 py-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
          <Icon name="branch" size={10} />
          <span className="font-mono tabular truncate">
            {currentGitBranch || "未检测"}
          </span>
          <div className="flex-1" />
          <span className="font-mono tabular">{missionDiffCount} dirty</span>
        </div>
      </aside>
      {resizer}
    </>
  );
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
