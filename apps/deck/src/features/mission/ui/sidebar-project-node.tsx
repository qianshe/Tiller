import type {
  AcpAgentProvider,
  ProjectSummary,
  SessionStatus,
  SessionSummary,
} from "@tiller/shared";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { resolveSessionProjectId } from "../utils/session-derivations";
import { SessionRow } from "./session-row";

type SidebarProjectNodeProps = {
  project: ProjectSummary;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  selectedProject: boolean;
  projectExpanded: boolean;
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
  formatRelativeTime: (value: string) => string;
  setPendingSessionCleanup: Dispatch<SetStateAction<SessionSummary | null>>;
  toggleMissionProjectNode: (projectId: string) => void;
};

/**
 * Renders one project branch and its session rows in the mission sidebar tree.
 */
export function SidebarProjectNode({
  project,
  projects,
  sessions,
  selectedProject,
  projectExpanded,
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
  formatRelativeTime,
  setPendingSessionCleanup,
  toggleMissionProjectNode,
}: SidebarProjectNodeProps) {
  const projectNodeSessions = sessions.filter(
    (session) => resolveSessionProjectId(session, projects) === project.id,
  );

  return (
    <div key={project.id} className="mission-tree-group" role="group">
      <div
        className={[
          "mission-tree-project-row",
          selectedProject ? "active" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <button
          type="button"
          className={[
            "mission-tree-row",
            "mission-tree-row-project",
            selectedProject ? "active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => toggleMissionProjectNode(project.id)}
          role="treeitem"
          aria-level={2}
          aria-expanded={projectExpanded}
          aria-selected={selectedProject}
        >
          <span className="mission-tree-caret">
            {projectExpanded ? "▾" : "▸"}
          </span>
          <span className="mission-tree-icon">
            {projectExpanded ? "📂" : "📁"}
          </span>
          <span className="mission-tree-main">
            <strong>{project.name}</strong>
            <span>{sessionCountsByProject[project.id] ?? 0} 任务</span>
          </span>
        </button>
        <button
          type="button"
          className="mission-tree-new-inline"
          onClick={() => {
            setSelectedMissionHelmId(project.helmId);
            setSelectedProjectId(project.id);
            setSelectedWorkspaceId(
              project.defaultWorkspaceId ?? project.workspaceIds?.[0] ?? null,
            );
            setSelectedAgentId(project.defaultAgentId ?? agents[0]?.id ?? null);
            setExpandedMissionProjectIds(
              (current) => new Set([...current, project.id]),
            );
            setActiveSessionId(null);
          }}
          aria-label={`在 ${project.name} 下新建任务`}
          title="新建任务"
        >
          ＋
        </button>
      </div>
      {projectExpanded ? (
        <div
          className="mission-tree-children mission-tree-children-sessions"
          role="group"
        >
          {projectNodeSessions.length ? (
            projectNodeSessions.map((session) => {
              const sessionStatus = statuses[session.id] ?? session.status;
              return (
                <SessionRow
                  key={session.id}
                  activeSessionId={activeSessionId}
                  copy={copy}
                  formatRelativeTime={formatRelativeTime}
                  openSession={openSession}
                  renderAgentIcon={renderMissionAgentIcon}
                  resolveDisplayTitle={resolveDisplaySessionTitle}
                  session={session}
                  sessionStatus={sessionStatus}
                  setPendingSessionCleanup={setPendingSessionCleanup}
                />
              );
            })
          ) : (
            <div className="mission-tree-empty">这个项目还没有任务。</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
