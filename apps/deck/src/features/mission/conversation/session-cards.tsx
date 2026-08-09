import type { ComponentProps, ReactNode, UIEventHandler } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentPlan, SessionSummary } from "@tiller/shared";
import {
  Icon,
  AgentIcon,
  StatusDot,
} from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import {
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

type SessionDockPanel = "promptQueue" | "plan";

const SCROLL_TO_BOTTOM_THRESHOLD = 80;
const SESSION_BODY_BOTTOM_PADDING = "20px";
const PLAN_DOCK_BODY_PADDING = "48px";
const TABBED_DOCK_BODY_PADDING = "72px";
const PROMPT_QUEUE_DOCK_BODY_PADDING = PLAN_DOCK_BODY_PADDING;

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
  position?: "bottom" | "dock-top";
  onClick: () => void;
}) {
  if (!visible) {
    return null;
  }

  return (
    <button
      type="button"
      className={cn(
        "pointer-events-auto absolute z-30 grid h-7 w-7 place-items-center rounded-full border border-border-ghost bg-surface/95 text-muted-foreground shadow-ambient backdrop-blur transition hover:border-primary/50 hover:bg-surface-emphasis hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        position === "dock-top" ? "-top-8 right-1" : "bottom-3 right-3",
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
  const showScrollToBottomRef = useRef(false);
  const setScrollToBottomVisible = useCallback((next: boolean) => {
    if (showScrollToBottomRef.current === next) {
      return;
    }
    showScrollToBottomRef.current = next;
    setShowScrollToBottom(next);
  }, []);
  const updateScrollToBottomVisibility = useCallback((body = bodyRef.current) => {
    if (!body) {
      setScrollToBottomVisible(false);
      return;
    }
    const next = shouldShowSessionScrollToBottom({
      scrollHeight: body.scrollHeight,
      scrollTop: body.scrollTop,
      clientHeight: body.clientHeight,
    });
    setScrollToBottomVisible(next);
  }, [setScrollToBottomVisible]);
  const scrollToBottom = useCallback(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    // 直接滚动到底部，简单可靠
    body.scrollTop = body.scrollHeight;
    setScrollToBottomVisible(false);
  }, [setScrollToBottomVisible]);

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
  onClose,
  onCreateTask,
  onDismissCompletedPlan,
  restoreNotice,
  toolLoading,
  plan,
  promptQueuePanel,
  blockingOverlay,
  flat = false,
  reserveFloatingDockSpace = false,
  showThinkingToggle = false,
  showThinking,
  onToggleThinking,
  showCreateTaskAction,
  hideCloseAction = false,
  children,
}: {
  session: SessionSummary;
  active: boolean;
  bodyScrollSnapshot?: SessionCardScrollSnapshot;
  onBodyScroll: UIEventHandler<HTMLDivElement>;
  onFocus: (sessionId: string) => void;
  onRename: (session: SessionSummary) => void;
  onClear: (session: SessionSummary) => void;
  onClose: (session: SessionSummary) => void;
  onCreateTask?: (projectId: string) => void;
  onDismissCompletedPlan?: (sessionId: string, planKey: string) => void;
  restoreNotice?: SessionRestoreNotice;
  toolLoading?: MissionToolLoadingState;
  plan?: AgentPlan | null;
  promptQueuePanel?: ReactNode;
  blockingOverlay?: ReactNode;
  flat?: boolean;
  reserveFloatingDockSpace?: boolean;
  showThinkingToggle?: boolean;
  showThinking?: boolean;
  onToggleThinking?: () => void;
  showCreateTaskAction?: boolean;
  hideCloseAction?: boolean;
  children: ReactNode;
}) {
  const statusTone = resolveSessionStatusTone(session.status);
  const [cardMenuOpen, setCardMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
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
  const lastAutoFocusedPlanKeyRef = useRef<string | null>(null);
  const showCreateTaskButton = Boolean(showCreateTaskAction && onCreateTask);
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
  const hasPromptQueueDock = Boolean(promptQueuePanel);
  const hasPlanDock = Boolean(visiblePlan?.entries.length);
  const [dockPanelPreference, setDockPanelPreference] = useState<SessionDockPanel | null>(() =>
    hasPromptQueueDock && hasPlanDock ? "plan" : null,
  );
  const hasFloatingDock = hasPromptQueueDock || hasPlanDock;
  const activeDockPanel: SessionDockPanel | null = hasPromptQueueDock
    ? dockPanelPreference === "plan" && hasPlanDock
      ? "plan"
      : "promptQueue"
    : hasPlanDock
      ? "plan"
      : null;
  const hasDockTabs = hasPromptQueueDock && hasPlanDock;
  const noDockBottomPaddingClass = reserveFloatingDockSpace ? "pb-0" : "pb-8";
  const bodyBottomPaddingClass = hasFloatingDock ? "pb-16" : noDockBottomPaddingClass;
  const floatingDockPadding =
    hasDockTabs
      ? TABBED_DOCK_BODY_PADDING
      : activeDockPanel === "promptQueue"
      ? PROMPT_QUEUE_DOCK_BODY_PADDING
      : activeDockPanel === "plan"
        ? PLAN_DOCK_BODY_PADDING
        : undefined;
  const bottomSpacerHeight = reserveFloatingDockSpace
    ? floatingDockPadding ?? SESSION_BODY_BOTTOM_PADDING
    : undefined;
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

  useEffect(() => {
    if (plan && isAgentPlanComplete(plan) && onDismissCompletedPlan) {
      const timer = setTimeout(() => {
        onDismissCompletedPlan(session.id, createAgentPlanDismissalKey(plan));
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [plan, onDismissCompletedPlan, session.id]);

  useEffect(() => {
    if (
      (dockPanelPreference === "promptQueue" && !hasPromptQueueDock) ||
      (dockPanelPreference === "plan" && !hasPlanDock)
    ) {
      setDockPanelPreference(null);
    }
  }, [dockPanelPreference, hasPlanDock, hasPromptQueueDock]);

  useEffect(() => {
    if (!hasPlanDock || !hasPromptQueueDock || !planKey) {
      lastAutoFocusedPlanKeyRef.current = null;
      return;
    }
    if (lastAutoFocusedPlanKeyRef.current === planKey) {
      return;
    }
    lastAutoFocusedPlanKeyRef.current = planKey;
    setDockPanelPreference("plan");
  }, [hasPlanDock, hasPromptQueueDock, planKey]);

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
    } else {
      body.scrollTop = Math.max(body.scrollHeight - body.clientHeight, 0);
    }
    updateScrollToBottomVisibility(body);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: restore scroll position once; ongoing scroll is managed by the parent effect + onScroll handler
  }, []);

  useLayoutEffect(() => {
    updateScrollToBottomVisibility();
  }, [hasFloatingDock, updateScrollToBottomVisibility]);

  useEffect(() => {
    if (!cardMenuOpen) {
      return;
    }
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && menuContainerRef.current?.contains(target)) {
        return;
      }
      setCardMenuOpen(false);
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
    };
  }, [cardMenuOpen]);

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
        <div className="flex shrink-0 items-center gap-1" data-session-status-slot="true">
          {restoreNotice ? <SessionRestoreNotice notice={restoreNotice} /> : null}
          {toolLoading ? (
            <MissionToolLoadingTitle {...toolLoading} />
          ) : restoreNotice ? null : (
            <SessionStatusPill status={session.status} />
          )}
        </div>
        <div className="min-w-0 flex-1" />
        <div
          className={cn(
            "flex h-7 shrink-0 items-center gap-1",
            hideCloseAction && "rounded-md border border-border-ghost bg-surface-sunken px-0.5 py-0.5",
          )}
          data-slot="session-card-actions"
        >
        {hideCloseAction ? null : <StatusDot tone={statusTone} />}
        <div ref={menuContainerRef} className="relative">
          <button
            type="button"
            className={cn(
              "grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground",
              hideCloseAction && "h-6 w-6",
              cardMenuOpen && "bg-surface-sunken text-foreground",
            )}
            title="更多会话操作"
            aria-label="更多会话操作"
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
                onClick={() => {
                  onRename(session);
                  setCardMenuOpen(false);
                }}
              >
                重命名
              </MenuItem>
              {showThinkingToggle && onToggleThinking ? (
                <MenuItem
                  checked={showThinking}
                  icon="activity"
                  onClick={() => {
                    onToggleThinking();
                    setCardMenuOpen(false);
                  }}
                >
                  Thinking
                </MenuItem>
              ) : null}
              <MenuItem
                tone="destructive"
                onClick={() => {
                  onClear(session);
                  setCardMenuOpen(false);
                }}
              >
                清理会话
              </MenuItem>
              {!hideCloseAction ? (
                <MenuItem
                  tone="destructive"
                  onClick={() => {
                    onClose(session);
                    setCardMenuOpen(false);
                  }}
                >
                  关闭窗口
                </MenuItem>
              ) : null}
            </div>
          ) : null}
        </div>
        {showCreateTaskButton ? (
          <button
            className="grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-primary-soft/20 hover:text-primary"
            title="当前项目下新建会话"
            aria-label="当前项目下新建会话"
            onClick={(event) => {
              event.stopPropagation();
              onCreateTask?.(session.projectId);
            }}
          >
            <Icon name="plus" size={11} />
          </button>
        ) : hideCloseAction ? null : (
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
        )}
        </div>
      </div>
      <div className="relative min-h-0 flex-1" data-session-scroll-frame={session.id}>
        <div
          ref={bodyRef}
          onScroll={(event) => {
            onBodyScroll(event);
            updateScrollToBottomVisibility(event.currentTarget);
          }}
          className={cn(
            "flex h-full min-h-0 flex-col gap-3 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            flat
              ? cn("px-4 pt-3", bodyBottomPaddingClass)
              : cn("px-2.5 pt-2.5", bodyBottomPaddingClass),
          )}
          style={floatingDockPadding ? { paddingBottom: floatingDockPadding } : undefined}
          data-session-card-body={session.id}
        >
          <div className="flex min-h-full flex-col space-y-3" data-session-card-content={session.id}>
            {children}
            {bottomSpacerHeight ? (
              <div
                aria-hidden="true"
                className="shrink-0"
                style={{ height: bottomSpacerHeight }}
                data-session-bottom-spacer={session.id}
                data-session-floating-dock-spacer={floatingDockPadding ? session.id : undefined}
              />
            ) : null}
          </div>
        </div>
      </div>
      {blockingOverlay ? (
        <div
          className="pointer-events-none absolute inset-x-3 top-1/2 z-30 -translate-y-1/2"
          data-session-blocking-overlay={session.id}
        >
          <div className="pointer-events-auto mx-auto max-h-[min(60vh,calc(100vh_-_8rem))] max-w-[min(100%,640px)] overflow-y-auto">
            {blockingOverlay}
          </div>
        </div>
      ) : null}
      {!hasFloatingDock ? (
        <ScrollToBottomButton
          visible={showScrollToBottom}
          position="bottom"
          onClick={scrollToBottom}
        />
      ) : null}
      {activeDockPanel ? (
        <div
          className="mission-plan-dock pointer-events-none absolute inset-x-2 bottom-2 z-20"
          data-plan-dock="session"
          data-plan-session-id={session.id}
        >
          <ScrollToBottomButton
            visible={showScrollToBottom}
            position="dock-top"
            onClick={scrollToBottom}
          />
          {hasPromptQueueDock && hasPlanDock ? (
            <div
              className="pointer-events-auto mb-1 flex w-fit max-w-full items-center gap-0.5 rounded-md border border-border-ghost bg-surface/95 p-0.5 text-2xs"
              data-session-dock-tabs
            >
              <button
                type="button"
                className={cn(
                  "rounded px-2 py-1 font-medium transition-colors",
                  activeDockPanel === "promptQueue"
                    ? "bg-primary-soft/30 text-primary"
                    : "text-muted-foreground hover:bg-surface-sunken hover:text-foreground",
                )}
                data-session-dock-option="prompt-queue"
                aria-pressed={activeDockPanel === "promptQueue"}
                onClick={(event) => {
                  event.stopPropagation();
                  setDockPanelPreference("promptQueue");
                }}
              >
                Prompt 队列
              </button>
              <button
                type="button"
                className={cn(
                  "rounded px-2 py-1 font-medium transition-colors",
                  activeDockPanel === "plan"
                    ? "bg-primary-soft/30 text-primary"
                    : "text-muted-foreground hover:bg-surface-sunken hover:text-foreground",
                )}
                data-session-dock-option="plan"
                aria-pressed={activeDockPanel === "plan"}
                onClick={(event) => {
                  event.stopPropagation();
                  setDockPanelPreference("plan");
                }}
              >
                Plan
              </button>
            </div>
          ) : null}
          {activeDockPanel === "promptQueue" ? promptQueuePanel : null}
          {activeDockPanel === "plan" ? (
            <MissionPlanDrawer
              plan={visiblePlan}
              placement="floating"
              onDismiss={dismissPlan}
            />
          ) : null}
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
          className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto overflow-x-hidden px-2.5 pb-9 pt-2.5"
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

export function SessionPreviewMessages({
  session,
  restoring = false,
  historyLoading = false,
}: {
  session: SessionSummary;
  restoring?: boolean;
  historyLoading?: boolean;
}) {
  const sessionTitle = session.title?.trim();

  if (restoring) {
    return (
      <div
        className="flex min-h-full flex-1 items-center justify-center px-6 py-10 text-center"
        data-session-preview-state="restoring"
      >
        <div className="mx-auto grid max-w-sm gap-3">
          <div className="mx-auto grid size-9 place-items-center rounded-full border border-primary/30 bg-primary-soft/20 text-primary">
            <StatusDot tone="primary" pulse size={8} />
          </div>
          <div className="grid gap-1">
            <p className="text-section font-semibold text-foreground">正在恢复任务</p>
            <p className="text-meta leading-5 text-muted-foreground">
              正在重连 {session.agentName} 并同步历史消息，恢复后会继续显示最新输出。
            </p>
          </div>
          {sessionTitle ? (
            <div className="mx-auto max-w-full truncate rounded-md border border-border-ghost bg-surface-sunken px-3 py-2 text-meta text-foreground">
              {sessionTitle}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (historyLoading) {
    return (
      <div
        className="flex min-h-full flex-1 items-center justify-center px-6 py-10 text-center"
        data-session-preview-state="history-loading"
      >
        <div className="mx-auto grid max-w-sm gap-3">
          <div className="mx-auto grid size-9 place-items-center rounded-full border border-primary/20 bg-primary-soft/10 text-primary">
            <StatusDot tone="primary" pulse size={8} />
          </div>
          <div className="grid gap-1">
            <p className="text-section font-semibold text-foreground">正在加载历史消息</p>
            <p className="text-meta leading-5 text-muted-foreground">
              正在同步此任务的时间线历史，加载后会按统一消息顺序显示。
            </p>
          </div>
          {sessionTitle ? (
            <div className="mx-auto max-w-full truncate rounded-md border border-border-ghost bg-surface-sunken px-3 py-2 text-meta text-foreground">
              {sessionTitle}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-full flex-1 items-center justify-center px-6 py-10 text-center"
      data-session-preview-state="idle"
    >
      <div className="mx-auto grid max-w-sm gap-3">
        <div className="mx-auto flex items-center gap-2 rounded-full border border-border-ghost bg-surface-sunken px-3 py-1 font-mono text-2xs text-muted-foreground tabular">
          <AgentIcon name={session.agentName} size={11} />
          <span className="font-medium text-foreground">{session.agentName}</span>
          {session.model ? (
            <>
              <span>·</span>
              <span>{session.model}</span>
            </>
          ) : null}
        </div>
        <div className="grid gap-1">
          <p className="text-section font-semibold text-foreground">
            {sessionTitle || "恢复这个任务"}
          </p>
          <p className="text-meta leading-5 text-muted-foreground">
            此任务的信息流已保留在并行卡片中，切换焦点不会丢失当前上下文。
          </p>
        </div>
      </div>
    </div>
  );
}

export function MenuItem({
  children,
  icon,
  onClick,
  checked,
  disabled,
  tone,
  kbd,
}: {
  children: ReactNode;
  icon?: ComponentProps<typeof Icon>["name"];
  onClick?: () => void;
  checked?: boolean;
  disabled?: boolean;
  tone?: "destructive";
  kbd?: string;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-7 w-full items-center gap-2 px-2.5 text-left text-action transition-colors",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:bg-surface-sunken",
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
