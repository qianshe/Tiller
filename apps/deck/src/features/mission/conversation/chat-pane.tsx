import type {
  AgentPlan,
  AgentMessage,
  AgentToolCall,
  PermissionDecision,
  PermissionRequest,
  SessionPromptQueueSnapshot,
  SessionSummary,
  SessionTimelineEntry,
} from "@tiller/shared";
import type {
  CSSProperties,
  DragEvent,
  ReactNode,
  RefObject,
  UIEventHandler,
} from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UI_COPY, Locale } from "../../../shared/utils/copy";
import { MissionMessageTimeline } from "./message-timeline";
import { MissionPermissionDrawer } from "./permission-drawer";
import { MissionQueuedPrompts } from "./queued-prompts";
import type { MissionToolLoadingState } from "./tool-loading";
import { Icon } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import { buildParallelChatLayoutModel } from "./chat-pane-layout-model";
import { resolveSessionStreamContentLength, splitMissionToolCalls } from "./chat-pane-model";
import { resolveChatSessionToolLoading } from "./chat-session-state";
import {
  createAgentPlanDismissalKey,
  isAgentPlanComplete,
} from "./plan-drawer";
import {
  DraftSessionCard,
  MenuItem,
  SessionCard,
  SessionPreviewMessages,
  type MissionDraftAgentOption,
  type MissionDraftChatWindow,
  type SessionRestoreNotice,
} from "./session-cards";

type MissionChatPaneCopy = (typeof UI_COPY)[Locale];
type MissionToolActivity = MissionToolLoadingState["activity"];
type MissionProjectOption = {
  id: string;
  name: string;
};

// 距底部小于该像素阈值时视为"贴底"，流式与工具加载才自动跟随；超过则尊重用户上滑。
const STICK_TO_BOTTOM_THRESHOLD = 80;
const EMPTY_MESSAGES: AgentMessage[] = [];
const EMPTY_TIMELINE_ITEMS: SessionTimelineEntry[] = [];
const EMPTY_TOOL_CALLS: AgentToolCall[] = [];
const EMPTY_PENDING_APPROVALS: MissionPendingApproval[] = [];

type HistoryState = {
  hasMore: boolean;
  loading: boolean;
};

type MissionPendingApproval = {
  sessionId: string;
  request: PermissionRequest;
  resolving: boolean;
};

type MissionChatPaneProps = {
  className: string;
  style: CSSProperties;
  chatMainRef: RefObject<HTMLDivElement | null>;
  onChatMainScroll: UIEventHandler<HTMLDivElement>;
  helmConnected: boolean;
  activeSession: SessionSummary | null;
  openSessions: SessionSummary[];
  draftWindow?: MissionDraftChatWindow | null;
  draftAgentOptions?: MissionDraftAgentOption[];
  selectedWindowId?: string | null;
  selectedSessionId: string | null;
  activeSessionMessages: AgentMessage[];
  sessionMessagesById: Record<string, AgentMessage[] | undefined>;
  sessionTimelineById: Record<string, SessionTimelineEntry[] | undefined>;
  activeSessionPlan?: AgentPlan | null;
  sessionPlansById: Record<string, AgentPlan | undefined>;
  dismissedCompletedSessionPlanKeys?: Record<string, string | undefined>;
  activeSessionToolCalls: AgentToolCall[];
  sessionToolCallsById: Record<string, AgentToolCall[] | undefined>;
  copy: MissionChatPaneCopy;
  expandedMessageIds: ReadonlySet<string>;
  messageHistoryState: Record<string, HistoryState | undefined>;
  activityHistoryState: Record<string, HistoryState | undefined>;
  onLoadOlderMessages: (sessionId: string) => void;
  onToggleExpandedMessage: (messageId: string) => void;
  activityLoading: MissionToolActivity | null;
  pendingToolPresent: boolean;
  pendingApprovals: ReadonlyArray<{
    sessionId: string;
    request: PermissionRequest;
    resolving: boolean;
  }>;
  pendingToolTitle: string | null;
  showPermissionWorktree: boolean;
  displayCollapsed: boolean;
  inspectorCollapsed: boolean;
  sidebarCollapsed: boolean;
  showThinking: boolean;
  canToggleDisplay: boolean;
  projectOptions: MissionProjectOption[];
  onExpandSidebar: () => void;
  onToggleDisplay: () => void;
  onToggleInspector: () => void;
  onToggleThinking: () => void;
  onCreateTask: (projectId: string) => void;
  onFocusSession: (sessionId: string) => void;
  onSelectDraftWindow?: (draftWindowId: string) => void;
  onSelectDraftAgent?: (agentId: string) => void;
  onCloseDraftWindow?: (draftWindowId: string) => void;
  onSelectSessionView: (sessionId: string) => void;
  onRenameSession: (session: SessionSummary) => void;
  onCloseSessionView: (session: SessionSummary) => void;
  onClearSession: (session: SessionSummary) => void;
  onReimportSessionHistory: (session: SessionSummary) => void;
  onDismissCompletedSessionPlan?: (sessionId: string, planKey: string) => void;
  onRespondToPermission: (approvalRequestId: string, decision: PermissionDecision) => void;
  promptQueue?: SessionPromptQueueSnapshot;
  restoreNotice?: SessionRestoreNotice;
  onUpdateQueuedPrompt: (sessionId: string, queueItemId: string, text: string) => void;
  onDeleteQueuedPrompt: (sessionId: string, queueItemId: string) => void;
  children: ReactNode;
};

/**
 * Owns the mission conversation surface around timeline, permissions and composer.
 */
export function MissionChatPane({
  className,
  style,
  chatMainRef,
  onChatMainScroll,
  helmConnected,
  activeSession,
  draftWindow,
  draftAgentOptions = [],
  selectedWindowId,
  selectedSessionId,
  activeSessionMessages,
  sessionMessagesById,
  sessionTimelineById,
  activeSessionPlan,
  sessionPlansById,
  dismissedCompletedSessionPlanKeys = {},
  activeSessionToolCalls,
  sessionToolCallsById,
  copy,
  openSessions,
  expandedMessageIds,
  messageHistoryState,
  activityHistoryState,
  onLoadOlderMessages,
  onToggleExpandedMessage,
  activityLoading,
  pendingToolPresent,
  pendingApprovals,
  pendingToolTitle,
  showPermissionWorktree,
  displayCollapsed,
  inspectorCollapsed,
  sidebarCollapsed,
  showThinking,
  canToggleDisplay,
  projectOptions,
  onExpandSidebar,
  onToggleDisplay,
  onToggleInspector,
  onToggleThinking,
  onCreateTask,
  onFocusSession,
  onSelectDraftWindow,
  onSelectDraftAgent,
  onCloseDraftWindow,
  onSelectSessionView,
  onRenameSession,
  onCloseSessionView,
  onClearSession,
  onReimportSessionHistory,
  onDismissCompletedSessionPlan,
  onRespondToPermission,
  promptQueue,
  restoreNotice,
  onUpdateQueuedPrompt,
  onDeleteQueuedPrompt,
  children,
}: MissionChatPaneProps) {
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const sessionGridRef = useRef<HTMLDivElement | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [parallelGridSingleRow, setParallelGridSingleRow] = useState(false);
  const canCreateTask = projectOptions.length > 0;
  const activeSessionId = activeSession?.id ?? null;
  const handleSelectSessionView = useStableEvent(onSelectSessionView);
  const handleRenameSession = useStableEvent(onRenameSession);
  const handleCloseSessionView = useStableEvent(onCloseSessionView);
  const handleClearSession = useStableEvent(onClearSession);
  const handleReimportSessionHistory = useStableEvent(onReimportSessionHistory);
  const handleDismissCompletedSessionPlan = useStableEvent(
    (sessionId: string, planKey: string) =>
      onDismissCompletedSessionPlan?.(sessionId, planKey),
  );
  const handleRespondToPermission = useStableEvent(onRespondToPermission);
  const handleLoadOlderMessages = useStableEvent(onLoadOlderMessages);
  const handleToggleExpandedMessage = useStableEvent(onToggleExpandedMessage);
  const pendingApprovalsBySession = useMemo(() => {
    const next: Record<string, MissionPendingApproval[]> = {};
    pendingApprovals.forEach((approval) => {
      (next[approval.sessionId] ??= []).push(approval);
    });
    return next;
  }, [pendingApprovals]);
  const {
    isSingleSession,
    parallelGridFillsContainer,
    shouldLockChatMainScroll,
    shouldAnchorActiveParallelCard,
    parallelGridStyle,
  } = buildParallelChatLayoutModel({
    sessionCount: openSessions.length,
    hasDraftWindow: Boolean(draftWindow),
    singleRow: parallelGridSingleRow,
  });
  const singleSession = openSessions[0];
  const visibleSessionStreamCounts = openSessions
    .map((session) => `${session.id}:${sessionMessagesById[session.id]?.length ?? 0}:${sessionTimelineById[session.id]?.length ?? 0}:${sessionToolCallsById[session.id]?.length ?? 0}`)
    .join("|");
  const [dragOver, setDragOver] = useState(false);
  const sessionDragType = "application/x-tiller-session-id";
  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.types.includes(sessionDragType)) {
      event.preventDefault();
      setDragOver(true);
    }
  };
  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setDragOver(false);
    }
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const sessionId = event.dataTransfer.getData(sessionDragType);
    if (sessionId) {
      onFocusSession(sessionId);
    }
  };
  const handleChatMainScrollEvent: UIEventHandler<HTMLDivElement> = (event) => {
    if (shouldLockChatMainScroll) {
      if (event.currentTarget.scrollTop !== 0) {
        event.currentTarget.scrollTop = 0;
      }
      return;
    }
    onChatMainScroll(event);
  };

  useEffect(() => {
    const grid = sessionGridRef.current;
    const cardCount = openSessions.length + (draftWindow ? 1 : 0);
    if (!grid || cardCount <= 2) {
      setParallelGridSingleRow(false);
      return;
    }

    const updateSingleRowState = () => {
      const cards = Array.from(grid.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement,
      );
      const firstCard = cards[0];
      if (!firstCard) {
        setParallelGridSingleRow(false);
        return;
      }
      const firstTop = firstCard.offsetTop;
      setParallelGridSingleRow(
        cards.every((card) => Math.abs(card.offsetTop - firstTop) <= 1),
      );
    };

    updateSingleRowState();
    const ResizeObserverCtor = window.ResizeObserver;
    if (!ResizeObserverCtor) {
      window.addEventListener("resize", updateSingleRowState);
      return () => window.removeEventListener("resize", updateSingleRowState);
    }
    const observer = new ResizeObserverCtor(updateSingleRowState);
    observer.observe(grid);
    Array.from(grid.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [draftWindow, openSessions.length]);

  useEffect(() => {
    if (!menuOpen && !projectMenuOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
      if (projectMenuRef.current && !projectMenuRef.current.contains(event.target as Node)) {
        setProjectMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setProjectMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen, projectMenuOpen]);

  useEffect(() => {
    if (!shouldLockChatMainScroll) {
      return;
    }
    const resetChatMainScroll = () => {
      const chatMain = chatMainRef.current;
      if (chatMain) {
        chatMain.scrollTop = 0;
      }
    };
    resetChatMainScroll();
    const frame = window.requestAnimationFrame(resetChatMainScroll);
    const timeout = window.setTimeout(resetChatMainScroll, 180);
    const lateTimeout = window.setTimeout(resetChatMainScroll, 900);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      window.clearTimeout(lateTimeout);
    };
  }, [chatMainRef, openSessions.length, shouldLockChatMainScroll]);

  const sessionBodyScrollSnapshotRef = useRef<Record<string, { messageCount: number; toolCallCount: number; contentLength: number }>>({});
  const sessionBodyScrollPositionRef = useRef<Record<string, { scrollTop: number; scrollHeight: number }>>({});
  const sessionBodyStickToBottomRef = useRef<Record<string, boolean>>({});
  const recordSessionBodyScroll = useCallback((sessionId: string, body: HTMLDivElement) => {
    sessionBodyScrollPositionRef.current[sessionId] = {
      scrollTop: body.scrollTop,
      scrollHeight: body.scrollHeight,
    };
    sessionBodyStickToBottomRef.current[sessionId] =
      body.scrollHeight - body.scrollTop - body.clientHeight <= STICK_TO_BOTTOM_THRESHOLD;
  }, []);
  const draftCard = draftWindow ? (
    <DraftSessionCard
      draftWindow={draftWindow}
      active={selectedWindowId === draftWindow.id}
      agentOptions={draftAgentOptions}
      onFocus={onSelectDraftWindow}
      onSelectAgent={onSelectDraftAgent}
      onClose={onCloseDraftWindow}
    />
  ) : null;

  useEffect(() => {
    const chatMain = chatMainRef.current;
    if (!chatMain) {
      return;
    }
    const changedSessionIds: string[] = [];
    const nextSnapshot: Record<string, { messageCount: number; toolCallCount: number; contentLength: number }> = {};

    openSessions.forEach((session) => {
      const sessionMessages =
        sessionMessagesById[session.id] ??
        (session.id === activeSessionId ? activeSessionMessages : undefined);
      const sessionToolCalls =
        sessionToolCallsById[session.id] ??
        (session.id === activeSessionId ? activeSessionToolCalls : undefined);
      const timelineCount = sessionTimelineById[session.id]?.length ?? 0;
      const messageCount = sessionMessages?.length ?? 0;
      const toolCallCount = sessionToolCalls?.length ?? 0;
      const contentLength = resolveSessionStreamContentLength({
        messages: sessionMessages,
        timeline: sessionTimelineById[session.id],
        toolCalls: sessionToolCalls,
      });
      const previous = sessionBodyScrollSnapshotRef.current[session.id];
      nextSnapshot[session.id] = { messageCount: Math.max(messageCount, timelineCount), toolCallCount, contentLength };
      if (!previous) {
        if (messageCount > 0 || timelineCount > 0 || toolCallCount > 0) {
          changedSessionIds.push(session.id);
        }
        return;
      }
      if (
        previous.messageCount !== Math.max(messageCount, timelineCount) ||
        previous.toolCallCount !== toolCallCount ||
        previous.contentLength !== contentLength
      ) {
        changedSessionIds.push(session.id);
      }
    });

    sessionBodyScrollSnapshotRef.current = nextSnapshot;
    if (!changedSessionIds.length) {
      return;
    }

    const scrollChangedBodies = () => {
      changedSessionIds.forEach((sessionId) => {
        const body = chatMain.querySelector<HTMLElement>(`[data-session-card-body="${CSS.escape(sessionId)}"]`);
        if (!body) {
          return;
        }
        // 仅当用户当前贴底（未手动上滑）时才跟随到最新内容。
        if (sessionBodyStickToBottomRef.current[sessionId] === false) {
          return;
        }
        body.scrollTop = body.scrollHeight;
        sessionBodyScrollPositionRef.current[sessionId] = {
          scrollTop: body.scrollTop,
          scrollHeight: body.scrollHeight,
        };
        sessionBodyStickToBottomRef.current[sessionId] = true;
      });
    };

    scrollChangedBodies();
    const frame = window.requestAnimationFrame(scrollChangedBodies);
    const timeout = window.setTimeout(scrollChangedBodies, 180);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [activeSessionId, activeSessionMessages, activeSessionToolCalls, chatMainRef, openSessions, sessionMessagesById, sessionTimelineById, sessionToolCallsById, visibleSessionStreamCounts]);

  useEffect(() => {
    if (!shouldAnchorActiveParallelCard || !activeSessionId) {
      return;
    }
    const anchorActiveCard = () => {
      const chatMain = chatMainRef.current;
      const activeCard = chatMain?.querySelector<HTMLElement>('[data-active-session-card="true"]');
      if (!chatMain || !activeCard) {
        return;
      }
      const chatMainRect = chatMain.getBoundingClientRect();
      const activeCardRect = activeCard.getBoundingClientRect();
      const cardFullyVisible =
        activeCardRect.top >= chatMainRect.top &&
        activeCardRect.bottom <= chatMainRect.bottom;
      if (cardFullyVisible) {
        return;
      }
      chatMain.scrollTop += activeCardRect.top - chatMainRect.top;
    };
    const frame = window.requestAnimationFrame(anchorActiveCard);
    const timeout = window.setTimeout(anchorActiveCard, 160);
    const lateTimeout = window.setTimeout(anchorActiveCard, 800);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      window.clearTimeout(lateTimeout);
    };
  }, [activeSessionId, chatMainRef, openSessions.length, shouldAnchorActiveParallelCard]);

  return (
    <div className={className} style={style} data-mission-mobile-pane="chat" data-testid="mission-chat-pane">
      <div className="wb-pane-head" style={{ background: "var(--surface)" }}>
        {sidebarCollapsed ? (
          <button
            type="button"
            className="grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground"
            onClick={onExpandSidebar}
            aria-label="展开任务导航"
            title="展开任务导航"
          >
            <Icon name="panel" size={12} />
          </button>
        ) : null}
        <span className="wb-pane-head-eyebrow">工作台</span>
        <span className="ml-1 font-mono text-meta text-muted-foreground tabular">
          {openSessions.length ? `${openSessions.length} 会话` : "0 会话"}
        </span>
        <div className="flex-1" />
        <div ref={projectMenuRef} className="relative">
          <button
            type="button"
            onClick={() => {
              setProjectMenuOpen((current) => !current);
              setMenuOpen(false);
            }}
            disabled={!canCreateTask}
            className={cn(
              "grid h-6 w-6 place-items-center rounded transition-colors",
              projectMenuOpen
                ? "bg-surface-emphasis text-foreground"
                : canCreateTask
                  ? "text-muted-foreground hover:bg-surface-sunken hover:text-primary"
                  : "cursor-not-allowed text-muted-foreground/35",
            )}
            aria-haspopup="menu"
            aria-expanded={projectMenuOpen}
            aria-label="新建任务"
            title={canCreateTask ? "选择项目创建任务" : "没有可用项目"}
          >
            <Icon name="plus" size={12} />
          </button>
          {projectMenuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+4px)] z-50 w-[220px] overflow-hidden rounded-[8px] py-1"
              style={{
                background: "var(--popover-glass)",
                backdropFilter: "blur(20px)",
                boxShadow: "inset 0 0 0 1px var(--border-ghost), 0 18px 38px rgb(0 0 0 / 0.32)",
                animation: "sb-pop 180ms cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            >
              {projectOptions.map((project) => (
                <MenuItem
                  key={project.id}
                  icon="folder"
                  onClick={() => {
                    onCreateTask(project.id);
                    setProjectMenuOpen(false);
                  }}
                >
                  {project.name}
                </MenuItem>
              ))}
            </div>
          ) : null}
        </div>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            className={cn(
              "grid h-6 w-6 place-items-center rounded transition-colors",
              menuOpen ? "bg-surface-emphasis text-foreground" : "text-muted-foreground hover:bg-surface-sunken hover:text-foreground",
            )}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="更多任务操作"
            title="更多"
          >
            <Icon name="more" size={12} />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-[calc(100%+4px)] z-50 w-[200px] overflow-hidden rounded-[8px] py-1"
              style={{
                background: "var(--popover-glass)",
                backdropFilter: "blur(20px)",
                boxShadow: "inset 0 0 0 1px var(--border-ghost), 0 18px 38px rgb(0 0 0 / 0.32)",
                animation: "sb-pop 180ms cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            >
              <MenuItem
                checked={!displayCollapsed}
                disabled={!canToggleDisplay}
                icon="terminal"
                onClick={() => {
                  if (!canToggleDisplay) {
                    return;
                  }
                  onToggleDisplay();
                  setMenuOpen(false);
                }}
              >
                展示栏
              </MenuItem>
              <MenuItem
                checked={!inspectorCollapsed}
                icon="inspect"
                onClick={() => {
                  onToggleInspector();
                  setMenuOpen(false);
                }}
              >
                Inspector 面板
              </MenuItem>
              <MenuItem
                checked={showThinking}
                icon="activity"
                onClick={() => {
                  onToggleThinking();
                  setMenuOpen(false);
                }}
              >
                Thinking
              </MenuItem>
            </div>
          ) : null}
        </div>
      </div>
      <div
        className={cn(
          "chat-main flex-1 w-full overflow-x-hidden min-h-0 relative [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          shouldLockChatMainScroll ? "overflow-y-clip" : "overflow-y-auto",
        )}
        ref={chatMainRef}
        onScroll={handleChatMainScrollEvent}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          boxShadow: dragOver ? "inset 0 0 0 2px var(--primary)" : "none",
          transition: "box-shadow 120ms",
        }}
      >
        {!helmConnected ? (
          <div className="mission-session-feedback note-box compact-note m-2 rounded border border-warning/30 bg-warning/10 p-3 text-section text-foreground">
            <strong className="text-section font-semibold">Helm 未连接</strong>{" "}
            <p className="mt-1 text-meta text-muted-foreground">
              任务页会继续展示本地缓存；连接 Helm 后即可刷新项目、任务与文件。
            </p>{" "}
          </div>
        ) : null}{" "}
        {openSessions.length || draftCard ? (
          isSingleSession && singleSession && !draftCard ? (
            <MissionChatSessionCard
              session={singleSession}
              active={singleSession.id === selectedSessionId}
              flat
              isRuntimeActive={singleSession.id === activeSessionId}
              sessionMessages={
                sessionMessagesById[singleSession.id] ??
                (singleSession.id === activeSessionId ? activeSessionMessages : EMPTY_MESSAGES)
              }
              timelineItems={sessionTimelineById[singleSession.id] ?? EMPTY_TIMELINE_ITEMS}
              sessionToolCalls={
                sessionToolCallsById[singleSession.id] ??
                (singleSession.id === activeSessionId ? activeSessionToolCalls : EMPTY_TOOL_CALLS)
              }
              pendingApprovals={pendingApprovalsBySession[singleSession.id] ?? EMPTY_PENDING_APPROVALS}
              messageHistoryState={messageHistoryState[singleSession.id]}
              activityHistoryState={activityHistoryState[singleSession.id]}
              bodyScrollSnapshot={sessionBodyScrollPositionRef.current[singleSession.id]}
              onBodyScroll={recordSessionBodyScroll}
              onFocus={handleSelectSessionView}
              onRename={handleRenameSession}
              onClear={handleClearSession}
              onReimportHistory={handleReimportSessionHistory}
              onClose={handleCloseSessionView}
              onDismissCompletedPlan={handleDismissCompletedSessionPlan}
              restoreNotice={singleSession.id === selectedSessionId ? restoreNotice : undefined}
              plan={
                sessionPlansById[singleSession.id] ??
                (singleSession.id === activeSessionId ? activeSessionPlan : null)
              }
              promptQueue={singleSession.id === activeSessionId ? promptQueue : undefined}
              dismissedCompletedPlanKey={dismissedCompletedSessionPlanKeys[singleSession.id]}
              activityLoading={singleSession.id === activeSessionId ? activityLoading : null}
              pendingToolPresent={singleSession.id === activeSessionId ? pendingToolPresent : false}
              pendingToolTitle={
                pendingApprovalsBySession[singleSession.id]?.length ? pendingToolTitle : null
              }
              copy={copy}
              expandedMessageIds={expandedMessageIds}
              showThinking={showThinking}
              showPermissionWorktree={showPermissionWorktree}
              onLoadOlderMessages={handleLoadOlderMessages}
              onToggleExpandedMessage={handleToggleExpandedMessage}
              onUpdateQueuedPrompt={onUpdateQueuedPrompt}
              onDeleteQueuedPrompt={onDeleteQueuedPrompt}
              onRespondToPermission={handleRespondToPermission}
            />
          ) : (
            <div
              ref={sessionGridRef}
              className={cn(
                "mission-session-grid grid box-border gap-2 p-2",
                parallelGridFillsContainer ? "h-full min-h-0 overflow-hidden" : "min-h-full",
              )}
              style={parallelGridStyle}
            >
              {draftCard}
              {openSessions.map((session) => (
                <MissionChatSessionCard
                  key={session.id}
                  session={session}
                  active={session.id === selectedSessionId}
                  isRuntimeActive={session.id === activeSessionId}
                  sessionMessages={
                    sessionMessagesById[session.id] ??
                    (session.id === activeSessionId ? activeSessionMessages : EMPTY_MESSAGES)
                  }
                  timelineItems={sessionTimelineById[session.id] ?? EMPTY_TIMELINE_ITEMS}
                  sessionToolCalls={
                    sessionToolCallsById[session.id] ??
                    (session.id === activeSessionId ? activeSessionToolCalls : EMPTY_TOOL_CALLS)
                  }
                  pendingApprovals={pendingApprovalsBySession[session.id] ?? EMPTY_PENDING_APPROVALS}
                  messageHistoryState={messageHistoryState[session.id]}
                  activityHistoryState={activityHistoryState[session.id]}
                  bodyScrollSnapshot={sessionBodyScrollPositionRef.current[session.id]}
                  onBodyScroll={recordSessionBodyScroll}
                  onFocus={handleSelectSessionView}
                  onRename={handleRenameSession}
                  onClear={handleClearSession}
                  onReimportHistory={handleReimportSessionHistory}
                  onClose={handleCloseSessionView}
                  onDismissCompletedPlan={handleDismissCompletedSessionPlan}
                  restoreNotice={session.id === selectedSessionId ? restoreNotice : undefined}
                  plan={
                    sessionPlansById[session.id] ??
                    (session.id === activeSessionId ? activeSessionPlan : null)
                  }
                  promptQueue={session.id === activeSessionId ? promptQueue : undefined}
                  dismissedCompletedPlanKey={dismissedCompletedSessionPlanKeys[session.id]}
                  activityLoading={session.id === activeSessionId ? activityLoading : null}
                  pendingToolPresent={session.id === activeSessionId ? pendingToolPresent : false}
                  pendingToolTitle={
                    pendingApprovalsBySession[session.id]?.length ? pendingToolTitle : null
                  }
                  copy={copy}
                  expandedMessageIds={expandedMessageIds}
                  showThinking={showThinking}
                  showPermissionWorktree={showPermissionWorktree}
                  onLoadOlderMessages={handleLoadOlderMessages}
                  onToggleExpandedMessage={handleToggleExpandedMessage}
                  onUpdateQueuedPrompt={onUpdateQueuedPrompt}
                  onDeleteQueuedPrompt={onDeleteQueuedPrompt}
                  onRespondToPermission={handleRespondToPermission}
                />
              ))}
            </div>
          )
        ) : null}{" "}
      </div>{" "}
      {children}
    </div>
  );
}

type MissionChatSessionCardProps = {
  active: boolean;
  activityHistoryState?: HistoryState;
  activityLoading: MissionToolActivity | null;
  bodyScrollSnapshot?: { scrollTop: number; scrollHeight: number };
  copy: MissionChatPaneCopy;
  dismissedCompletedPlanKey?: string;
  expandedMessageIds: ReadonlySet<string>;
  flat?: boolean;
  isRuntimeActive: boolean;
  messageHistoryState?: HistoryState;
  onBodyScroll: (sessionId: string, body: HTMLDivElement) => void;
  onClear: (session: SessionSummary) => void;
  onClose: (session: SessionSummary) => void;
  onDismissCompletedPlan: (sessionId: string, planKey: string) => void;
  onFocus: (sessionId: string) => void;
  onLoadOlderMessages: (sessionId: string) => void;
  onReimportHistory: (session: SessionSummary) => void;
  onRename: (session: SessionSummary) => void;
  onRespondToPermission: (approvalRequestId: string, decision: PermissionDecision) => void;
  onToggleExpandedMessage: (messageId: string) => void;
  onUpdateQueuedPrompt: (sessionId: string, queueItemId: string, text: string) => void;
  onDeleteQueuedPrompt: (sessionId: string, queueItemId: string) => void;
  pendingApprovals: ReadonlyArray<MissionPendingApproval>;
  pendingToolPresent: boolean;
  pendingToolTitle: string | null;
  plan?: AgentPlan | null;
  promptQueue?: SessionPromptQueueSnapshot;
  restoreNotice?: SessionRestoreNotice;
  session: SessionSummary;
  sessionMessages: AgentMessage[];
  sessionToolCalls: AgentToolCall[];
  showPermissionWorktree: boolean;
  showThinking: boolean;
  timelineItems: SessionTimelineEntry[];
};

const MissionChatSessionCard = memo(function MissionChatSessionCard({
  active,
  activityHistoryState,
  activityLoading,
  bodyScrollSnapshot,
  copy,
  dismissedCompletedPlanKey,
  expandedMessageIds,
  flat = false,
  isRuntimeActive,
  messageHistoryState,
  onBodyScroll,
  onClear,
  onClose,
  onDismissCompletedPlan,
  onFocus,
  onLoadOlderMessages,
  onReimportHistory,
  onRename,
  onRespondToPermission,
  onToggleExpandedMessage,
  onUpdateQueuedPrompt,
  onDeleteQueuedPrompt,
  pendingApprovals,
  pendingToolPresent,
  pendingToolTitle,
  plan,
  promptQueue,
  restoreNotice,
  session,
  sessionMessages,
  sessionToolCalls,
  showPermissionWorktree,
  showThinking,
  timelineItems,
}: MissionChatSessionCardProps) {
  const sessionTimeline = useMemo(
    () => splitMissionToolCalls(sessionToolCalls),
    [sessionToolCalls],
  );
  const historyStateBySession = useMemo(
    () => ({ [session.id]: messageHistoryState }),
    [messageHistoryState, session.id],
  );
  const activityHistoryStateBySession = useMemo(
    () => ({ [session.id]: activityHistoryState }),
    [activityHistoryState, session.id],
  );
  const handleBodyScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    (event) => onBodyScroll(session.id, event.currentTarget),
    [onBodyScroll, session.id],
  );
  const visiblePlan =
    plan &&
    !(
      isAgentPlanComplete(plan) &&
      dismissedCompletedPlanKey === createAgentPlanDismissalKey(plan)
    )
      ? plan
      : null;
  const toolLoading = resolveChatSessionToolLoading(session, {
    activeSessionId: isRuntimeActive ? session.id : null,
    activeSessionMessages: sessionMessages,
    activeSessionToolCalls: sessionToolCalls,
    sessionMessagesById: { [session.id]: sessionMessages },
    sessionToolCallsById: { [session.id]: sessionToolCalls },
    activityLoading,
    pendingToolPresent,
    pendingApprovals,
  });
  const approvalStack = pendingApprovals.length > 0 ? (
    <div className="mission-approval-stack grid gap-2">
      {pendingApprovals.map((approval) => (
        <MissionPermissionDrawer
          key={approval.request.id}
          request={approval.request}
          copy={copy}
          showWorktree={showPermissionWorktree}
          fallbackToolTitle={pendingToolTitle}
          resolving={approval.resolving}
          onRespond={(decision) => onRespondToPermission(approval.request.id, decision)}
        />
      ))}
    </div>
  ) : null;
  const promptQueuePanel = promptQueue?.queued.length ? (
    <MissionQueuedPrompts
      queue={promptQueue}
      placement="floating"
      onUpdate={onUpdateQueuedPrompt}
      onDelete={onDeleteQueuedPrompt}
    />
  ) : null;

  return (
    <SessionCard
      session={session}
      active={active}
      bodyScrollSnapshot={bodyScrollSnapshot}
      onBodyScroll={handleBodyScroll}
      onFocus={onFocus}
      onRename={onRename}
      onClear={onClear}
      onReimportHistory={onReimportHistory}
      onClose={onClose}
      onDismissCompletedPlan={onDismissCompletedPlan}
      restoreNotice={restoreNotice}
      toolLoading={toolLoading}
      plan={visiblePlan}
      promptQueuePanel={promptQueuePanel}
      blockingOverlay={approvalStack}
      flat={flat}
    >
      {sessionMessages.length || timelineItems.length ? (
        <MissionMessageTimeline
          items={sessionMessages}
          timelineItems={timelineItems}
          thinkingToolCalls={sessionTimeline.thinkingToolCalls}
          toolCalls={sessionTimeline.timelineToolCalls}
          showThinking={showThinking}
          boundaryTimestamps={sessionTimeline.boundaryTimestamps}
          sessionId={session.id}
          assistantLabel={session.agentName}
          copy={copy}
          expandedMessageIds={expandedMessageIds}
          historyStateBySession={historyStateBySession}
          activityHistoryStateBySession={activityHistoryStateBySession}
          onLoadOlderMessages={onLoadOlderMessages}
          onToggleExpandedMessage={onToggleExpandedMessage}
        />
      ) : (
        <SessionPreviewMessages session={session} restoring={isRuntimeActive} />
      )}
    </SessionCard>
  );
});

function useStableEvent<T extends (...args: any[]) => unknown>(handler: T): T {
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);
  return useCallback(((...args: Parameters<T>) => handlerRef.current(...args)) as T, []);
}
