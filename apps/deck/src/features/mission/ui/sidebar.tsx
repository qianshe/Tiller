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
    "chat-session-sidebar",
    "mission-pane",
    "mission-pane-sidebar",
    effectiveSidebarCollapsed ? "collapsed" : "",
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
          <button
            type="button"
            className="mission-sidebar-toggle"
            onClick={() => setMissionSidebarCollapsed(true)}
            aria-expanded="true"
            aria-label="收起任务导航"
            title="收起任务导航"
          >
            ‹
          </button>
        ) : null}
        {missionSidebarCollapsed ? null : (
          <div className="sidebar-section mission-tree-switcher">
            <div className="section-head section-head-soft sidebar-heading-block">
              <div>
                <h2>项目</h2>
                <p className="muted compact">
                  Helm → Project → Session（绑定 ACP）
                </p>
              </div>
            </div>
            <div className="mission-tree" role="tree" aria-label="任务层级树">
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
                    className="mission-tree-group"
                    role="group"
                  >
                    <button
                      type="button"
                      className={[
                        "mission-tree-row",
                        "mission-tree-row-helm",
                        selectedHelm ? "active" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => toggleMissionHelmNode(helm.id)}
                      role="treeitem"
                      aria-level={1}
                      aria-expanded={helmExpanded}
                      aria-selected={selectedHelm}
                    >
                      <span className="mission-tree-caret">
                        {helmExpanded ? "▾" : "▸"}
                      </span>
                      <span className="mission-tree-icon">⎈</span>
                      <span className="mission-tree-main">
                        <strong>{helm.name}</strong>
                        <span>
                          {helm.host}:{helm.port} · {helmProjects.length}
                          项目
                        </span>
                      </span>
                      <span
                        className={`mission-tree-status-dot helm-status-${helmConnectionState}`}
                        title={formatConnectionStatus(helmConnectionState)}
                        aria-label={formatConnectionStatus(helmConnectionState)}
                      />
                    </button>
                    {helmExpanded ? (
                      <div
                        className="mission-tree-children mission-tree-children-projects"
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
                          <div className="mission-tree-empty">
                            这个 Helm 还没有项目。
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {!missionHelms.length ? (
                <div className="empty-state sidebar-empty">暂无 Helm。</div>
              ) : null}
              {sessionHistoryState.loading ? (
                <div className="mission-tree-empty"> 正在加载更多任务... </div>
              ) : null}
            </div>
          </div>
        )}
      </aside>
      {missionSidebarCollapsed ? (
        <button
          type="button"
          className="mission-sidebar-toggle mission-sidebar-floating-toggle"
          onClick={() => setMissionSidebarCollapsed(false)}
          aria-expanded="false"
          aria-label="展开任务导航"
          title="展开任务导航"
        >
          ›
        </button>
      ) : null}
      {resizer}
    </>
  );
}
