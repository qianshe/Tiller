import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { SessionStatus, SessionSummary } from "@tiller/shared";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";

type SessionRowProps = {
  activeSessionId: string | null;
  copy: { status: Record<SessionStatus, string> };
  formatRelativeTime: (value: string) => string;
  openSession: (sessionId: string) => void;
  renderAgentIcon: (agentName: string) => ReactNode;
  resolveDisplayTitle: (session: SessionSummary) => string;
  regenerateSessionTitle: (session: SessionSummary) => void;
  isRegenerating: boolean;
  session: SessionSummary;
  sessionStatus: SessionStatus;
  setPendingSessionCleanup: Dispatch<SetStateAction<SessionSummary | null>>;
};

export function SessionRow({
  activeSessionId,
  copy,
  formatRelativeTime,
  openSession,
  renderAgentIcon,
  resolveDisplayTitle,
  regenerateSessionTitle,
  isRegenerating,
  session,
  sessionStatus,
  setPendingSessionCleanup,
}: SessionRowProps) {
  const sessionPending = isSessionExecutionPending(sessionStatus);
  const title = resolveDisplayTitle(session);

  return (
    <div
      className={cn(
        "mission-tree-session-row group/session relative grid grid-cols-[minmax(0,1fr)_28px] items-center gap-0.5 overflow-visible",
        sessionPending && "is-running",
      )}
    >
      <button
        type="button"
        className={cn(
          "mission-tree-row mission-tree-row-session grid min-w-0 grid-cols-[16px_20px_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition hover:bg-surface-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          session.id === activeSessionId && "active bg-primary-soft/65",
        )}
        onClick={() => openSession(session.id)}
        role="treeitem"
        aria-level={3}
        aria-selected={session.id === activeSessionId}
      >
        <span className="mission-tree-caret" />
        <span
          className="mission-tree-agent-icon grid size-5 place-items-center overflow-hidden rounded bg-surface-sunken text-[10px]"
          title={session.agentName}
        >
          {renderAgentIcon(session.agentName)}
        </span>
        <span className="mission-tree-main grid min-w-0 gap-0.5">
          <strong className="truncate font-medium leading-tight">{title}</strong>
          <span className="mission-tree-session-meta flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
            <span className="truncate">ACP · {session.agentName}</span>
            <span aria-hidden="true">·</span>
            {sessionPending ? (
              <Badge
                variant={
                  sessionStatus === "waiting_for_permission" ? "warning" : "success"
                }
                className={`mission-tree-session-status mission-tree-session-status-${sessionStatus} px-1.5 py-0 text-[10px]`}
                aria-label={copy.status[sessionStatus]}
              >
                {copy.status[sessionStatus]}
              </Badge>
            ) : (
              <span className="mission-tree-time shrink-0 text-[10px] text-muted-foreground">
                {formatRelativeTime(session.updatedAt)}
              </span>
            )}
          </span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="session-inline-action mission-tree-cleanup mission-tree-actions-trigger size-7 shrink-0 rounded-lg text-muted-foreground opacity-70 hover:text-foreground group-hover/session:opacity-100"
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

function isSessionExecutionPending(status: SessionStatus) {
  return (
    status === "starting" ||
    status === "running" ||
    status === "waiting_for_permission"
  );
}
