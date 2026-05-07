import type { SessionSummary } from "@tiller/shared";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/ui";

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
    <Dialog open={Boolean(session)} onOpenChange={(open) => (!open ? onCancel() : undefined)}>
      <DialogContent aria-label="确认删除会话" className="max-w-md">
        <DialogHeader>
          <DialogTitle>确认删除会话？</DialogTitle>
          <DialogDescription>
            此操作将清理该会话的本地记录并尝试通知 Agent 删除远端会话。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1 rounded-lg bg-surface-sunken p-3">
          <strong className="text-sm font-semibold text-foreground">
            {resolveSessionTitle(session)}
          </strong>
          <span className="text-sm text-muted-foreground">{session.agentName}</span>
        </div>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button
            variant="destructive"
            type="button"
            onClick={() => onConfirm(session.id)}
          >
            确认删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
