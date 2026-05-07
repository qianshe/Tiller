import {
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { SessionStatus, SessionSummary } from "@tiller/shared";

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
  const [actionsOpen, setActionsOpen] = useState(false);
  const sessionPending = isSessionExecutionPending(sessionStatus);
  const title = resolveDisplayTitle(session);

  function closeActions() {
    setActionsOpen(false);
  }

  return (
    <div
      className={[
        "mission-tree-session-row",
        session.id === activeSessionId ? "active" : "",
        sessionPending ? "is-running" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="mission-tree-row mission-tree-row-session"
        onClick={() => openSession(session.id)}
        role="treeitem"
        aria-level={3}
        aria-selected={session.id === activeSessionId}
      >
        <span className="mission-tree-caret" />
        <span className="mission-tree-agent-icon" title={session.agentName}>
          {renderAgentIcon(session.agentName)}
        </span>
        <span className="mission-tree-main">
          <strong>{title}</strong>
          <span>
            ACP · {session.agentName} ·{copy.status[sessionStatus]}
          </span>
        </span>
        {sessionPending ? (
          <span
            className={`mission-tree-session-status mission-tree-session-status-${sessionStatus}`}
            aria-label={copy.status[sessionStatus]}
          >
            <i aria-hidden="true" />
            {copy.status[sessionStatus]}
          </span>
        ) : null}
        <span className="mission-tree-time">
          {formatRelativeTime(session.updatedAt)}
        </span>
      </button>
      <button
        type="button"
        className="session-inline-action mission-tree-cleanup mission-tree-actions-trigger"
        aria-label={`${title} 的操作`}
        aria-expanded={actionsOpen}
        title="任务操作"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setActionsOpen((current) => !current);
        }}
      >
        ⋯
      </button>
      {actionsOpen ? (
        <div
          className="mission-tree-session-menu"
          role="menu"
          aria-label={`${title} 的操作菜单`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={isRegenerating}
            onClick={() => {
              regenerateSessionTitle(session);
              closeActions();
            }}
          >
            {isRegenerating ? "生成中…" : "重新生成名称"}
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              setPendingSessionCleanup(session);
              closeActions();
            }}
          >
            清理任务
          </button>
        </div>
      ) : null}
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
