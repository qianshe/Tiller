import type {
  AcpAgentProvider,
  ProjectSummary,
  SessionStatus,
  SessionSummary,
} from "@tiller/shared";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Badge, Button } from "../../../shared/ui";
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
  toggleMissionProjectNode: (projectId: string) => void;
  setSelectedMissionMobilePane: Dispatch<SetStateAction<MissionMobilePane>>;
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
  toggleMissionProjectNode,
  setSelectedMissionMobilePane,
}: SidebarProjectNodeProps) {
  const projectNodeSessions = sessions.filter(
    (session) => resolveSessionProjectId(session, projects) === project.id,
  );

  return (
    <div key={project.id} className="mission-tree-group grid gap-1" role="group">
      <div
        className={cn(
          "mission-tree-project-row group/project relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-xl",
          selectedProject && "active bg-primary-soft/60",
        )}
      >
        <button
          type="button"
          className={cn(
            "mission-tree-row mission-tree-row-project grid min-w-0 flex-1 grid-cols-[18px_22px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm text-foreground transition hover:bg-surface-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            selectedProject && "active text-primary",
          )}
          onClick={() => toggleMissionProjectNode(project.id)}
          role="treeitem"
          aria-level={2}
          aria-expanded={projectExpanded}
          aria-selected={selectedProject}
        >
          <span className="mission-tree-caret text-xs text-muted-foreground">
            {projectExpanded ? "▾" : "▸"}
          </span>
          <span
            className="mission-tree-icon grid size-5 place-items-center rounded-md bg-surface-sunken text-xs"
            aria-hidden="true"
          >
            {projectExpanded ? "📂" : "📁"}
          </span>
          <span className="mission-tree-main grid min-w-0">
            <strong className="truncate font-semibold">{project.name}</strong>
          </span>
          <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">
            {sessionCountsByProject[project.id] ?? 0}
          </Badge>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mission-tree-new-inline size-7 shrink-0 rounded-lg text-muted-foreground opacity-80 hover:text-primary group-hover/project:opacity-100"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => {
            setSelectedMissionHelmId(project.helmId);
            setSelectedProjectId(project.id);
            setSelectedCwd(project.path ?? project.worktrees?.[0]?.path ?? null);
            setSelectedAgentId(null);
            setAgentPickerOpen(true);
            setExpandedMissionProjectIds(
              (current) => new Set([...current, project.id]),
            );
            setActiveSessionId(null);
          }}
          aria-label={`在 ${project.name} 下新建任务`}
          aria-haspopup="listbox"
          aria-expanded={selectedProject && agentPickerOpen}
          title="新建任务"
        >
          ＋
        </Button>
        {selectedProject && agentPickerOpen ? (
          <div
            className="mission-tree-agent-menu absolute right-0 top-full z-50 mt-2 grid min-w-40 gap-1 rounded-xl border border-border-ghost bg-popover-glass p-1 shadow-ambient backdrop-blur-2xl"
            role="listbox"
            aria-label="选择 ACP Agent"
            onMouseDown={(event) => event.stopPropagation()}
          >
            {agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                role="option"
                aria-selected={agent.id === selectedAgentId}
                className={cn(
                  "rounded-lg px-3 py-2 text-left text-sm text-foreground transition hover:bg-primary-soft hover:text-primary",
                  agent.id === selectedAgentId && "active bg-primary-soft text-primary",
                )}
                onClick={() => {
                  setAgentPickerOpen(false);
                  selectDraftAgent(agent.id);
                  setSelectedMissionMobilePane("chat");
                }}
              >
                {agent.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {projectExpanded ? (
        <div
          className="mission-tree-children mission-tree-children-sessions ml-4 grid gap-1 border-l border-border-ghost pl-2"
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
                  regenerateSessionTitle={regenerateSessionTitle}
                  isRegenerating={regeneratingIds.has(session.id)}
                  session={session}
                  sessionStatus={sessionStatus}
                  setPendingSessionCleanup={setPendingSessionCleanup}
                />
              );
            })
          ) : (
            <p className="mission-tree-empty px-3 py-2 text-xs text-muted-foreground">这个项目还没有任务。</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
