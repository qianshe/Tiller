import type {
  AgentPlan,
  AgentMessage,
  AgentToolCall,
  LegacyEvidenceSource,
  MissionPromptContextItem,
  PermissionDecision,
  PermissionRequest,
  SessionPromptQueueSnapshot,
  SessionSubagentDetail,
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
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SquarePen } from "lucide-react";
import type { UI_COPY, Locale } from "../../../shared/utils/copy";
import { useDeckStore, type SessionLegacyEvidenceState } from "../../../store";
import { MissionMessageTimeline } from "./message-timeline";
import { LegacyEvidencePanel } from "./legacy-evidence-panel";
import { MissionPermissionDrawer } from "./permission-drawer";
import { MissionQueuedPrompts } from "./queued-prompts";
import { MissionOnboardingEmpty } from "./onboarding-empty";
import type { MissionToolLoadingState } from "./tool-loading";
import { Icon } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import {
  buildParallelChatLayoutModel,
  resolveParallelGridSingleRow,
} from "./chat-pane-layout-model";
import {
  hasSessionBodyScrollSnapshotChanged,
  pruneSessionCardScrollState,
  resolveSessionBodyStickToBottom,
  resolveSessionConversationDisplayMode,
  resolveSessionStreamContentLength,
  shouldAutoScrollSessionBody,
  splitMissionToolCalls,
} from "./chat-pane-model";
import { deriveToolCallsFromTimeline } from "../utils/timeline-activity";
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
const PLAIN_HISTORY_REVEAL_LOCK_DATASET_KEY = "plainHistoryRevealLock";
const EMPTY_MESSAGES: AgentMessage[] = [];
const EMPTY_TIMELINE_ITEMS: SessionTimelineEntry[] = [];
const EMPTY_TOOL_CALLS: AgentToolCall[] = [];
const EMPTY_PENDING_APPROVALS: MissionPendingApproval[] = [];

function isPlainHistoryRevealLocked(body: HTMLElement | null) {
  return body?.dataset[PLAIN_HISTORY_REVEAL_LOCK_DATASET_KEY] === "true";
}

type HistoryState = {
  hasMore: boolean;
  loading: boolean;
};

type SessionBodyScrollSnapshot = {
  messageCount: number;
  toolCallCount: number;
  contentLength: number;
  historyLoading: boolean;
};

type MissionPendingApproval = {
  sessionId: string;
  request: PermissionRequest;
  resolving: boolean;
};

type MissionChatPaneProps = {
  className: string;
  style: CSSProperties;
  isMissionMobile: boolean;
  hideWorkspaceHeader?: boolean;
  hideSessionCloseAction?: boolean;
  isPaneResizing?: boolean;
  paneResizeVersion?: number;
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
  sessionLegacyEvidenceById: Record<string, SessionLegacyEvidenceState | undefined>;
  activeSessionPlan?: AgentPlan | null;
  sessionPlansById: Record<string, AgentPlan | undefined>;
  dismissedCompletedSessionPlanKeys?: Record<string, string | undefined>;
  activeSessionToolCalls: AgentToolCall[];
  sessionToolCallsById: Record<string, AgentToolCall[] | undefined>;
  copy: MissionChatPaneCopy;
  canHandoffAssistantMessage?: boolean;
  assistantHandoffBusy?: boolean;
  onHandoffAssistantMessage?: (
    session: SessionSummary,
    assistantBlockText: string,
    sessionMessages: AgentMessage[],
  ) => void;
  expandedMessageIds: ReadonlySet<string>;
  messageHistoryState: Record<string, HistoryState | undefined>;
  onLoadOlderMessages: (sessionId: string) => void;
  onLoadLegacyEvidence: (sessionId: string, source: LegacyEvidenceSource, after?: string) => void;
  onToggleExpandedMessage: (messageId: string) => void;
  onAddDraftContext?: (item: MissionPromptContextItem) => void;
  subagentDetails?: Record<string, SessionSubagentDetail | undefined>;
  onToggleSubagentDetail?: (sessionId: string, parentToolCallId: string, open: boolean) => void;
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
  hasAgents?: boolean;
  hasProjects?: boolean;
  onNavigateAgents?: (tab: "agents" | "projects") => void;
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
  onDismissCompletedSessionPlan?: (sessionId: string, planKey: string) => void;
  onRespondToPermission: (approvalRequestId: string, decision: PermissionDecision) => void;
  promptQueue?: SessionPromptQueueSnapshot;
  sessionPromptQueuesById?: Record<string, SessionPromptQueueSnapshot | undefined>;
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
  isMissionMobile,
  hideWorkspaceHeader = false,
  hideSessionCloseAction = false,
  isPaneResizing = false,
  paneResizeVersion = 0,
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
  sessionLegacyEvidenceById = {},
  activeSessionPlan,
  sessionPlansById,
  dismissedCompletedSessionPlanKeys = {},
  activeSessionToolCalls,
  sessionToolCallsById,
  copy,
  canHandoffAssistantMessage = false,
  assistantHandoffBusy = false,
  onHandoffAssistantMessage,
  openSessions,
  expandedMessageIds,
  messageHistoryState,
  onLoadOlderMessages,
  onLoadLegacyEvidence,
  onToggleExpandedMessage,
  onAddDraftContext,
  subagentDetails = {},
  onToggleSubagentDetail,
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
  hasAgents = false,
  hasProjects = false,
  onNavigateAgents = () => undefined,
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
  onDismissCompletedSessionPlan,
  onRespondToPermission,
  promptQueue,
  sessionPromptQueuesById = {},
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
  const canCreateTaskDirectly = projectOptions.length === 1;
  const activeSessionId = activeSession?.id ?? null;
  const messageHistoryStateRef = useRef(messageHistoryState);
  const handleSelectSessionView = useStableEvent(onSelectSessionView);
  const handleRenameSession = useStableEvent(onRenameSession);
  const handleCloseSessionView = useStableEvent(onCloseSessionView);
  const handleClearSession = useStableEvent(onClearSession);
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
    .map((session) =>
      `${session.id}:${sessionMessagesById[session.id]?.length ?? 0}:${sessionTimelineById[session.id]?.length ?? 0}:${sessionToolCallsById[session.id]?.length ?? 0}`
    )
    .join("|");
  const observedSessionIdsKey = openSessions.map((session) => session.id).join("\u0000");
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
    messageHistoryStateRef.current = messageHistoryState;
  }, [messageHistoryState]);

  useEffect(() => {
    const grid = sessionGridRef.current;
    const cardCount = openSessions.length + (draftWindow ? 1 : 0);
    if (!grid || cardCount <= 2) {
      setParallelGridSingleRow(false);
      return;
    }
    if (isPaneResizing) {
      return;
    }

    // 只依据 grid 内容宽度推导(resolveParallelGridSingleRow),不读卡片
    // offsetTop:单行判定改变 gridAutoRows 后不会反过来影响宽度判据,
    // 从结构上杜绝测量↔布局的反馈回路;也因此无需再观察每张子卡片。
    const applySingleRowFromWidth = (gridContentWidth: number) => {
      setParallelGridSingleRow(
        resolveParallelGridSingleRow({ gridContentWidth, cardCount }),
      );
    };
    const readContentWidth = () => {
      const styles = window.getComputedStyle(grid);
      return (
        grid.clientWidth -
        (Number.parseFloat(styles.paddingLeft) || 0) -
        (Number.parseFloat(styles.paddingRight) || 0)
      );
    };
    const ResizeObserverCtor = window.ResizeObserver;
    if (!ResizeObserverCtor) {
      const handleWindowResize = () => applySingleRowFromWidth(readContentWidth());
      handleWindowResize();
      window.addEventListener("resize", handleWindowResize);
      return () => window.removeEventListener("resize", handleWindowResize);
    }
    const observer = new ResizeObserverCtor((entries) => {
      const entry = entries[entries.length - 1];
      applySingleRowFromWidth(entry?.contentRect.width ?? readContentWidth());
    });
    // observe() 会立即触发一次回调,无需手动初始化测量。
    observer.observe(grid);
    return () => observer.disconnect();
  }, [draftWindow, isPaneResizing, openSessions.length, paneResizeVersion]);

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

  const sessionBodyScrollSnapshotRef = useRef<Record<string, SessionBodyScrollSnapshot>>({});
  const sessionBodyScrollPositionRef = useRef<Record<string, { scrollTop: number; scrollHeight: number }>>({});
  const sessionBodyStickToBottomRef = useRef<Record<string, boolean>>({});
  const sessionBodyInitialScrollRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const openSessionIds = openSessions.map((session) => session.id);
    sessionBodyScrollSnapshotRef.current = pruneSessionCardScrollState(
      sessionBodyScrollSnapshotRef.current,
      openSessionIds,
    );
    sessionBodyScrollPositionRef.current = pruneSessionCardScrollState(
      sessionBodyScrollPositionRef.current,
      openSessionIds,
    );
    sessionBodyStickToBottomRef.current = pruneSessionCardScrollState(
      sessionBodyStickToBottomRef.current,
      openSessionIds,
    );
    sessionBodyInitialScrollRef.current = pruneSessionCardScrollState(
      sessionBodyInitialScrollRef.current,
      openSessionIds,
    );
  }, [openSessions]);
  const recordSessionBodyScroll = useCallback((sessionId: string, body: HTMLDivElement) => {
    if (isPlainHistoryRevealLocked(body)) {
      return;
    }
    const previous = sessionBodyScrollPositionRef.current[sessionId];
    sessionBodyScrollPositionRef.current[sessionId] = {
      scrollTop: body.scrollTop,
      scrollHeight: body.scrollHeight,
    };
    sessionBodyStickToBottomRef.current[sessionId] = resolveSessionBodyStickToBottom({
      current: body,
      previous,
      previousStickToBottom: sessionBodyStickToBottomRef.current[sessionId],
      threshold: STICK_TO_BOTTOM_THRESHOLD,
    });
  }, []);
  const scrollSessionBodiesToBottom = useCallback((
    sessionIds: readonly string[],
    nextSnapshot: Record<string, SessionBodyScrollSnapshot>,
    previousSnapshot: Record<string, SessionBodyScrollSnapshot> = {},
  ) => {
    const chatMain = chatMainRef.current;
    if (!chatMain) {
      return;
    }
    sessionIds.forEach((sessionId) => {
      const body = chatMain.querySelector<HTMLElement>(`[data-session-card-body="${CSS.escape(sessionId)}"]`);
      if (!body) {
        return;
      }
      const current = nextSnapshot[sessionId];
      const previous = previousSnapshot[sessionId];
      const allowAfterInitialHistoryLoad = Boolean(
        previous?.historyLoading &&
        !current?.historyLoading &&
        (previous.messageCount ?? 0) === 0 &&
        (previous.toolCallCount ?? 0) === 0 &&
        (previous.contentLength ?? 0) === 0 &&
        (
          (current?.messageCount ?? 0) > 0 ||
          (current?.toolCallCount ?? 0) > 0 ||
          (current?.contentLength ?? 0) > 0
        ),
      );
      const forceInitialScroll = Boolean(
        !sessionBodyInitialScrollRef.current[sessionId] &&
        !current?.historyLoading &&
        (
          (current?.messageCount ?? 0) > 0 ||
          (current?.toolCallCount ?? 0) > 0 ||
          (current?.contentLength ?? 0) > 0
        ),
      );
      if (!shouldAutoScrollSessionBody({
        stickToBottom: sessionBodyStickToBottomRef.current[sessionId],
        forceInitialScroll,
        historyLoading: current?.historyLoading,
        historyRevealLocked: isPlainHistoryRevealLocked(body),
        previousHistoryLoading: previous?.historyLoading,
        allowAfterInitialHistoryLoad,
      })) {
        return;
      }
      body.scrollTop = body.scrollHeight;
      sessionBodyScrollPositionRef.current[sessionId] = {
        scrollTop: body.scrollTop,
        scrollHeight: body.scrollHeight,
      };
      sessionBodyStickToBottomRef.current[sessionId] = true;
      if (forceInitialScroll) {
        sessionBodyInitialScrollRef.current[sessionId] = true;
      }
    });
  }, [chatMainRef]);
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
  const projectCreateMenu = projectOptions.length > 1 ? (
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
  ) : null;
  const handleCreateTaskFromEmptyState = () => {
    if (!canCreateTask) {
      return;
    }
    if (canCreateTaskDirectly) {
      onCreateTask(projectOptions[0]!.id);
      setProjectMenuOpen(false);
      return;
    }
    setProjectMenuOpen((current) => !current);
    setMenuOpen(false);
  };

  useLayoutEffect(() => {
    const chatMain = chatMainRef.current;
    if (!chatMain) {
      return;
    }
    const changedSessionIds: string[] = [];
    const previousSnapshot = sessionBodyScrollSnapshotRef.current;
    const nextSnapshot: Record<string, SessionBodyScrollSnapshot> = {};

    openSessions.forEach((session) => {
      const sessionTimelineItems = sessionTimelineById[session.id];
      const sessionMessages =
        sessionMessagesById[session.id] ??
        (session.id === activeSessionId ? activeSessionMessages : undefined);
      const sessionToolCalls =
        sessionToolCallsById[session.id] ??
        (session.id === activeSessionId ? activeSessionToolCalls : undefined) ??
        deriveToolCallsFromTimeline(sessionTimelineItems);
      const timelineCount = sessionTimelineItems?.length ?? 0;
      const messageCount = sessionMessages?.length ?? 0;
      const toolCallCount = sessionToolCalls?.length ?? 0;
      const historyLoading = Boolean(messageHistoryState[session.id]?.loading);
      const contentLength = resolveSessionStreamContentLength({
        messages: sessionMessages,
        timeline: sessionTimelineItems,
        toolCalls: sessionToolCalls,
      });
      const previous = previousSnapshot[session.id];
      const current: SessionBodyScrollSnapshot = {
        messageCount: Math.max(messageCount, timelineCount),
        toolCallCount,
        contentLength,
        historyLoading,
      };
      nextSnapshot[session.id] = current;
      if (!previous) {
        if (messageCount > 0 || timelineCount > 0 || toolCallCount > 0) {
          changedSessionIds.push(session.id);
        }
        return;
      }
      if (hasSessionBodyScrollSnapshotChanged(previous, current)) {
        changedSessionIds.push(session.id);
      }
    });

    sessionBodyScrollSnapshotRef.current = nextSnapshot;
    if (isPaneResizing || !changedSessionIds.length) {
      return;
    }

    const scrollChangedBodies = () => {
      scrollSessionBodiesToBottom(changedSessionIds, nextSnapshot, previousSnapshot);
    };

    scrollChangedBodies();
    const frame = window.requestAnimationFrame(scrollChangedBodies);
    const timeout = window.setTimeout(scrollChangedBodies, 180);
    const lateTimeout = window.setTimeout(scrollChangedBodies, 900);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      window.clearTimeout(lateTimeout);
    };
  }, [activeSessionId, activeSessionMessages, activeSessionToolCalls, chatMainRef, isPaneResizing, messageHistoryState, openSessions, scrollSessionBodiesToBottom, sessionMessagesById, sessionTimelineById, sessionToolCallsById, visibleSessionStreamCounts]);

  useEffect(() => {
    if (isPaneResizing || paneResizeVersion === 0 || openSessions.length === 0) {
      return;
    }
    const reconcileBodyScroll = () => {
      scrollSessionBodiesToBottom(
        openSessions.map((session) => session.id),
        sessionBodyScrollSnapshotRef.current,
      );
    };
    reconcileBodyScroll();
    const frame = window.requestAnimationFrame(reconcileBodyScroll);
    const timeout = window.setTimeout(reconcileBodyScroll, 160);
    const lateTimeout = window.setTimeout(reconcileBodyScroll, 800);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      window.clearTimeout(lateTimeout);
    };
  }, [isPaneResizing, openSessions, paneResizeVersion, scrollSessionBodiesToBottom]);

  useEffect(() => {
    if (isPaneResizing || !shouldAnchorActiveParallelCard || !activeSessionId) {
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
  }, [activeSessionId, chatMainRef, isPaneResizing, openSessions.length, paneResizeVersion, shouldAnchorActiveParallelCard]);

  useEffect(() => {
    const chatMain = chatMainRef.current;
    const ResizeObserverCtor = window.ResizeObserver;
    const MutationObserverCtor = window.MutationObserver;
    if (!chatMain || (!ResizeObserverCtor && !MutationObserverCtor) || isPaneResizing) {
      return;
    }
    const followSessionBody = (sessionId: string) => {
      if (isPaneResizing) {
        return;
      }
      const body = chatMain.querySelector<HTMLElement>(`[data-session-card-body="${CSS.escape(sessionId)}"]`);
      if (!body) {
        return;
      }
      const historyLoading = Boolean(messageHistoryStateRef.current[sessionId]?.loading);
      if (!shouldAutoScrollSessionBody({
        stickToBottom: sessionBodyStickToBottomRef.current[sessionId],
        historyLoading,
        historyRevealLocked: isPlainHistoryRevealLocked(body),
      })) {
        return;
      }
      body.scrollTop = body.scrollHeight;
      sessionBodyScrollPositionRef.current[sessionId] = {
        scrollTop: body.scrollTop,
        scrollHeight: body.scrollHeight,
      };
      sessionBodyStickToBottomRef.current[sessionId] = true;
    };
    const resizeObserver = ResizeObserverCtor
      ? new ResizeObserverCtor((entries) => {
          for (const entry of entries) {
            const content = entry.target;
            if (!(content instanceof HTMLElement)) {
              continue;
            }
            const sessionId = content.dataset.sessionCardContent;
            if (sessionId) {
              followSessionBody(sessionId);
            }
          }
        })
      : null;
    const mutationObserver = MutationObserverCtor
      ? new MutationObserverCtor((records) => {
          const changedSessionIds = new Set<string>();
          for (const record of records) {
            const target = record.target instanceof HTMLElement
              ? record.target
              : record.target.parentElement;
            const content = target?.closest<HTMLElement>("[data-session-card-content]");
            const sessionId = content?.dataset.sessionCardContent;
            if (sessionId) {
              changedSessionIds.add(sessionId);
            }
          }
          changedSessionIds.forEach(followSessionBody);
        })
      : null;
    const observedSessionIds = observedSessionIdsKey
      ? observedSessionIdsKey.split("\u0000")
      : [];
    observedSessionIds.forEach((sessionId) => {
      const content = chatMain.querySelector<HTMLElement>(`[data-session-card-content="${CSS.escape(sessionId)}"]`);
      if (content) {
        resizeObserver?.observe(content);
        mutationObserver?.observe(content, {
          characterData: true,
          childList: true,
          subtree: true,
        });
      }
    });
    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [chatMainRef, isPaneResizing, observedSessionIdsKey, paneResizeVersion]);

  return (
    <div className={className} style={style} data-mission-mobile-pane="chat" data-testid="mission-chat-pane">
      {!isMissionMobile && !hideWorkspaceHeader ? (
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
              onClick={handleCreateTaskFromEmptyState}
              disabled={!canCreateTask}
              className={cn(
                "grid h-6 w-6 place-items-center rounded transition-colors",
                projectMenuOpen
                  ? "bg-surface-emphasis text-foreground"
                  : canCreateTask
                    ? "text-muted-foreground hover:bg-surface-sunken hover:text-primary"
                    : "cursor-not-allowed text-muted-foreground/35",
              )}
              aria-haspopup={canCreateTaskDirectly ? undefined : "menu"}
              aria-expanded={canCreateTaskDirectly ? undefined : projectMenuOpen}
              aria-label="新建任务"
              title={
                !canCreateTask
                  ? "没有可用项目"
                  : canCreateTaskDirectly
                    ? "在当前项目中新建会话"
                    : "选择项目创建会话"
              }
            >
              <SquarePen size={12} strokeWidth={1.75} />
            </button>
            {projectMenuOpen ? projectCreateMenu : null}
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
      ) : null}
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
            <div
              ref={sessionGridRef}
              className={cn(
                "mission-session-grid grid box-border",
                openSessions.length === 1 && !draftCard ? "" : "gap-2 p-2",
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
                  flat={openSessions.length === 1 && !draftCard}
                  isRuntimeActive={session.id === activeSessionId}
                  sessionMessages={
                    sessionMessagesById[session.id] ??
                    (session.id === activeSessionId ? activeSessionMessages : EMPTY_MESSAGES)
                  }
                  timelineItems={sessionTimelineById[session.id] ?? EMPTY_TIMELINE_ITEMS}
                  legacyEvidenceState={sessionLegacyEvidenceById[session.id]}
                  sessionToolCalls={
                    sessionToolCallsById[session.id] ??
                    (session.id === activeSessionId ? activeSessionToolCalls : EMPTY_TOOL_CALLS)
                  }
                  pendingApprovals={pendingApprovalsBySession[session.id] ?? EMPTY_PENDING_APPROVALS}
                  messageHistoryState={messageHistoryState[session.id]}
                  bodyScrollSnapshot={sessionBodyScrollPositionRef.current[session.id]}
                  onBodyScroll={recordSessionBodyScroll}
                  onFocus={handleSelectSessionView}
                  onRename={handleRenameSession}
                  onClear={handleClearSession}
                  onClose={handleCloseSessionView}
                  onDismissCompletedPlan={handleDismissCompletedSessionPlan}
                  restoreNotice={session.id === selectedSessionId ? restoreNotice : undefined}
                  plan={
                    sessionPlansById[session.id] ??
                    (session.id === activeSessionId ? activeSessionPlan : null)
                  }
                  promptQueue={
                    sessionPromptQueuesById[session.id] ??
                    (session.id === activeSessionId ? promptQueue : undefined)
                  }
                  dismissedCompletedPlanKey={dismissedCompletedSessionPlanKeys[session.id]}
                  activityLoading={session.id === activeSessionId ? activityLoading : null}
                  pendingToolPresent={session.id === activeSessionId ? pendingToolPresent : false}
                  pendingToolTitle={
                    pendingApprovalsBySession[session.id]?.length ? pendingToolTitle : null
                  }
                  copy={copy}
                  canHandoffAssistantMessage={canHandoffAssistantMessage}
                  assistantHandoffBusy={assistantHandoffBusy}
                  onHandoffAssistantMessage={onHandoffAssistantMessage}
                  expandedMessageIds={expandedMessageIds}
                  showThinking={showThinking}
                  showPermissionWorktree={showPermissionWorktree}
                  onLoadOlderMessages={handleLoadOlderMessages}
                  onLoadLegacyEvidence={onLoadLegacyEvidence}
                  onToggleExpandedMessage={handleToggleExpandedMessage}
                  onAddDraftContext={onAddDraftContext}
                  subagentDetails={subagentDetails}
                  onToggleSubagentDetail={onToggleSubagentDetail}
                  onUpdateQueuedPrompt={onUpdateQueuedPrompt}
                  onDeleteQueuedPrompt={onDeleteQueuedPrompt}
                  onRespondToPermission={handleRespondToPermission}
                  showThinkingToggle={isMissionMobile || hideWorkspaceHeader}
                  onToggleThinking={onToggleThinking}
                  showCreateTaskAction={isMissionMobile && !hideWorkspaceHeader}
                  hideSessionCloseAction={hideSessionCloseAction}
                  onCreateTask={onCreateTask}
                />
              ))}
            </div>
        ) : isMissionMobile ? (
          <div className="flex min-h-full items-center justify-center px-6 py-10">
            <div ref={projectMenuRef} className="relative">
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition",
                  canCreateTask
                    ? "border-primary/30 bg-primary-soft/15 text-primary hover:border-primary/50 hover:bg-primary-soft/25"
                    : "cursor-not-allowed border-border-ghost bg-surface-sunken text-muted-foreground/60",
                )}
                disabled={!canCreateTask}
                aria-haspopup={canCreateTaskDirectly ? undefined : "menu"}
                aria-expanded={canCreateTaskDirectly ? undefined : projectMenuOpen}
                aria-label="新建会话"
                title={
                  !canCreateTask
                    ? "没有可用项目"
                    : canCreateTaskDirectly
                      ? "在当前项目中新建会话"
                      : "选择项目创建会话"
                }
                onClick={handleCreateTaskFromEmptyState}
              >
                <Icon name="plus" size={14} />
                <span>新建会话</span>
              </button>
              {projectMenuOpen ? projectCreateMenu : null}
            </div>
          </div>
        ) : (
          <div className="flex min-h-full items-center justify-center px-6 py-10">
            <MissionOnboardingEmpty
              helmConnected={helmConnected}
              hasAgents={hasAgents}
              hasProjects={hasProjects}
              onNavigateAgents={onNavigateAgents}
            />
          </div>
        )}{" "}
      </div>{" "}
      {children}
    </div>
  );
}

type MissionChatSessionCardProps = {
  active: boolean;
  activityLoading: MissionToolActivity | null;
  bodyScrollSnapshot?: { scrollTop: number; scrollHeight: number };
  canHandoffAssistantMessage?: boolean;
  assistantHandoffBusy?: boolean;
  copy: MissionChatPaneCopy;
  dismissedCompletedPlanKey?: string;
  expandedMessageIds: ReadonlySet<string>;
  flat?: boolean;
  isRuntimeActive: boolean;
  legacyEvidenceState: SessionLegacyEvidenceState | undefined;
  messageHistoryState?: HistoryState;
  onBodyScroll: (sessionId: string, body: HTMLDivElement) => void;
  onClear: (session: SessionSummary) => void;
  onClose: (session: SessionSummary) => void;
  onCreateTask: (projectId: string) => void;
  onDismissCompletedPlan: (sessionId: string, planKey: string) => void;
  onFocus: (sessionId: string) => void;
  onLoadOlderMessages: (sessionId: string) => void;
  onLoadLegacyEvidence: (sessionId: string, source: LegacyEvidenceSource, after?: string) => void;
  onRename: (session: SessionSummary) => void;
  onRespondToPermission: (approvalRequestId: string, decision: PermissionDecision) => void;
  onToggleExpandedMessage: (messageId: string) => void;
  onAddDraftContext?: (item: MissionPromptContextItem) => void;
  subagentDetails?: Record<string, SessionSubagentDetail | undefined>;
  onToggleSubagentDetail?: (sessionId: string, parentToolCallId: string, open: boolean) => void;
  onUpdateQueuedPrompt: (sessionId: string, queueItemId: string, text: string) => void;
  onDeleteQueuedPrompt: (sessionId: string, queueItemId: string) => void;
  onHandoffAssistantMessage?: (
    session: SessionSummary,
    assistantBlockText: string,
    sessionMessages: AgentMessage[],
  ) => void;
  onToggleThinking: () => void;
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
  showThinkingToggle: boolean;
  showCreateTaskAction: boolean;
  hideSessionCloseAction: boolean;
  timelineItems: SessionTimelineEntry[];
};

const MissionChatSessionCard = memo(function MissionChatSessionCard({
  active,
  activityLoading,
  bodyScrollSnapshot,
  canHandoffAssistantMessage = false,
  assistantHandoffBusy = false,
  copy,
  dismissedCompletedPlanKey,
  expandedMessageIds,
  flat = false,
  isRuntimeActive,
  legacyEvidenceState,
  messageHistoryState,
  onBodyScroll,
  onClear,
  onClose,
  onCreateTask,
  onDismissCompletedPlan,
  onFocus,
  onLoadOlderMessages,
  onLoadLegacyEvidence,
  onRename,
  onRespondToPermission,
  onToggleExpandedMessage,
  onAddDraftContext,
  subagentDetails,
  onToggleSubagentDetail,
  onUpdateQueuedPrompt,
  onDeleteQueuedPrompt,
  onHandoffAssistantMessage,
  onToggleThinking,
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
  showThinkingToggle,
  showCreateTaskAction,
  hideSessionCloseAction,
  timelineItems,
}: MissionChatSessionCardProps) {
  const sessionTimeline = useMemo(
    () => splitMissionToolCalls(sessionToolCalls, timelineItems),
    [sessionToolCalls, timelineItems],
  );
  const historyStateBySession = useMemo(
    () => ({ [session.id]: messageHistoryState }),
    [messageHistoryState, session.id],
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
  const conversationDisplayMode = resolveSessionConversationDisplayMode({
    sessionId: session.id,
    sessionMessages,
    sessionStatus: session.status,
    timelineItemsLength: timelineItems.length,
  });
  const hasSessionContent = conversationDisplayMode === "conversation";

  return (
    <SessionCard
      session={session}
      active={active}
      bodyScrollSnapshot={bodyScrollSnapshot}
      onBodyScroll={handleBodyScroll}
      onFocus={onFocus}
      onRename={onRename}
      onClear={onClear}
      onClose={onClose}
      onCreateTask={onCreateTask}
      onDismissCompletedPlan={onDismissCompletedPlan}
      restoreNotice={restoreNotice}
      toolLoading={toolLoading}
      plan={visiblePlan}
      promptQueuePanel={promptQueuePanel}
      blockingOverlay={approvalStack}
      flat={flat}
      reserveFloatingDockSpace={hasSessionContent}
      showThinkingToggle={showThinkingToggle}
      showThinking={showThinking}
      onToggleThinking={onToggleThinking}
      showCreateTaskAction={showCreateTaskAction}
      hideCloseAction={hideSessionCloseAction}
    >
      {hasSessionContent ? (
        <MissionMessageTimeline
          items={sessionMessages}
          timelineItems={timelineItems}
          toolCalls={sessionTimeline.timelineToolCalls}
          showThinking={showThinking}
          boundaryTimestamps={sessionTimeline.boundaryTimestamps}
          sessionId={session.id}
          copy={copy}
          canHandoffAssistantMessage={canHandoffAssistantMessage}
          assistantHandoffBusy={assistantHandoffBusy}
          onHandoffAssistantMessage={(assistantBlockText) =>
            onHandoffAssistantMessage?.(
              session,
              assistantBlockText,
              sessionMessages,
            )
          }
          expandedMessageIds={expandedMessageIds}
          historyStateBySession={historyStateBySession}
          onLoadOlderMessages={onLoadOlderMessages}
          onToggleExpandedMessage={onToggleExpandedMessage}
          onAddDraftContext={onAddDraftContext}
          subagentDetails={subagentDetails}
          onToggleSubagentDetail={onToggleSubagentDetail}
        />
      ) : (
        <SessionPreviewMessages
          session={session}
          restoring={isRuntimeActive}
          historyLoading={conversationDisplayMode === "history-loading"}
        />
      )}
      <LegacyEvidencePanel
        state={legacyEvidenceState}
        onLoad={(source, after) => onLoadLegacyEvidence(session.id, source, after)}
      />
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
