import { useEffect } from "react";
import type {
  PermissionDecision,
  PermissionRequestOption,
} from "@tiller/shared";
import { Button } from "../../../shared/ui";
import { useDeckStore } from "../../../store";
import type { ApprovalStoreItem } from "../../../store/facade";
import {
  resolvePermissionActionLabel,
  resolvePermissionCommandDisplay,
  type MissionPermissionDrawerCopy,
} from "../../mission/ui/permission-drawer";

const TOAST_COPY: MissionPermissionDrawerCopy = {
  permissionRequest: "新待审任务",
  allowOnce: "本次允许",
  deny: "拒绝",
};

const TOAST_AUTO_HIDE_MS = 5000;

type ApprovalToastStackProps = {
  visible: ApprovalStoreItem | null;
  remainingCount: number;
  onAutoHide: (approvalRequestId: string) => void;
  onOpenQueue?: () => void;
  onRespond: (approvalRequestId: string, decision: PermissionDecision) => void;
};

function isAllowDecision(decision: PermissionDecision) {
  return decision.startsWith("allow");
}

export function ApprovalToastStack({
  visible,
  remainingCount,
  onAutoHide,
  onOpenQueue,
  onRespond,
}: ApprovalToastStackProps) {
  const visibleId = visible?.request.id ?? null;

  useEffect(() => {
    if (!visibleId) {
      return;
    }
    const timer = window.setTimeout(() => {
      onAutoHide(visibleId);
    }, TOAST_AUTO_HIDE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [visibleId, onAutoHide]);

  if (!visible) {
    return null;
  }

  const display = resolvePermissionCommandDisplay(visible.request.command);
  const options: PermissionRequestOption[] = visible.request.options?.length
    ? visible.request.options
    : [
        { decision: "allow", label: TOAST_COPY.allowOnce },
        { decision: "deny", label: TOAST_COPY.deny },
      ];

  return (
    <aside
      className="approval-toast-stack pointer-events-auto fixed bottom-4 right-4 z-40 grid w-[min(360px,calc(100vw-2rem))] gap-2 rounded-2xl border border-warning/40 bg-surface-elevated p-3 text-sm text-foreground shadow-ambient"
      role="status"
      aria-live="polite"
      aria-label={TOAST_COPY.permissionRequest}
    >
      <header className="flex items-center justify-between text-meta font-semibold uppercase tracking-wider text-warning">
        <span>{TOAST_COPY.permissionRequest}</span>
        {remainingCount > 0 ? (
          <span className="text-muted-foreground">还有 {remainingCount} 项待处理</span>
        ) : null}
      </header>
      <div className="grid gap-1">
        <span className="text-meta text-muted-foreground">
          Session · {visible.sessionId}
        </span>
        <strong className="truncate text-[0.95rem] font-semibold text-foreground">
          {display.title}
        </strong>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {visible.request.reason}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onOpenQueue ? (
          <Button
            variant="ghost"
            type="button"
            className="min-h-7 px-2 text-xs"
            onClick={onOpenQueue}
          >
            查看队列
          </Button>
        ) : null}
        {options.map((option) => (
          <Button
            key={`${option.decision}-${option.label}`}
            type="button"
            variant={isAllowDecision(option.decision) ? "default" : "outline"}
            className="min-h-7 min-w-[64px] px-2 text-xs shadow-none"
            disabled={visible.resolving}
            aria-busy={visible.resolving || undefined}
            onClick={() => onRespond(visible.request.id, option.decision)}
          >
            {visible.resolving
              ? "处理中..."
              : resolvePermissionActionLabel(option, TOAST_COPY)}
          </Button>
        ))}
      </div>
    </aside>
  );
}

type ApprovalToastStackContainerProps = {
  onOpenQueue?: () => void;
  onRespond: (approvalRequestId: string, decision: PermissionDecision) => void;
};

export function ApprovalToastStackContainer(props: ApprovalToastStackContainerProps) {
  const approvalToastQueue = useDeckStore((state) => state.approvalToastQueue);
  const approvalItemsById = useDeckStore((state) => state.approvalItemsById);
  const dismissApprovalToast = useDeckStore((state) => state.dismissApprovalToast);

  const visibleId = approvalToastQueue[0] ?? null;
  const visible = visibleId ? (approvalItemsById[visibleId] ?? null) : null;
  const remainingCount = Math.max(approvalToastQueue.length - 1, 0);

  return (
    <ApprovalToastStack
      visible={visible}
      remainingCount={remainingCount}
      onAutoHide={dismissApprovalToast}
      {...props}
    />
  );
}
