import type {
  AgentMessage,
  AgentToolCall,
  PermissionDecision,
  PermissionRequest,
  SessionPromptQueueSnapshot,
  SessionSummary,
} from "@tiller/shared";
import type {
  ComponentProps,
  CSSProperties,
  DragEvent,
  ReactNode,
  RefObject,
  UIEventHandler,
} from "react";
import { useEffect, useRef, useState } from "react";
import type { UI_COPY, Locale } from "../../../shared/utils/copy";
import { MissionMessageTimeline } from "./message-timeline";
import { MissionPermissionDrawer } from "./permission-drawer";
import { MissionQueuedPrompts } from "./queued-prompts";
import { MissionToolLoading } from "./tool-loading";
import { Icon } from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";
import { buildParallelChatLayoutModel } from "./chat-pane-layout-model";
import { splitMissionToolCalls } from "./chat-pane-model";
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
type MissionToolActivity = ComponentProps<typeof MissionToolLoading>["activity"];

type HistoryState = {
  hasMore: boolean;
  loading: boolean;
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
  onExpandSidebar: () => void;
  onToggleDisplay: () => void;
  onToggleInspector: () => void;
  onToggleThinking: () => void;
  onFocusSession: (sessionId: string) => void;
  onSelectDraftWindow?: (draftWindowId: string) => void;
  onSelectDraftAgent?: (agentId: string) => void;
  onCloseDraftWindow?: (draftWindowId: string) => void;
  onSelectSessionView: (sessionId: string) => void;
  onRenameSession: (session: SessionSummary) => void;
  onCloseSessionView: (session: SessionSummary) => void;
  onClearSession: (session: SessionSummary) => void;
  onReimportSessionHistory: (session: SessionSummary) => void;
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
  onExpandSidebar,
  onToggleDisplay,
  onToggleInspector,
  onToggleThinking,
  onFocusSession,
  onSelectDraftWindow,
  onSelectDraftAgent,
  onCloseDraftWindow,
  onSelectSessionView,
  onRenameSession,
  onCloseSessionView,
  onClearSession,
  onReimportSessionHistory,
  onRespondToPermission,
  promptQueue,
  restoreNotice,
  onUpdateQueuedPrompt,
  onDeleteQueuedPrompt,
  children,
}: MissionChatPaneProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const renderSessionStream = (session: SessionSummary) => {
    const sessionMessages = sessionMessagesById[session.id]
      ?? (session.id === activeSession?.id ? activeSessionMessages : []);
    const sessionToolCalls = sessionToolCallsById[session.id]
      ?? (session.id === activeSession?.id ? activeSessionToolCalls : []);
    const sessionTimeline = splitMissionToolCalls(sessionToolCalls);
    const sessionPendingApprovals = pendingApprovals.filter(
      (approval) => approval.sessionId === session.id,
    );
    const isActiveSession = session.id === activeSession?.id;
    const approvalStack = sessionPendingApprovals.length > 0 ? (
      <div className="mission-approval-stack grid gap-2">
        {sessionPendingApprovals.map((approval) => (
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

    return (
      <>
        {approvalStack}
        {sessionMessages.length ? (
          <MissionMessageTimeline
            items={sessionMessages}
            thinkingToolCalls={sessionTimeline.thinkingToolCalls}
            toolCalls={sessionTimeline.timelineToolCalls}
            showThinking={showThinking}
            boundaryTimestamps={sessionTimeline.boundaryTimestamps}
            sessionId={session.id}
            assistantLabel={session.agentName}
            copy={copy}
            expandedMessageIds={expandedMessageIds}
            historyStateBySession={messageHistoryState}
            activityHistoryStateBySession={activityHistoryState}
            onLoadOlderMessages={onLoadOlderMessages}
            onToggleExpandedMessage={onToggleExpandedMessage}
          />
        ) : (
          <SessionPreviewMessages session={session} restoring={isActiveSession} />
        )}
        {isSingleSession && isActiveSession && activityLoading ? (
          <MissionToolLoading
            activity={activityLoading}
            pendingToolPresent={pendingToolPresent}
          />
        ) : null}
      </>
    );
  };
  const {
    isSingleSession,
    parallelGridCompact,
    shouldLockChatMainScroll,
    shouldAnchorActiveParallelCard,
    parallelGridStyle,
  } = buildParallelChatLayoutModel({
    sessionCount: openSessions.length,
    hasDraftWindow: Boolean(draftWindow),
  });
  const singleSession = openSessions[0];
  const visibleSessionStreamCounts = openSessions
    .map((session) => `${session.id}:${sessionMessagesById[session.id]?.length ?? 0}:${sessionToolCallsById[session.id]?.length ?? 0}`)
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
    if (!menuOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

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
  }, [activeSession?.id, chatMainRef, openSessions.length, shouldLockChatMainScroll]);

  const sessionBodyScrollSnapshotRef = useRef<Record<string, { messageCount: number; toolCallCount: number }>>({});
  const sessionBodyScrollPositionRef = useRef<Record<string, { scrollTop: number; scrollHeight: number }>>({});
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
    const nextSnapshot: Record<string, { messageCount: number; toolCallCount: number }> = {};

    openSessions.forEach((session) => {
      const messageCount = sessionMessagesById[session.id]?.length ?? 0;
      const toolCallCount = sessionToolCallsById[session.id]?.length ?? 0;
      const previous = sessionBodyScrollSnapshotRef.current[session.id];
      nextSnapshot[session.id] = { messageCount, toolCallCount };
      if (!previous) {
        if (messageCount > 0 || toolCallCount > 0) {
          changedSessionIds.push(session.id);
        }
        return;
      }
      if (previous.messageCount !== messageCount || previous.toolCallCount !== toolCallCount) {
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
        if (body) {
          body.scrollTop = body.scrollHeight;
          sessionBodyScrollPositionRef.current[sessionId] = {
            scrollTop: body.scrollTop,
            scrollHeight: body.scrollHeight,
          };
        }
      });
    };

    scrollChangedBodies();
    const frame = window.requestAnimationFrame(scrollChangedBodies);
    const timeout = window.setTimeout(scrollChangedBodies, 180);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [chatMainRef, openSessions, sessionMessagesById, sessionToolCallsById, visibleSessionStreamCounts]);

  useEffect(() => {
    if (!shouldAnchorActiveParallelCard || !activeSession?.id) {
      return;
    }
    const anchorActiveCard = () => {
      const chatMain = chatMainRef.current;
      const activeCard = chatMain?.querySelector<HTMLElement>('[data-active-session-card="true"]');
      if (!chatMain || !activeCard) {
        return;
      }
      const chatMainTop = chatMain.getBoundingClientRect().top;
      const activeCardTop = activeCard.getBoundingClientRect().top;
      chatMain.scrollTop += activeCardTop - chatMainTop;
    };
    const frame = window.requestAnimationFrame(anchorActiveCard);
    const timeout = window.setTimeout(anchorActiveCard, 160);
    const lateTimeout = window.setTimeout(anchorActiveCard, 800);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      window.clearTimeout(lateTimeout);
    };
  }, [activeSession?.id, chatMainRef, openSessions.length, shouldAnchorActiveParallelCard]);

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
                onClick={() => {
                  if (activeSession) {
                    onRenameSession(activeSession);
                  }
                  setMenuOpen(false);
                }}
              >
                重命名
              </MenuItem>
              <MenuItem
                onClick={() => {
                  if (activeSession) {
                    onFocusSession(activeSession.id);
                  }
                  setMenuOpen(false);
                }}
              >
                生成摘要
              </MenuItem>
              <div className="mx-1 my-1 h-px bg-border-ghost" />
              <MenuItem
                checked={!displayCollapsed}
                icon="terminal"
                onClick={() => {
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
              <div className="mx-1 my-1 h-px bg-border-ghost" />
              <MenuItem onClick={() => setMenuOpen(false)} kbd="⌘E">
                导出对话
              </MenuItem>
              <MenuItem
                tone="destructive"
                onClick={() => {
                  if (activeSession) {
                    onClearSession(activeSession);
                  }
                  setMenuOpen(false);
                }}
              >
                清理会话
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
            <SessionCard
              session={singleSession}
              active={singleSession.id === selectedSessionId}
              flat
              bodyScrollSnapshot={sessionBodyScrollPositionRef.current[singleSession.id]}
              onBodyScroll={(event) => {
                sessionBodyScrollPositionRef.current[singleSession.id] = {
                  scrollTop: event.currentTarget.scrollTop,
                  scrollHeight: event.currentTarget.scrollHeight,
                };
              }}
              onFocus={onSelectSessionView}
              onRename={onRenameSession}
              onClear={onClearSession}
              onReimportHistory={onReimportSessionHistory}
              onClose={onCloseSessionView}
              restoreNotice={singleSession.id === selectedSessionId ? restoreNotice : undefined}
            >
              {renderSessionStream(singleSession)}
            </SessionCard>
          ) : (
            <div
              className={cn(
                "mission-session-grid grid box-border gap-2 p-2",
                parallelGridCompact ? "h-full min-h-0 overflow-hidden" : "min-h-full",
              )}
              style={parallelGridStyle}
            >
              {draftCard}
              {openSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  active={session.id === selectedSessionId}
                  bodyScrollSnapshot={sessionBodyScrollPositionRef.current[session.id]}
                  onBodyScroll={(event) => {
                    sessionBodyScrollPositionRef.current[session.id] = {
                      scrollTop: event.currentTarget.scrollTop,
                      scrollHeight: event.currentTarget.scrollHeight,
                    };
                  }}
                  onFocus={onSelectSessionView}
                  onRename={onRenameSession}
                  onClear={onClearSession}
                  onReimportHistory={onReimportSessionHistory}
                  onClose={onCloseSessionView}
                  restoreNotice={session.id === selectedSessionId ? restoreNotice : undefined}
                >
                  {renderSessionStream(session)}
                </SessionCard>
              ))}
            </div>
          )
        ) : null}{" "}
      </div>{" "}
      {activeSession ? (
        <MissionQueuedPrompts
          queue={promptQueue}
          onUpdate={onUpdateQueuedPrompt}
          onDelete={onDeleteQueuedPrompt}
        />
      ) : null}
      {children}
    </div>
  );
}
