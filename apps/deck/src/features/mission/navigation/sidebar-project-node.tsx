import type {
  ProjectSummary,
  SessionStatus,
  SessionSummary,
} from "@tiller/shared";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Icon } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import type { MissionMobilePane } from "../hooks/layout";
import { resolveSessionProjectId } from "../utils/session-derivations";
import { SessionRow } from "./session-row";

type SidebarProjectNodeProps = {
  project: ProjectSummary;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  selectedProject: boolean;
  projectExpanded: boolean;
  sessionCountsByProject: Record<string, number>;
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
  toggleMissionProjectNode: (projectId: string) => void;
  setSelectedMissionMobilePane: Dispatch<SetStateAction<MissionMobilePane>>;
  isMobile?: boolean;
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
  toggleMissionProjectNode,
  setSelectedMissionMobilePane,
  isMobile = false,
}: SidebarProjectNodeProps) {
  const projectNodeSessions = sessions.filter(
    (session) => resolveSessionProjectId(session, projects) === project.id,
  );

  return (
    <div key={project.id} className="mission-tree-group grid gap-1" role="group">
      <div
        className={cn(
          "mission-tree-project-row relative grid items-center",
          selectedProject && "active bg-surface-emphasis/50",
        )}
      >
        <button
          type="button"
          className={cn(
            "mission-tree-row mission-tree-row-project grid min-w-0 flex-1 grid-cols-[12px_14px_minmax(0,1fr)_auto] items-center gap-1.5 px-1.5 h-5 text-left text-section text-foreground transition hover:bg-surface-emphasis/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            selectedProject && "active text-foreground bg-transparent",
          )}
          onClick={() => toggleMissionProjectNode(project.id)}
          role="treeitem"
          aria-level={2}
          aria-expanded={projectExpanded}
          aria-selected={selectedProject}
        >
          <span className="mission-tree-caret text-2xs text-muted-foreground">
            {projectExpanded ? "▾" : "▸"}
          </span>
          <Icon name="folder" size={11} className="shrink-0 text-muted-foreground" />
          <span className="mission-tree-main flex min-w-0 items-center">
            <span className="truncate text-action">{project.name}</span>
          </span>
          <span className="shrink-0 font-mono text-2xs tabular text-muted-foreground">
            {sessionCountsByProject[project.id] ?? 0}
          </span>
        </button>
      </div>
      {projectExpanded ? (
        <div
          className="mission-tree-children mission-tree-children-sessions ml-3 grid gap-1 border-l border-border-ghost/70 pl-2"
          role="group"
        >
          {projectNodeSessions.length ? (
            projectNodeSessions.map((session) => {
              const sessionStatus = statuses[session.id] ?? session.status;
              return (
                <SessionRow
                  key={session.id}
                  activeSessionId={activeSessionId}
                  highlightedSessionId={highlightedSessionId}
                  openSessionIds={openSessionIds}
                  copy={copy}
                  formatRelativeTime={formatRelativeTime}
                  openSession={openSession}
                  renderAgentIcon={renderMissionAgentIcon}
                  resolveDisplayTitle={resolveDisplaySessionTitle}
                  regenerateSessionTitle={regenerateSessionTitle}
                  isRegenerating={regeneratingIds.has(session.id)}
                  project={project}
                  session={session}
                  sessionStatus={sessionStatus}
                  completedUnread={Boolean(completedUnreadSessionIds[session.id])}
                  isMobile={isMobile}
                  setPendingSessionCleanup={setPendingSessionCleanup}
                />
              );
            })
          ) : (
            <p className="mission-tree-empty px-2.5 py-1.5 text-meta text-muted-foreground">这个项目还没有任务。</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
