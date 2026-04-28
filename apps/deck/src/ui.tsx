import type { MutableRefObject, ReactNode } from "react";
import type {
  AgentMessage,
  CommandChunk,
  FileDiffSummary,
  PermissionDecision,
  PermissionRequest,
  SessionStatus,
  SessionSummary,
} from "@tiller/shared";
import { Fragment } from "react";

export type UICopyLike = {
  waitingForAgent: string;
  permissionRequest: string;
  allowOnce: string;
  deny: string;
  role: Record<string, string>;
};

export function StatCard({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <div className="stat-card">
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <span className="subtle">{meta}</span>
    </div>
  );
}

export function InfoList({ title, items, empty }: { title?: string; items: string[]; empty: string }) {
  return (
    <div>
      {title ? <h3>{title}</h3> : null}
      {items.length ? (
        <ul className="info-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <div className="empty-state">{empty}</div>
      )}
    </div>
  );
}

export function Panel({ title, tone, children }: { title: string; tone?: "terminal"; children: ReactNode }) {
  return (
    <section className={`panel stack-gap ${tone ? `panel-${tone}` : ""}`}>
      <div className="section-head">
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  );
}

export function PairingBoxes({
  refs,
  value,
  disabled,
  onChange,
  onKeyDown,
  onPaste,
}: {
  refs: MutableRefObject<Array<HTMLInputElement | null>>;
  value: string;
  disabled: boolean;
  onChange: (index: number, value: string) => void;
  onKeyDown: (index: number, key: string) => void;
  onPaste: (index: number, value: string) => void;
}) {
  const chars = Array.from({ length: 6 }, (_, index) => value[index] ?? "");
  return (
    <div className="pairing-boxes pairing-boxes-grouped" aria-label="6 位验证码，按两位一组输入">
      {[0, 2, 4].map((startIndex, groupIndex) => (
        <Fragment key={startIndex}>
          {groupIndex > 0 ? <span className="pairing-separator" aria-hidden="true">-</span> : null}
          <div className="pairing-box-group">
            {chars.slice(startIndex, startIndex + 2).map((char, offset) => {
              const index = startIndex + offset;
              return (
                <input
                  key={index}
                  ref={(element) => {
                    refs.current[index] = element;
                  }}
                  className="pairing-box"
                  value={char}
                  inputMode="text"
                  autoCapitalize="characters"
                  autoComplete="one-time-code"
                  maxLength={1}
                  disabled={disabled}
                  onChange={(event) => onChange(index, event.target.value)}
                  onKeyDown={(event) => onKeyDown(index, event.key)}
                  onPaste={(event) => {
                    event.preventDefault();
                    onPaste(index, event.clipboardData.getData("text"));
                  }}
                />
              );
            })}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

export function MessageStream({ items, copy }: { items: AgentMessage[]; copy: UICopyLike }) {
  if (!items.length) {
    return <div className="empty-state">{copy.waitingForAgent}</div>;
  }

  return (
    <div className="stream-list">
      {items.map((item) => (
        <article key={item.id} className={`bubble role-${item.role}`}>
          <span className="bubble-role">{copy.role[item.role]}</span>
          <p>{item.text}</p>
        </article>
      ))}
    </div>
  );
}

export function PermissionCard({
  permissionRequest,
  onRespond,
  copy,
}: {
  permissionRequest: PermissionRequest;
  onRespond: (decision: PermissionDecision) => void;
  copy: UICopyLike;
}) {
  return (
    <section className="permission-card">
      <div>
        <p className="eyebrow">{copy.permissionRequest}</p>
        <strong>{permissionRequest.command}</strong>
        <p className="muted compact">{permissionRequest.reason}</p>
      </div>
      <div className="permission-actions">
        <button className="primary" type="button" onClick={() => onRespond("allow")}>
          {copy.allowOnce}
        </button>
        <button className="secondary" type="button" onClick={() => onRespond("deny")}>
          {copy.deny}
        </button>
      </div>
    </section>
  );
}

export function CommandOutput({ items, emptyLabel }: { items: CommandChunk[]; emptyLabel: string }) {
  if (!items.length) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <div className="output-list">
      {items.map((item) => (
        <pre key={item.id} className={`output-block stream-${item.stream}`}>
          {item.text}
        </pre>
      ))}
    </div>
  );
}

export function DiffSummary({ items, emptyLabel }: { items: FileDiffSummary[]; emptyLabel: string }) {
  if (!items.length) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <ul className="diff-list">
      {items.map((item) => (
        <li key={item.path}>
          <strong>{item.status}</strong> {item.path}
          <span className="diff-meta">
            +{item.additions} / -{item.deletions}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function SessionRecordList({
  sessions,
  activeSessionId,
  resolveStatusLabel,
  resolveResumeLabel,
  onSelect,
  emptyLabel,
  formatTime,
  emptyPreviewLabel,
  compact = false,
}: {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  resolveStatusLabel: (session: SessionSummary) => string;
  resolveResumeLabel?: (session: SessionSummary) => string;
  onSelect: (sessionId: string) => void;
  emptyLabel: string;
  formatTime: (value: string) => string;
  emptyPreviewLabel?: string;
  compact?: boolean;
}) {
  if (!sessions.length) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <div className={compact ? "session-list" : "session-history-list"}>
      {sessions.map((session) => {
        const selected = session.id === activeSessionId;
        return (
          <button
            key={session.id}
            type="button"
            className={`session-item ${compact ? "" : "session-history-item"} ${selected ? "selected" : ""}`.trim()}
            onClick={() => onSelect(session.id)}
          >
            <span className="session-item-main">
              <strong>{session.workspaceName}</strong>
              <span className="subtle">
                {session.agentName} · {formatTime(session.updatedAt)}
              </span>
              {resolveResumeLabel ? <span className="subtle">{resolveResumeLabel(session)}</span> : null}
              {session.lastMessagePreview || emptyPreviewLabel ? (
                <span className="subtle">{session.lastMessagePreview ?? emptyPreviewLabel}</span>
              ) : null}
            </span>
            <span className={compact ? "" : "session-history-meta"}>
              <span className="status-chip">{resolveStatusLabel(session)}</span>
              {!compact ? <span className="subtle">{session.messageCount} msg</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
