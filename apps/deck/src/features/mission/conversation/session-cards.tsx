import type { ComponentProps, ReactNode, UIEventHandler } from "react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AgentPlan, SessionSummary } from "@tiller/shared";
import {
  Icon,
  AgentIcon,
  StatusDot,
} from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import {
  formatSessionPreviewTime,
  resolveSessionStatusLabel,
  resolveSessionStatusTone,
} from "./chat-pane-model";
import {
  MissionToolLoadingTitle,
  type MissionToolLoadingState,
} from "./tool-loading";
import {
  MissionPlanDrawer,
  createAgentPlanDismissalKey,
  isAgentPlanComplete,
} from "./plan-drawer";

export type SessionRestoreNotice = {
  title: string;
  message: string;
};

export type MissionDraftChatWindow = {
  id: string;
  title: string;
  projectName: string;
  worktreeName: string;
  agentName: string | null;
  status: "select-agent" | "connecting" | "ready";
  message: string;
};

export type MissionDraftAgentOption = {
  id: string;
  name: string;
};

export type SessionCardScrollSnapshot = {
  scrollTop: number;
  scrollHeight: number;
};

const SCROLL_TO_BOTTOM_THRESHOLD = 80;

export function shouldShowSessionScrollToBottom({
  scrollHeight,
  scrollTop,
  clientHeight,
}: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  return scrollHeight - scrollTop - clientHeight > SCROLL_TO_BOTTOM_THRESHOLD;
}

function ScrollToBottomButton({
  visible,
  position = "bottom",
  onClick,
}: {
  visible: boolean;
  position?: "bottom" | "above-plan";
  onClick: () => void;
}) {
  if (!visible) {
    return null;
  }

  return (
    <button
      type="button"
      className={cn(
        "absolute right-3 z-10 grid h-7 w-7 place-items-center rounded-full border border-border-ghost bg-surface/95 text-muted-foreground shadow-ambient backdrop-blur transition hover:border-primary/50 hover:bg-surface-emphasis hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        position === "above-plan" ? "bottom-14" : "bottom-3",
      )}
      aria-label="回到底部"
      title="回到底部"
      data-session-scroll-bottom
      data-session-scroll-bottom-position={position}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Icon name="chevronDown" size={14} />
    </button>
  );
}

function useSessionCardScrollControls() {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const updateScrollToBottomVisibility = useCallback((body = bodyRef.current) => {
    if (!body) {
      setShowScrollToBottom(false);
      return;
    }
    const next = shouldShowSessionScrollToBottom({
      scrollHeight: body.scrollHeight,
      scrollTop: body.scrollTop,
      clientHeight: body.clientHeight,
    });
    setShowScrollToBottom((current) => (current === next ? current : next));
  }, []);
  const scrollToBottom = useCallback(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
    setShowScrollToBottom(false);
  }, []);

  return {
    bodyRef,
    showScrollToBottom,
    scrollToBottom,
    updateScrollToBottomVisibility,
  };
}

/**
 * Joins project and worktree names, dropping the worktree suffix when it only
 * echoes the project name (e.g. a root worktree named after the project).
 */
export function formatProjectWorktreeLabel(
  projectName: string,
  worktreeName: string | null | undefined,
): string {
  const worktree = worktreeName?.trim();
  if (worktree && worktree.toLowerCase() !== projectName.trim().toLowerCase()) {
    return `${projectName} / ${worktree}`;
  }
  return projectName;
}

const SESSION_STATUS_PILL_TONES: Record<
  ReturnType<typeof resolveSessionStatusTone>,
  string
> = {
  active: "border-success/25 bg-success/10 text-success",
  idle: "border-border-ghost bg-surface-sunken text-muted-foreground",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
  primary: "border-primary/20 bg-primary/10 text-primary",
};

/**
 * Title-bar status chip mirroring the tool-loading pill so a session's
 * running / idle / error state shares the same framed look. No pulsing dot
 * here — liveness stays owned by the title-bar StatusDot.
 */
export function SessionStatusPill({ status }: { status: SessionSummary["status"] }) {
  return (
    <span
      className={cn(
        "mission-session-status-pill flex min-w-0 items-center rounded-full border px-2 py-0.5 text-2xs font-medium",
        SESSION_STATUS_PILL_TONES[resolveSessionStatusTone(status)],
      )}
      data-session-status-label
    >
      <span className="truncate">{resolveSessionStatusLabel(status)}</span>
    </span>
  );
}

export function SessionCard({
  session,
  active,
  bodyScrollSnapshot,
  onBodyScroll,
  onFocus,
  onRename,
  onClear,
  onReimportHistory,
  onClose,
  onDismissCompletedPlan,
  restoreNotice,
  toolLoading,
  plan,
  flat = false,
  children,
}: {
  session: SessionSummary;
  active: boolean;
  bodyScrollSnapshot?: SessionCardScrollSnapshot;
  onBodyScroll: UIEventHandler<HTMLDivElement>;
  onFocus: (sessionId: string) => void;
  onRename: (session: SessionSummary) => void;
  onClear: (session: SessionSummary) => void;
  onReimportHistory: (session: SessionSummary) => void;
  onClose: (session: SessionSummary) => void;
  onDismissCompletedPlan?: (sessionId: string, planKey: string) => void;
  restoreNotice?: SessionRestoreNotice;
  toolLoading?: MissionToolLoadingState;
  plan?: AgentPlan | null;
  flat?: boolean;
  children: ReactNode;
}) {
  const statusTone = resolveSessionStatusTone(session.status);
  const [cardMenuOpen, setCardMenuOpen] = useState(false);
  const {
    bodyRef,
    showScrollToBottom,
    scrollToBottom,
    updateScrollToBottomVisibility,
  } = useSessionCardScrollControls();
  const [dismissedTransientPlan, setDismissedTransientPlan] = useState<{
    sessionId: string;
    planKey: string;
  } | null>(null);
  const planKey = plan ? createAgentPlanDismissalKey(plan) : null;
  const visiblePlan =
    plan &&
    !(
      !isAgentPlanComplete(plan) &&
      dismissedTransientPlan?.sessionId === session.id &&
      dismissedTransientPlan.planKey === planKey
    )
      ? plan
      : null;
  const hasFloatingPlan = Boolean(visiblePlan?.entries.length);
  const dismissPlan = useCallback(() => {
    if (!plan || !planKey) {
      return;
    }
    if (isAgentPlanComplete(plan)) {
      onDismissCompletedPlan?.(session.id, createAgentPlanDismissalKey(plan));
      return;
    }
    setDismissedTransientPlan({ sessionId: session.id, planKey });
  }, [onDismissCompletedPlan, plan, planKey, session.id]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    if (bodyScrollSnapshot) {
      body.scrollTop = Math.min(
        bodyScrollSnapshot.scrollTop,
        Math.max(body.scrollHeight - body.clientHeight, 0),
      );
      updateScrollToBottomVisibility(body);
      return;
    }
    body.scrollTop = Math.max(body.scrollHeight - body.clientHeight, 0);
    updateScrollToBottomVisibility(body);
  }, [bodyScrollSnapshot, updateScrollToBottomVisibility]);

  useLayoutEffect(() => {
    updateScrollToBottomVisibility();
  });

  return (
    <article
      onClick={() => onFocus(session.id)}
      data-active-session-card={active ? "true" : undefined}
      className={cn(
        "relative flex flex-col overflow-hidden [contain:layout_paint]",
        flat
          ? "h-full bg-surface"
          : cn(
              "h-full min-h-0 cursor-default rounded-[8px] border bg-surface transition-all",
              active ? "border-primary" : "border-border-ghost",
            ),
      )}
      style={
        flat
          ? undefined
          : {
              boxShadow: active ? "0 8px 20px rgb(0 0 0 / 0.18)" : undefined,
            }
      }
      aria-current={active ? "true" : undefined}
    >
      <div className="wb-pane-head">
        <AgentIcon name={session.agentName} size={14} />
        <span className="min-w-0 truncate text-section font-medium text-foreground">
          {session.title?.trim() || session.agentName}
        </span>
        <span
          className="min-w-0 shrink-[999] truncate font-mono text-2xs tabular text-muted-foreground"
          data-session-project-label="true"
        >
          {formatProjectWorktreeLabel(session.projectName, session.worktreeName)}
        </span>
        <div
          className="flex shrink-0 items-center gap-1"
          data-session-status-slot="true"
        >
          {restoreNotice ? <SessionRestoreNotice notice={restoreNotice} /> : null}
          {toolLoading ? (
            <MissionToolLoadingTitle {...toolLoading} />
          ) : restoreNotice ? null : (
            <SessionStatusPill status={session.status} />
          )}
        </div>
        <div className="min-w-0 flex-1" />
        <StatusDot tone={statusTone} />
        <div className="relative">
          <button
            type="button"
            className={cn(
              "grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground",
              cardMenuOpen && "bg-surface-sunken text-foreground",
            )}
            title="session 菜单"
            aria-haspopup="menu"
            aria-expanded={cardMenuOpen}
            onClick={(event) => {
              event.stopPropagation();
              setCardMenuOpen((current) => !current);
            }}
          >
            <Icon name="more" size={11} />
          </button>
          {cardMenuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+4px)] z-50 w-[160px] overflow-hidden rounded-[8px] py-1"
              style={{
                background: "var(--popover-glass)",
                backdropFilter: "blur(20px)",
                boxShadow: "inset 0 0 0 1px var(--border-ghost), 0 18px 38px rgb(0 0 0 / 0.32)",
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <MenuItem
                checked={active}
                icon="check"
                onClick={() => {
                  onFocus(session.id);
                  setCardMenuOpen(false);
                }}
              >
                聚焦会话
              </MenuItem>
              <MenuItem
                onClick={() => {
                  onRename(session);
                  setCardMenuOpen(false);
                }}
              >
                重命名
              </MenuItem>
              <MenuItem
                onClick={() => {
                  onReimportHistory(session);
                  setCardMenuOpen(false);
                }}
              >
                重新导入历史
              </MenuItem>
              <div className="mx-1 my-1 h-px bg-border-ghost" />
              <MenuItem
                tone="destructive"
                onClick={() => {
                  onClear(session);
                  setCardMenuOpen(false);
                }}
              >
                清理会话
              </MenuItem>
              <MenuItem
                tone="destructive"
                onClick={() => {
                  onClose(session);
                  setCardMenuOpen(false);
                }}
              >
                关闭窗口
              </MenuItem>
            </div>
          ) : null}
        </div>
        <button
          className="grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
          title="关闭此 session"
          onClick={(event) => {
            event.stopPropagation();
            onClose(session);
          }}
        >
          <Icon name="x" size={11} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1" data-session-scroll-frame={session.id}>
        <div
          ref={bodyRef}
          onScroll={(event) => {
            onBodyScroll(event);
            updateScrollToBottomVisibility(event.currentTarget);
          }}
          className={cn(
            "flex h-full min-h-0 flex-col gap-3 overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            flat ? "px-4 pb-9 pt-3" : "px-3 pb-9 pt-2.5",
          )}
          data-session-card-body={session.id}
        >
          <div className="space-y-3">{children}</div>
        </div>
      </div>
      <ScrollToBottomButton
        visible={showScrollToBottom}
        position={hasFloatingPlan ? "above-plan" : "bottom"}
        onClick={scrollToBottom}
      />
      {hasFloatingPlan ? (
        <div
          className="mission-plan-dock pointer-events-none absolute inset-x-2 bottom-2 z-20"
          data-plan-dock="session"
          data-plan-session-id={session.id}
        >
          <MissionPlanDrawer
            plan={visiblePlan}
            placement="floating"
            onDismiss={dismissPlan}
          />
        </div>
      ) : null}
    </article>
  );
}

export function SessionRestoreNotice({ notice }: { notice: SessionRestoreNotice }) {
  return (
    <span
      className="min-w-0 max-w-[min(34vw,360px)] truncate rounded-md border border-primary/30 bg-primary-soft/20 px-2 py-0.5 text-2xs font-medium text-foreground"
      data-session-restore-notice
      title={`${notice.title}：${notice.message}`}
    >
      {notice.title}
    </span>
  );
}

export function DraftSessionCard({
  draftWindow,
  active,
  agentOptions,
  onFocus,
  onSelectAgent,
  onClose,
}: {
  draftWindow: MissionDraftChatWindow;
  active: boolean;
  agentOptions: MissionDraftAgentOption[];
  onFocus?: (draftWindowId: string) => void;
  onSelectAgent?: (agentId: string) => void;
  onClose?: (draftWindowId: string) => void;
}) {
  const statusTone = draftWindow.status === "ready" ? "active" : "primary";
  const {
    bodyRef,
    showScrollToBottom,
    scrollToBottom,
    updateScrollToBottomVisibility,
  } = useSessionCardScrollControls();

  useLayoutEffect(() => {
    updateScrollToBottomVisibility();
  });

  return (
    <article
      onClick={() => onFocus?.(draftWindow.id)}
      data-draft-session-card={draftWindow.id}
      data-active-session-card={active ? "true" : undefined}
      className={cn(
        "relative flex h-full min-h-0 cursor-default flex-col overflow-hidden rounded-[8px] border bg-surface transition-all [contain:layout_paint]",
        active ? "border-primary" : "border-border-ghost",
      )}
      style={{
        boxShadow: active ? "0 8px 20px rgb(0 0 0 / 0.18)" : undefined,
      }}
      aria-current={active ? "true" : undefined}
    >
      <div className="wb-pane-head">
        <AgentIcon name={draftWindow.agentName ?? "ACP"} size={14} />
        <span className="truncate text-section font-medium text-foreground">{draftWindow.title}</span>
        <span className="shrink-0 font-mono text-2xs tabular text-muted-foreground">
          {formatProjectWorktreeLabel(draftWindow.projectName, draftWindow.worktreeName)}
        </span>
        <div className="flex-1" />
        <StatusDot tone={statusTone} pulse={draftWindow.status !== "ready"} />
        <button
          className="grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
          title="关闭此草稿窗口"
          onClick={(event) => {
            event.stopPropagation();
            onClose?.(draftWindow.id);
          }}
        >
          <Icon name="x" size={11} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1" data-session-scroll-frame={draftWindow.id}>
        <div
          ref={bodyRef}
          className="flex h-full min-h-0 flex-col gap-3 overflow-auto px-3 pb-9 pt-2.5"
          onScroll={(event) => updateScrollToBottomVisibility(event.currentTarget)}
        >
          <div className="space-y-2 rounded-lg border border-border-ghost bg-surface-sunken p-3 text-section text-muted-foreground">
            <strong className="block text-foreground">{draftWindow.agentName ? "准备创建会话" : "选择 ACP Agent"}</strong>
            <span>{draftWindow.message}</span>
            {!draftWindow.agentName ? (
              <div className="flex flex-wrap gap-2 pt-2" data-draft-agent-options>
                {agentOptions.length ? (
                  agentOptions.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      className="rounded-md border border-border-ghost bg-surface px-2.5 py-1 text-action font-medium text-foreground transition hover:border-primary/50 hover:bg-primary-soft/20 hover:text-primary"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectAgent?.(agent.id);
                      }}
                    >
                      {agent.name}
                    </button>
                  ))
                ) : (
                  <span className="text-meta text-muted-foreground">暂无可用 ACP Agent。</span>
                )}
              </div>
            ) : null}
          </div>
        </div>
        <ScrollToBottomButton
          visible={showScrollToBottom}
          onClick={scrollToBottom}
        />
      </div>
    </article>
  );
}

export function SessionPreviewMessages({ session, restoring = false }: { session: SessionSummary; restoring?: boolean }) {
  return (
    <div className="space-y-3 text-section leading-relaxed">
      <article>
        <header className="mb-1 flex items-center gap-1.5 font-mono text-2xs text-muted-foreground tabular">
          <span className="font-medium text-foreground">operator</span>
          <span>·</span>
          <span>{formatSessionPreviewTime(session.updatedAt)}</span>
        </header>
        <div className="wb-pane-sunken p-3 text-section leading-relaxed">
          {session.title?.trim() || "恢复这个任务"}
        </div>
      </article>
      <article>
        <header className="mb-1 flex items-center gap-1.5 font-mono text-2xs text-muted-foreground tabular">
          <AgentIcon name={session.agentName} size={11} />
          <span className="font-medium text-foreground">{session.agentName}</span>
          {session.model ? (
            <>
              <span>·</span>
              <span>{session.model}</span>
            </>
          ) : null}
          <span>·</span>
          <span>{restoring ? "restoring" : "idle"}</span>
          {restoring ? <StatusDot tone="primary" pulse size={5} /> : null}
        </header>
        <div className="space-y-2 text-section leading-relaxed text-muted-foreground">
          <p>{restoring ? "正在加载 ACP 信息流，恢复成功后会继续同步输出。" : "此任务的信息流已保留在并行卡片中，切换焦点不会丢失当前上下文。"}</p>
        </div>
      </article>
    </div>
  );
}

export function MenuItem({
  children,
  icon,
  onClick,
  checked,
  tone,
  kbd,
}: {
  children: ReactNode;
  icon?: ComponentProps<typeof Icon>["name"];
  onClick?: () => void;
  checked?: boolean;
  tone?: "destructive";
  kbd?: string;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex h-7 w-full items-center gap-2 px-2.5 text-left text-action transition-colors hover:bg-surface-sunken",
        tone === "destructive" && "text-destructive",
      )}
    >
      {icon ? <Icon name={icon} size={12} className={tone === "destructive" ? "" : "text-muted-foreground"} /> : null}
      <span className="flex-1 truncate">{children}</span>
      {checked != null ? <Icon name="check" size={11} className={checked ? "text-primary" : "opacity-0"} /> : null}
      {kbd ? <span className="font-mono text-2xs text-muted-foreground tabular">{kbd}</span> : null}
    </button>
  );
}
