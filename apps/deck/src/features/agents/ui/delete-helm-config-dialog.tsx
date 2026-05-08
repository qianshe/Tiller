import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui";
import type { DaemonProfile } from "../../helm-connection/facade";

type DeleteHelmConfigDialogProps = {
  profile: DaemonProfile;
  onClose: () => void;
  onRemove: (profile: DaemonProfile) => void;
};

export function DeleteHelmConfigDialog({
  profile,
  onClose,
  onRemove,
}: DeleteHelmConfigDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-label="删除 Helm 前端配置" className="max-w-xl">
        <DialogHeader>
          <DialogTitle>删除 Helm 前端配置</DialogTitle>
          <DialogDescription>
            只会从 Deck 的本地 Fleet 列表删除这条 Helm 配置，不会销毁远端 Helm
            进程，也不会删除 Helm 后端配置。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1 rounded-md border border-destructive/25 bg-destructive/10 p-4">
          <strong className="text-destructive">{profile.name}</strong>
          <span className="font-mono text-sm text-destructive/80">
            {profile.host}:{profile.port}
          </span>
        </div>
        <DialogFooter>
          <Button variant="outline" type="button" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="destructive"
            type="button"
            onClick={() => onRemove(profile)}
          >
            确认删除配置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
