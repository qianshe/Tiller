import {
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { ProjectSummary, SessionStatus, SessionSummary, WorktreeSummary } from "@tiller/shared";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
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
  isMobile?: boolean;
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
  isMobile = false,
  setPendingSessionCleanup,
}: SessionRowProps) {
  const sessionPending = isSessionExecutionPending(sessionStatus);
  const title = resolveDisplayTitle(session);
  const [worktreeTooltipOpen, setWorktreeTooltipOpen] = useState(false);
  const worktreeDetail = resolveSessionWorktreeDetail(session, project);
  const isWorktreeSessionRow = isWorktreeSession(session, project);
  const relativeUpdatedAt = formatRelativeTime(session.updatedAt);
  const isFocused = session.id === (highlightedSessionId ?? activeSessionId);
  const isOpenSession = openSessionIds.has(session.id);
  const isHighlighted = isFocused || isOpenSession;

  const rowContent = (
    <div
      className={cn(
        "mission-tree-session-row group/session relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-0.5 overflow-visible rounded-sm text-foreground transition hover:bg-surface-emphasis/60",
        isHighlighted && "active bg-primary-soft text-foreground before:absolute before:left-0 before:top-0.5 before:bottom-0.5 before:w-1 before:rounded-full before:bg-primary-strong",
        isOpenSession && !isFocused && "bg-surface-emphasis/35 text-foreground",
        sessionPending && "is-running",
      )}
    >
            <button
        type="button"
        className={cn(
          "mission-tree-row mission-tree-row-session grid min-w-0 cursor-default grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-1.5 px-1.5 h-5 text-left text-action text-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
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
        <span className={cn("mission-tree-session-side ml-auto flex shrink-0 items-center", isMobile ? "pr-2" : "pr-0.5")}>
          {!sessionPending && sessionStatus !== "error" && isWorktreeSessionRow ? (
            <span className="mission-tree-session-icon mission-tree-worktree-icon grid size-3.5 place-items-center leading-none text-muted-foreground/80">
              <Icon name="branch" size={12} />
            </span>
          ) : sessionStatus === "error" ? (
            <span
              className="mission-tree-session-icon mission-tree-session-status mission-tree-session-status-error grid size-3.5 place-items-center leading-none text-destructive"
              title={copy.status[sessionStatus]}
              aria-label={copy.status[sessionStatus]}
            >
              <Icon name="circleAlert" size={12} className="shrink-0 text-destructive" />
            </span>
          ) : sessionPending ? (
            <span
              className={`mission-tree-session-icon mission-tree-session-status mission-tree-session-status-${sessionStatus} grid size-3.5 place-items-center leading-none`}
              title={copy.status[sessionStatus]}
              aria-label={copy.status[sessionStatus]}
            >
              {sessionStatus === "waiting_for_permission" ? (
                <Icon name="shield" size={12} className="shrink-0 text-warning" />
              ) : (
                <span className="size-3 animate-spin rounded-full border-[1.5px] border-border-ghost border-t-primary" />
              )}
            </span>
          ) : (
            <span aria-hidden="true" className="mission-tree-session-icon grid size-3.5 place-items-center leading-none" />
          )}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn(
              "session-inline-action mission-tree-cleanup mission-tree-actions-trigger shrink-0 rounded text-muted-foreground opacity-70 hover:text-foreground group-hover/session:opacity-100",
              isMobile ? "mr-2" : "mr-0.5",
            )}
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

  if (isMobile) {
    // 移动端无悬停，不需要悬浮信息卡片
    return rowContent;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip
        open={worktreeTooltipOpen}
        onOpenChange={setWorktreeTooltipOpen}
        disableHoverableContent
      >
        <TooltipTrigger asChild>{rowContent}</TooltipTrigger>
        <TooltipContent
          side="right"
          sideOffset={6}
          className="min-w-0 max-w-[min(22rem,85vw)] px-2.5 py-1.5 text-left"
        >
          <div className="grid gap-1 text-xs leading-tight">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate text-foreground font-medium">{title}</span>
              <span className="shrink-0 font-mono text-2xs tabular text-muted-foreground">
                {relativeUpdatedAt}
              </span>
            </div>
            <div className="grid gap-0.5 border-t border-border-ghost pt-1 tabular-nums">
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <Icon name="fleet" size={10} className="shrink-0" />
                <span className="min-w-0 truncate">{session.agentName}</span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <Icon name="branch" size={10} className="shrink-0" />
                <span className="min-w-0 truncate">
                  {isWorktreeSessionRow
                    ? `${worktreeDetail.name}${worktreeDetail.branch ? ` / ${worktreeDetail.branch}` : ""}`
                    : (worktreeDetail.branch ?? worktreeDetail.name)}
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <Icon name="folder" size={10} className="shrink-0" />
                <span className="min-w-0 truncate">{project.name}</span>
              </span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type WorktreeDetail = {
  name: string;
  branch?: string;
};

function resolveSessionWorktreeDetail(
  session: SessionSummary,
  project: ProjectSummary,
): WorktreeDetail {
  const normalizedCwd = normalizeWorktreePath(session.cwd);
  const matchedWorktree = normalizedCwd
    ? project.worktrees?.find(
        (worktree) => normalizeWorktreePath(worktree.path) === normalizedCwd,
      )
    : undefined;

  if (matchedWorktree) {
    const name = resolveWorktreeFolderName(session, matchedWorktree);
    const branch = matchedWorktree.branch;
    return branch ? { name, branch } : { name };
  }

  // 非 worktree 会话（项目根）：显示项目名 + 项目当前分支
  const name = project.name?.trim() || resolveWorktreeFolderName(session, undefined);
  const branch = project.gitCurrentBranch?.trim();
  return branch ? { name, branch } : { name };
}

function resolveWorktreeFolderName(
  session: SessionSummary,
  matchedWorktree: WorktreeSummary | undefined,
) {
  const fromName = matchedWorktree?.name?.trim() || session.worktreeName?.trim();
  if (fromName) {
    return fromName;
  }
  const segments = session.cwd.replace(/\\/gu, "/").replace(/\/+$/u, "").split("/");
  return segments.at(-1) || session.cwd;
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
