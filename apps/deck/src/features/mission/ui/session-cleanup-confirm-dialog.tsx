import type { SessionSummary } from "@tiller/shared";

type SessionCleanupConfirmDialogProps = {
  session: SessionSummary | null;
  resolveSessionTitle: (session: SessionSummary) => string;
  onCancel: () => void;
  onConfirm: (sessionId: string) => void;
};

/**
 * Confirmation dialog for deleting local session history and remote ACP runtime state.
 */
export function SessionCleanupConfirmDialog({
  session,
  resolveSessionTitle,
  onCancel,
  onConfirm,
}: SessionCleanupConfirmDialogProps) {
  if (!session) {
    return null;
  }

  return (
    <div className="fleet-modal-backdrop" role="presentation">
      <section
        className="card surface-card fleet-delete-helm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="确认删除会话"
      >
        <div className="fleet-dialog-head fleet-dialog-head-simple">
          <h3>确认删除会话？</h3>
          <button
            className="secondary fleet-dialog-close"
            type="button"
            onClick={onCancel}
          >
            关闭
          </button>
        </div>
        <div className="fleet-delete-confirm-body">
          <p>此操作将清理该会话的本地记录并尝试通知 Agent 删除远端会话。</p>
          <div className="fleet-delete-target">
            <strong>{resolveSessionTitle(session)}</strong>
            <span>{session.agentName}</span>
          </div>
        </div>
        <div className="section-actions fleet-delete-actions">
          <button className="secondary" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className="secondary helm-destroy-button"
            type="button"
            onClick={() => onConfirm(session.id)}
          >
            确认删除
          </button>
        </div>
      </section>
    </div>
  );
}
