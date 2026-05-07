import type {
  CSSProperties,
  Dispatch,
  ReactNode,
  SetStateAction,
  UIEvent,
} from "react";
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
import { Badge, Button } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
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
  agents: AcpAgentProvider[];
  setSelectedMissionHelmId: Dispatch<SetStateAction<string | null>>;
  setSelectedProjectId: Dispatch<SetStateAction<string | null>>;
  setSelectedWorkspaceId: Dispatch<SetStateAction<string | null>>;
  setSelectedAgentId: Dispatch<SetStateAction<string | null>>;
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
  agents,
  setSelectedMissionHelmId,
  setSelectedProjectId,
  setSelectedWorkspaceId,
  setSelectedAgentId,
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
  resizer,
}: MissionSidebarProps) {
  const sidebarClassName = [
    "chat-session-sidebar mission-pane mission-pane-sidebar flex min-h-0 min-w-0 flex-col overflow-y-auto rounded-lg border border-border-ghost bg-surface/95 p-2 shadow-none",
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
        onScroll={handleMissionTreeScroll}
      >
        {!effectiveSidebarCollapsed ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mission-sidebar-toggle ml-auto size-7 text-muted-foreground hover:text-foreground"
            onClick={() => setMissionSidebarCollapsed(true)}
            aria-expanded="true"
            aria-label="收起任务导航"
            title="收起任务导航"
          >
            ‹
          </Button>
        ) : null}
        {missionSidebarCollapsed ? null : (
          <div className="sidebar-section mission-tree-switcher grid gap-3">
            <div className="section-head section-head-soft sidebar-heading-block rounded-xl border border-border-ghost bg-surface-sunken p-2">
              <div className="grid gap-1">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-foreground">项目</h2>
                  <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">
                    {projects.length} 个
                  </Badge>
                </div>
                <p className="muted compact text-xs leading-relaxed text-muted-foreground">
                  Helm → Project → Session
                </p>
              </div>
            </div>
            <div className="mission-tree grid gap-2" role="tree" aria-label="任务层级树">
              {missionHelms.map((helm) => {
                const selectedHelm = helm.id === effectiveMissionHelmId;
                const helmExpanded = expandedMissionHelmIds.has(helm.id);
                const helmProjects = [...projects]
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
                        "mission-tree-row mission-tree-row-helm grid w-full grid-cols-[18px_24px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-transparent px-2.5 py-1.5 text-left text-sm text-foreground transition hover:border-border-ghost hover:bg-surface-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                        selectedHelm && "active border-primary/20 bg-primary-soft text-primary",
                      )}
                      onClick={() => toggleMissionHelmNode(helm.id)}
                      role="treeitem"
                      aria-level={1}
                      aria-expanded={helmExpanded}
                      aria-selected={selectedHelm}
                    >
                      <span className="mission-tree-caret text-xs text-muted-foreground">
                        {helmExpanded ? "▾" : "▸"}
                      </span>
                      <span
                        className="mission-tree-icon grid size-5 place-items-center rounded-md bg-surface-sunken text-xs"
                        aria-hidden="true"
                      >
                        ⎈
                      </span>
                      <span className="mission-tree-main grid min-w-0 gap-0.5">
                        <strong className="truncate font-semibold">{helm.name}</strong>
                        <span className="truncate text-xs text-muted-foreground">
                          {helm.host}:{helm.port} · {helmProjects.length}
                          项目
                        </span>
                      </span>
                      <Badge
                        variant={
                          helmConnectionState === "connected"
                            ? "success"
                            : helmConnectionState === "connecting"
                              ? "warning"
                              : "outline"
                        }
                        className="shrink-0 px-2 py-0.5 text-[10px]"
                        title={formatConnectionStatus(helmConnectionState)}
                        aria-label={formatConnectionStatus(helmConnectionState)}
                      >
                        {helmProjects.length}
                      </Badge>
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
                              setSelectedMissionHelmId={
                                setSelectedMissionHelmId
                              }
                              setSelectedProjectId={setSelectedProjectId}
                              setSelectedWorkspaceId={setSelectedWorkspaceId}
                              setSelectedAgentId={setSelectedAgentId}
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
                            />
                          );
                        })}
                        {!helmProjects.length ? (
                          <div className="mission-tree-empty rounded-md bg-surface-sunken p-3 text-sm text-muted-foreground">
                            这个 Helm 还没有项目。
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {!missionHelms.length ? (
                <div className="empty-state sidebar-empty rounded-md border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">暂无 Helm。</div>
              ) : null}
              {sessionHistoryState.loading ? (
                <div className="mission-tree-empty rounded-md bg-surface-sunken p-3 text-sm text-muted-foreground"> 正在加载更多任务... </div>
              ) : null}
            </div>
          </div>
        )}
      </aside>
      {missionSidebarCollapsed ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="mission-sidebar-toggle mission-sidebar-floating-toggle fixed left-4 top-28 z-30 rounded-full shadow-ambient"
          onClick={() => setMissionSidebarCollapsed(false)}
          aria-expanded="false"
          aria-label="展开任务导航"
          title="展开任务导航"
        >
          ›
        </Button>
      ) : null}
      {resizer}
    </>
  );
}
