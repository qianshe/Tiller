import type {
  PermissionDecision,
  PermissionRequest,
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

const PANEL_COPY: MissionPermissionDrawerCopy = {
  permissionRequest: "待审核任务",
  allowOnce: "本次允许",
  deny: "拒绝",
};

type GlobalApprovalPanelProps = {
  approvals: ReadonlyArray<ApprovalStoreItem>;
  onOpenSession?: (sessionId: string) => void;
  onRespond: (approvalRequestId: string, decision: PermissionDecision) => void;
};

function isAllowDecision(decision: PermissionDecision) {
  return decision.startsWith("allow");
}

function resolveOptions(request: PermissionRequest): PermissionRequestOption[] {
  return request.options?.length
    ? request.options
    : [
        { decision: "allow" as const, label: PANEL_COPY.allowOnce },
        { decision: "deny" as const, label: PANEL_COPY.deny },
      ];
}

export function GlobalApprovalPanel({
  approvals,
  onOpenSession,
  onRespond,
}: GlobalApprovalPanelProps) {
  if (approvals.length === 0) {
    return null;
  }

  return (
    <section
      className="global-approval-panel pointer-events-auto fixed right-4 top-16 z-30 grid max-h-[80vh] w-[min(360px,calc(100vw-2rem))] gap-2 overflow-y-auto rounded-2xl border border-warning/40 bg-surface-elevated p-3 text-sm text-foreground shadow-ambient"
      role="region"
      aria-live="polite"
      aria-label={PANEL_COPY.permissionRequest}
    >
      <header className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-warning">
        <span>{PANEL_COPY.permissionRequest}</span>
        <span className="text-muted-foreground">{approvals.length}</span>
      </header>
      <ul className="grid gap-2">
        {approvals.map((item) => {
          const display = resolvePermissionCommandDisplay(item.request.command);
          const options = resolveOptions(item.request);
          return (
            <li
              key={item.request.id}
              className="grid gap-2 rounded-xl border border-border-ghost bg-surface-sunken p-2"
            >
              <div className="grid gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Session · {item.sessionId}
                </span>
                <strong className="truncate text-[0.95rem] font-semibold text-foreground">
                  {display.title}
                </strong>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {item.request.reason}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {onOpenSession ? (
                  <Button
                    variant="ghost"
                    type="button"
                    className="min-h-7 px-2 text-xs"
                    onClick={() => onOpenSession(item.sessionId)}
                  >
                    打开会话
                  </Button>
                ) : null}
                {options.map((option) => (
                  <Button
                    key={`${option.decision}-${option.label}`}
                    type="button"
                    variant={isAllowDecision(option.decision) ? "default" : "outline"}
                    className="min-h-7 min-w-[64px] px-2 text-xs shadow-none"
                    disabled={item.resolving}
                    aria-busy={item.resolving || undefined}
                    onClick={() => onRespond(item.request.id, option.decision)}
                  >
                    {item.resolving
                      ? "处理中..."
                      : resolvePermissionActionLabel(option, PANEL_COPY)}
                  </Button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type GlobalApprovalPanelContainerProps = {
  onOpenSession?: (sessionId: string) => void;
  onRespond: (approvalRequestId: string, decision: PermissionDecision) => void;
};

export function GlobalApprovalPanelContainer(props: GlobalApprovalPanelContainerProps) {
  const pendingApprovalIds = useDeckStore((state) => state.pendingApprovalIds);
  const approvalItemsById = useDeckStore((state) => state.approvalItemsById);
  const approvals = pendingApprovalIds
    .map((id) => approvalItemsById[id])
    .filter((item): item is ApprovalStoreItem => Boolean(item));
  return <GlobalApprovalPanel approvals={approvals} {...props} />;
}
