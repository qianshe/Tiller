import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { ProjectSummary, SessionStatus, SessionSummary } from "@tiller/shared";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
} from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";

type SessionRowProps = {
  activeSessionId: string | null;
  highlightedSessionId: string | null;
  openSessionIds: ReadonlySet<string>;
  copy: { status: Record<SessionStatus, string> };
  formatRelativeTime: (value: string) => string;
  openSession: (sessionId: string) => void;
  renderAgentIcon: (agentName: string) => ReactNode;
  resolveDisplayTitle: (session: SessionSummary) => string;
  regenerateSessionTitle: (session: SessionSummary) => void;
  isRegenerating: boolean;
  project: ProjectSummary;
  session: SessionSummary;
  sessionStatus: SessionStatus;
  setPendingSessionCleanup: Dispatch<SetStateAction<SessionSummary | null>>;
};

export function SessionRow({
  activeSessionId,
  highlightedSessionId,
  openSessionIds,
  copy,
  formatRelativeTime,
  openSession,
  renderAgentIcon,
  resolveDisplayTitle,
  regenerateSessionTitle,
  isRegenerating,
  project,
  session,
  sessionStatus,
  setPendingSessionCleanup,
}: SessionRowProps) {
  const sessionPending = isSessionExecutionPending(sessionStatus);
  const title = resolveDisplayTitle(session);
  const worktreeLabel = resolveSessionWorktreeLabel(session, project);
  const relativeUpdatedAt = formatRelativeTime(session.updatedAt);
  const isFocused = session.id === (highlightedSessionId ?? activeSessionId);
  const isOpenSession = openSessionIds.has(session.id);
  const isHighlighted = isFocused || isOpenSession;

  return (
    <div
      className={cn(
        "mission-tree-session-row group/session relative grid grid-cols-[minmax(0,1fr)_24px] items-center gap-0.5 overflow-visible rounded-sm text-foreground transition hover:bg-surface-emphasis/60",
        isHighlighted && "active bg-surface-emphasis/70 text-foreground before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-full before:bg-primary",
        isOpenSession && !isFocused && "bg-surface-emphasis/35 text-foreground",
        sessionPending && "is-running",
      )}
    >
      <button
        type="button"
        className={cn(
          "mission-tree-row mission-tree-row-session grid min-w-0 cursor-default grid-cols-[14px_minmax(0,1fr)_14px_auto] items-center gap-1.5 px-1.5 h-5 text-left text-action text-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          isHighlighted && "pl-2",
        )}
        onClick={() => openSession(session.id)}
        role="treeitem"
        aria-level={3}
        aria-selected={isHighlighted}
      >
        <span
          className="mission-tree-agent-icon grid size-3.5 place-items-center overflow-hidden bg-transparent text-2xs text-muted-foreground"
          title={session.agentName}
        >
          {renderAgentIcon(session.agentName)}
        </span>
        <span className="mission-tree-main flex min-w-0 items-center">
          <span className="min-w-0 truncate text-action leading-none">{title}</span>
        </span>
        {worktreeLabel ? (
          <span
            className="mission-tree-worktree-icon grid size-3.5 place-items-center text-muted-foreground/80"
            title={`Worktree：${worktreeLabel}`}
          >
            <Icon name="branch" size={10} />
          </span>
        ) : (
          <span aria-hidden="true" className="size-3.5" />
        )}
        <span className="mission-tree-session-side flex shrink-0 items-center gap-1">
          {sessionPending ? (
            <Badge
              variant={
                sessionStatus === "waiting_for_permission" ? "warning" : "success"
              }
              className={`mission-tree-session-status mission-tree-session-status-${sessionStatus} rounded-none bg-transparent px-1.5 py-0 text-2xs font-mono tabular`}
              aria-label={copy.status[sessionStatus]}
            >
              {copy.status[sessionStatus]}
            </Badge>
          ) : (
            <span
              className="mission-tree-time shrink-0 text-right font-mono text-2xs tabular text-muted-foreground"
              title={`最后更新：${relativeUpdatedAt}`}
              aria-label={`最后更新：${relativeUpdatedAt}`}
            >
              {relativeUpdatedAt}
            </span>
          )}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="session-inline-action mission-tree-cleanup mission-tree-actions-trigger mr-0.5 shrink-0 rounded text-muted-foreground opacity-70 hover:text-foreground group-hover/session:opacity-100"
            aria-label={`${title} 的操作`}
            title="任务操作"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            ⋯
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side="bottom"
          className="mission-tree-session-menu min-w-36"
          onClick={(event) => event.stopPropagation()}
        >
          <DropdownMenuItem
            disabled={isRegenerating}
            onSelect={() => regenerateSessionTitle(session)}
          >
            {isRegenerating ? "生成中…" : "重新生成名称"}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="danger text-destructive focus:bg-destructive/10 focus:text-destructive"
            onSelect={() => setPendingSessionCleanup(session)}
          >
            清理任务
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function resolveSessionWorktreeLabel(session: SessionSummary, project: ProjectSummary) {
  if (!isWorktreeSession(session, project)) {
    return null;
  }
  return session.worktreeName || session.cwd || null;
}

function isWorktreeSession(session: SessionSummary, project: ProjectSummary) {
  const normalizedCwd = normalizeWorktreePath(session.cwd);
  const normalizedProjectPath = normalizeWorktreePath(project.path);
  if (normalizedCwd && normalizedProjectPath && normalizedCwd === normalizedProjectPath) {
    return false;
  }

  const matchedWorktree = normalizedCwd
    ? project.worktrees?.find(
        (worktree) => normalizeWorktreePath(worktree.path) === normalizedCwd,
      )
    : undefined;
  if (matchedWorktree) {
    return normalizeWorktreePath(matchedWorktree.path) !== normalizedProjectPath;
  }

  const worktreeName = session.worktreeName?.trim();
  if (
    worktreeName &&
    worktreeName !== session.projectName?.trim() &&
    worktreeName.toLowerCase() !== "main"
  ) {
    return true;
  }

  const normalizedWorktree = `${session.cwd} ${session.worktreeName ?? ""}`.toLowerCase();
  return (
    normalizedWorktree.includes("-worktree-") ||
    normalizedWorktree.includes("/.worktrees/") ||
    normalizedWorktree.includes(".worktrees")
  );
}

function normalizeWorktreePath(path: string | undefined) {
  return path?.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}

function isSessionExecutionPending(status: SessionStatus) {
  return (
    status === "starting" ||
    status === "running" ||
    status === "waiting_for_permission"
  );
}
