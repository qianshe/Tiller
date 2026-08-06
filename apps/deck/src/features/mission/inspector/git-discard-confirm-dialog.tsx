import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/ui";

type GitDiscardConfirmDialogProps = {
  open: boolean;
  selectedCount: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function GitDiscardConfirmDialog({
  open,
  selectedCount,
  busy,
  onCancel,
  onConfirm,
}: GitDiscardConfirmDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <Dialog open onOpenChange={(open) => (!open && !busy ? onCancel() : undefined)}>
      <DialogContent aria-label="确认丢弃 Git 改动" className="max-w-md">
        <DialogHeader>
          <DialogTitle>丢弃 {selectedCount} 个选中改动？</DialogTitle>
          <DialogDescription>
            选中文件会恢复到当前 HEAD，相关未跟踪文件会被删除。此操作无法撤销。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button variant="destructive" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? "正在丢弃..." : "确认丢弃"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
