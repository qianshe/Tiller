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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { UI_COPY, Locale } from "../../../shared/utils/copy";
import { MissionMessageTimeline } from "./message-timeline";
import { MissionPermissionDrawer } from "./permission-drawer";
import { MissionQueuedPrompts } from "./queued-prompts";
import { MissionToolLoading } from "./tool-loading";
import {
  Icon,
  AgentIcon,
  StatusDot,
} from "../../../shared/ui";
import { cn } from "../../../shared/utils/cn";

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
    request: PermissionRequest;
    resolving: boolean;
  }>;
  pendingToolTitle: string | null;
  showPermissionWorktree: boolean;
  displayCollapsed: boolean;
  inspectorCollapsed: boolean;
  sidebarCollapsed: boolean;
  onExpandSidebar: () => void;
  onToggleDisplay: () => void;
  onToggleInspector: () => void;
  onFocusSession: (sessionId: string) => void;
  onSelectSessionView: (sessionId: string) => void;
  onRenameSession: (session: SessionSummary) => void;
  onCloseSessionView: (session: SessionSummary) => void;
  onClearSession: (session: SessionSummary) => void;
  onRespondToPermission: (approvalRequestId: string, decision: PermissionDecision) => void;
  promptQueue?: SessionPromptQueueSnapshot;
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
  onExpandSidebar,
  onToggleDisplay,
  onToggleInspector,
  onFocusSession,
  onSelectSessionView,
  onRenameSession,
  onCloseSessionView,
  onClearSession,
  onRespondToPermission,
  promptQueue,
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
    const isActiveSession = session.id === activeSession?.id;

    return (
      <>
        {sessionMessages.length ? (
          <MissionMessageTimeline
            items={sessionMessages}
            thinkingToolCalls={sessionTimeline.thinkingToolCalls}
            toolCalls={sessionTimeline.timelineToolCalls}
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
  const isSingleSession = openSessions.length <= 1;
  const singleSession = openSessions[0];
  const parallelGridCompact = openSessions.length <= 2;
  const shouldLockChatMainScroll = openSessions.length > 0 && parallelGridCompact;
  const shouldAnchorActiveParallelCard = openSessions.length > 2;
  const parallelGridStyle = {
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
    gridAutoRows: parallelGridCompact ? "minmax(0, 1fr)" : "minmax(360px, min(52vh, 560px))",
  };
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
        {openSessions.length ? (
          isSingleSession && singleSession ? (
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
              onClose={onCloseSessionView}
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
                  onClose={onCloseSessionView}
                >
                  {renderSessionStream(session)}
                </SessionCard>
              ))}
            </div>
          )
        ) : null}{" "}
      </div>{" "}
      {activeSession && pendingApprovals.length > 0 ? (
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
      ) : null}
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

function SessionCard({
  session,
  active,
  bodyScrollSnapshot,
  onBodyScroll,
  onFocus,
  onRename,
  onClear,
  onClose,
  flat = false,
  children,
}: {
  session: SessionSummary;
  active: boolean;
  bodyScrollSnapshot?: { scrollTop: number; scrollHeight: number };
  onBodyScroll: UIEventHandler<HTMLDivElement>;
  onFocus: (sessionId: string) => void;
  onRename: (session: SessionSummary) => void;
  onClear: (session: SessionSummary) => void;
  onClose: (session: SessionSummary) => void;
  flat?: boolean;
  children: ReactNode;
}) {
  const isStreaming = session.status === "running";
  const statusTone = resolveSessionStatusTone(session.status);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [cardMenuOpen, setCardMenuOpen] = useState(false);

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
      return;
    }
    body.scrollTop = Math.max(body.scrollHeight - body.clientHeight, 0);
  }, [bodyScrollSnapshot]);

  return (
    <article
      onClick={() => onFocus(session.id)}
      data-active-session-card={active ? "true" : undefined}
      className={cn(
        "flex flex-col overflow-hidden [contain:layout_paint]",
        flat ? "h-full bg-surface" : "h-full min-h-0 bg-surface rounded-[8px] transition-all cursor-default",
      )}
      style={
        flat
          ? undefined
          : {
              boxShadow: active
                ? "inset 0 0 0 1px var(--primary), 0 8px 20px rgb(0 0 0 / 0.18)"
                : "inset 0 0 0 1px var(--border-ghost)",
            }
      }
      aria-current={active ? "true" : undefined}
    >
      <div className="wb-pane-head">
        <AgentIcon name={session.agentName} size={14} />
        <span className="text-section font-medium truncate text-foreground">
          {session.title?.trim() || session.agentName}
        </span>
        <span className="font-mono text-2xs text-muted-foreground tabular shrink-0">
          {session.projectName}
          {session.worktreeName ? ` / ${session.worktreeName}` : ""}
        </span>
        <div className="flex-1" />
        <StatusDot tone={statusTone} pulse={isStreaming} />
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
      <div
        ref={bodyRef}
        onScroll={onBodyScroll}
        className={cn("flex flex-1 min-h-0 flex-col gap-3 overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", flat ? "px-5 py-3" : "px-5 py-3")}
        data-session-card-body={session.id}
      >
        <div className="space-y-3">{children}</div>
      </div>
    </article>
  );
}

function splitMissionToolCalls(toolCalls: AgentToolCall[]) {
  return {
    thinkingToolCalls: toolCalls.filter((toolCall) => toolCall.kind === "think"),
    timelineToolCalls: toolCalls.filter((toolCall) => toolCall.kind !== "think"),
    boundaryTimestamps: toolCalls.map((toolCall) => toolCall.timestamp),
  };
}

function SessionPreviewMessages({ session, restoring = false }: { session: SessionSummary; restoring?: boolean }) {
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

function MenuItem({
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

function resolveSessionStatusTone(status: SessionSummary["status"]): "active" | "idle" | "warning" | "danger" | "primary" {
  switch (status) {
    case "running":
      return "primary";
    case "waiting_for_permission":
      return "warning";
    case "error":
      return "danger";
    default:
      return "idle";
  }
}

function formatSessionPreviewTime(value: string | undefined) {
  if (!value) {
    return "--:--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
