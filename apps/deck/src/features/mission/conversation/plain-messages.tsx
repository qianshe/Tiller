import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  AgentMessage,
  AgentToolCall,
  MissionPromptContextItem,
  SessionTimelineEntry,
  SessionTimelineThinkingChunk,
  SessionSubagentDetail,
} from "@tiller/shared";
import {
  mergeStreamingText,
  normalizeComparableReplayText,
  isTranscriptEventEntry,
  looksLikeCompactionLifecycleMessage,
  looksLikeContinuationSummary,
  sortSessionTimelineEntries,
} from "@tiller/shared";
import { normalizeLocalCommandMessageText } from "../../../shared/utils/local-command-message";
import { cn } from "../../../shared/utils/cn";
import {
  coalesceDisplayMessages,
  groupToolCalls,
  mergeAgentMessages,
  type ConversationToolCallItem,
} from "../../logbook";
import {
  PlainMessageItem,
  PlainSubagentItem,
  PlainThinkingItem,
  PlainToolCallItem,
  PlainToolGroupItem,
} from "./plain-message-items";
import { TranscriptEventRow } from "./transcript-event-row";

export const INITIAL_PLAIN_MESSAGE_RENDER_LIMIT = 96;
export const PLAIN_MESSAGE_RENDER_LOAD_STEP = 96;
const TIMELINE_SEQUENCE_RESET_TIMESTAMP_GAP_MS = 60_000;
const USER_PROMPT_REPRESENTATION_WINDOW_MS = 10_000;
const PLAIN_MESSAGE_TOP_LOAD_THRESHOLD_PX = 200;
const PLAIN_HISTORY_REVEAL_LOCK_DATASET_KEY = "plainHistoryRevealLock";
const PLAIN_HISTORY_REVEAL_UNLOCK_DELAY_MS = 220;

type PlainMessagesProps = {
  sessionId: string | null;
  items: AgentMessage[];
  timelineItems?: SessionTimelineEntry[];
  toolCalls?: AgentToolCall[];
  showThinking?: boolean;
  canHandoffAssistantMessage?: boolean;
  assistantHandoffBusy?: boolean;
  onHandoffAssistantMessage?: (assistantBlockText: string) => void;
  emptyText: string;
  expandedMessageIds: ReadonlySet<string>;
  boundaryTimestamps?: string[];
  historyState?: {
    hasMore: boolean;
    canLoadMore?: boolean;
    loading: boolean;
  };
  onLoadOlderMessages: () => void;
  onToggleExpandedMessage: (messageId: string) => void;
  onAddDraftContext?: (item: MissionPromptContextItem) => void;
  subagentDetails?: Record<string, (SessionSubagentDetail & { loading?: boolean; failed?: boolean }) | undefined>;
  onToggleSubagentDetail?: (sessionId: string, parentToolCallId: string, open: boolean) => void;
};

export function PlainMessages({
  sessionId,
  items,
  timelineItems = [],
  toolCalls = [],
  showThinking = true,
  canHandoffAssistantMessage = false,
  assistantHandoffBusy = false,
  onHandoffAssistantMessage,
  emptyText,
  expandedMessageIds,
  boundaryTimestamps = [],
  historyState,
  onLoadOlderMessages,
  onToggleExpandedMessage,
  onAddDraftContext,
  subagentDetails = {},
  onToggleSubagentDetail,
}: PlainMessagesProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const localScrollSnapshotRef = useRef<ScrollSnapshot | null>(null);
  const olderLoadRequestedRef = useRef(false);
  const pendingRemoteHistoryRevealRef = useRef(false);
  const remoteHistoryRevealBaselineRef = useRef<RemoteHistoryRevealBaseline | null>(null);
  const renderRevealRequestedRef = useRef(false);
  const historyRevealUnlockTimeoutRef = useRef<number | null>(null);
  const didInitialScrollRef = useRef(false);
  const timelineCacheRef = useRef<{
    items: SessionTimelineEntry[];
    sessionId: string | null;
  }>({ items: [], sessionId: null });
  const [visibleItemLimit, setVisibleItemLimit] = useState(INITIAL_PLAIN_MESSAGE_RENDER_LIMIT);
  const [dismissedSystemMessageIds, setDismissedSystemMessageIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    clearPlainHistoryRevealUnlockTimeout(historyRevealUnlockTimeoutRef);
    setPlainHistoryRevealLock(resolvePlainMessageScrollContainer(listRef.current), false);
    olderLoadRequestedRef.current = false;
    pendingRemoteHistoryRevealRef.current = false;
    remoteHistoryRevealBaselineRef.current = null;
    renderRevealRequestedRef.current = false;
    localScrollSnapshotRef.current = null;
    didInitialScrollRef.current = false;
    timelineCacheRef.current = { items: [], sessionId };
    setVisibleItemLimit(INITIAL_PLAIN_MESSAGE_RENDER_LIMIT);
    setDismissedSystemMessageIds(new Set());
  }, [sessionId]);

  const incomingTimelineItems = Array.isArray(timelineItems) ? timelineItems : [];
  if (timelineCacheRef.current.sessionId !== sessionId) {
    timelineCacheRef.current = { items: [], sessionId };
  }
  if (incomingTimelineItems.length > 0) {
    timelineCacheRef.current = { items: incomingTimelineItems, sessionId };
  }
  const effectiveTimelineItems =
    incomingTimelineItems.length > 0 || !historyState?.loading
      ? incomingTimelineItems
      : timelineCacheRef.current.items;

  const displayMessages = useMemo(
    () => resolvePlainDisplayMessages(items, boundaryTimestamps)
      .filter((message) => !(message.role === "system" && dismissedSystemMessageIds.has(message.id))),
    [items, boundaryTimestamps, dismissedSystemMessageIds],
  );
  const dismissSystemMessage = useCallback((messageId: string) => {
    setDismissedSystemMessageIds((current) => new Set([...current, messageId]));
  }, []);
  const displayItems = useMemo(
    () => resolvePlainConversationDisplayItems({
      sessionId,
      displayMessages,
      timelineItems: effectiveTimelineItems,
      showThinking,
      toolCalls,
    }),
    [
      displayMessages,
      effectiveTimelineItems,
      historyState?.hasMore,
      sessionId,
      showThinking,
      toolCalls,
    ],
  );
  const visibleItems = useMemo(
    () => resolveVisiblePlainConversationItems(displayItems, visibleItemLimit),
    [displayItems, visibleItemLimit],
  );
  const hasHiddenLoadedItems = visibleItemLimit < displayItems.length;
  const visibleRenderMessages = useMemo(
    () => resolvePlainMessageRenderItems(visibleItems),
    [visibleItems],
  );
  const visibleRenderSignature = useMemo(
    () => resolvePlainMessageRenderSignature(visibleRenderMessages),
    [visibleRenderMessages],
  );

  useEffect(() => {
    const currentBaseline = {
      displayItemsLength: displayItems.length,
      visibleRenderSignature,
    };
    const revealBaseline = resolveRemoteHistoryRevealBaseline({
      previousBaseline: remoteHistoryRevealBaselineRef.current,
      pendingRemoteHistoryReveal: pendingRemoteHistoryRevealRef.current,
      displayItemsLength: currentBaseline.displayItemsLength,
      visibleRenderSignature: currentBaseline.visibleRenderSignature,
    });
    remoteHistoryRevealBaselineRef.current = revealBaseline;
    if (!pendingRemoteHistoryRevealRef.current || historyState?.loading) {
      return;
    }
    remoteHistoryRevealBaselineRef.current = currentBaseline;
    const revealAction = resolveRemoteHistoryRevealAction({
      previousDisplayItemsLength: revealBaseline.displayItemsLength,
      nextDisplayItemsLength: displayItems.length,
      previousVisibleRenderSignature: revealBaseline.visibleRenderSignature,
      nextVisibleRenderSignature: visibleRenderSignature,
      visibleItemLimit,
    });
    if (revealAction === "clear-pending") {
      clearPlainHistoryRevealUnlockTimeout(historyRevealUnlockTimeoutRef);
      setPlainHistoryRevealLock(resolvePlainMessageScrollContainer(listRef.current), false);
      pendingRemoteHistoryRevealRef.current = false;
      olderLoadRequestedRef.current = false;
      localScrollSnapshotRef.current = null;
      return;
    }
    pendingRemoteHistoryRevealRef.current = false;
    olderLoadRequestedRef.current = false;
    renderRevealRequestedRef.current = true;
    if (revealAction === "reveal-more") {
      setVisibleItemLimit((currentLimit) => resolveNextPlainConversationRenderLimit(
        currentLimit,
        displayItems.length,
      ));
    }
  }, [displayItems.length, historyState?.loading, visibleItemLimit, visibleRenderSignature]);

  useEffect(() => {
    const scrollContainer = resolvePlainMessageScrollContainer(listRef.current);
    if (!scrollContainer || historyState?.loading) {
      return;
    }
    const container = scrollContainer;

    function captureScrollSnapshot() {
      localScrollSnapshotRef.current = {
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
    }

    function revealOlderLoadedItems() {
      if (renderRevealRequestedRef.current) {
        return;
      }
      const revealPlan = resolveLocalHistoryRevealPlan({
        scrollTop: container.scrollTop,
        currentLimit: visibleItemLimit,
        totalItems: displayItems.length,
      });
      if (revealPlan.preserveScroll) {
        captureScrollSnapshot();
      } else {
        localScrollSnapshotRef.current = {
          scrollHeight: container.scrollHeight,
          scrollTop: 0,
          mode: "top",
        };
      }
      clearPlainHistoryRevealUnlockTimeout(historyRevealUnlockTimeoutRef);
      setPlainHistoryRevealLock(container, true);
      renderRevealRequestedRef.current = true;
      setVisibleItemLimit(revealPlan.nextLimit);
    }

    function loadOlderWhenScrolledToTop() {
      if (
        olderLoadRequestedRef.current ||
        container.scrollTop > PLAIN_MESSAGE_TOP_LOAD_THRESHOLD_PX
      ) {
        return;
      }
      if (hasHiddenLoadedItems) {
        revealOlderLoadedItems();
        return;
      }
      if (!(historyState?.canLoadMore ?? historyState?.hasMore)) {
        return;
      }
      captureScrollSnapshot();
      clearPlainHistoryRevealUnlockTimeout(historyRevealUnlockTimeoutRef);
      setPlainHistoryRevealLock(container, true);
      olderLoadRequestedRef.current = true;
      pendingRemoteHistoryRevealRef.current = true;
      remoteHistoryRevealBaselineRef.current = {
        displayItemsLength: displayItems.length,
        visibleRenderSignature,
      };
      onLoadOlderMessages();
    }

    container.addEventListener("scroll", loadOlderWhenScrolledToTop, { passive: true });
    const primeFrame = window.requestAnimationFrame(() => {
      if (shouldPrimeOlderHistoryLoad({
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        canLoadMore: hasHiddenLoadedItems || Boolean(historyState?.canLoadMore ?? historyState?.hasMore),
      })) {
        loadOlderWhenScrolledToTop();
      }
    });
    return () => {
      window.cancelAnimationFrame(primeFrame);
      container.removeEventListener("scroll", loadOlderWhenScrolledToTop);
    };
  }, [displayItems.length, hasHiddenLoadedItems, historyState?.canLoadMore, historyState?.hasMore, historyState?.loading, onLoadOlderMessages, visibleRenderSignature]);

  useLayoutEffect(() => {
    renderRevealRequestedRef.current = false;
    const snapshot = localScrollSnapshotRef.current;
    const scrollContainer = resolvePlainMessageScrollContainer(listRef.current);
    if (!snapshot || !scrollContainer) {
      return;
    }

    const newScrollTop = snapshot.mode === "top"
      ? 0
      : scrollContainer.scrollHeight - snapshot.scrollHeight + snapshot.scrollTop;
    scrollContainer.scrollTop = newScrollTop;
    clearPlainHistoryRevealUnlockTimeout(historyRevealUnlockTimeoutRef);
    historyRevealUnlockTimeoutRef.current = window.setTimeout(() => {
      setPlainHistoryRevealLock(scrollContainer, false);
      historyRevealUnlockTimeoutRef.current = null;
    }, PLAIN_HISTORY_REVEAL_UNLOCK_DELAY_MS);
    localScrollSnapshotRef.current = null;
  }, [visibleRenderMessages.length, visibleRenderSignature]);

  // 首批消息到达时同步(paint 前)滚到底,消除"空容器在顶→消息到了再跳底"的跳动;
  // 仅首次生效,后续流式增长交还 stickToBottom / 外层滚动逻辑。
  useLayoutEffect(() => {
    if (didInitialScrollRef.current || displayItems.length === 0) {
      return;
    }
    const scrollContainer = resolvePlainMessageScrollContainer(listRef.current);
    if (!scrollContainer) {
      return;
    }
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    didInitialScrollRef.current = true;
  }, [displayItems.length]);

  if (!displayItems.length) {
    return (
      <div className="empty-state rounded-md border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">
        {historyState?.loading ? "加载消息中…" : emptyText}
      </div>
    );
  }

  const startsInsideEarlierContext = Boolean(
    historyState?.hasMore &&
      visibleRenderMessages[0] &&
      visibleRenderMessages[0].kind !== "message",
  );
  const renderMessages = resolveRenderablePlainMessageItems(
    visibleRenderMessages,
    startsInsideEarlierContext,
  );
  const assistantActionTarget = resolveFinalAssistantActionTarget(renderMessages);

  return (
    <div ref={listRef} className="plain-message-list conversation-timeline mx-auto grid w-full max-w-[min(1120px,calc(100%_-_8px))] gap-y-1">
      {startsInsideEarlierContext ? (
        <div className="plain-history-boundary mx-auto flex w-full max-w-[min(620px,72%)] items-center gap-2 text-xs text-muted-foreground/70">
          <span aria-hidden="true" className="h-px min-w-8 flex-1 bg-border-ghost" />
          <span className="shrink-0">上方还有上下文</span>
          <span aria-hidden="true" className="h-px min-w-8 flex-1 bg-border-ghost" />
        </div>
      ) : null}
      {renderMessages.map((renderItem, index) => {
        const previousRenderItem = renderMessages[index - 1];
        const spacingClassName = resolvePlainConversationItemSpacingClass(
          renderItem.kind,
          previousRenderItem?.kind,
          resolvePlainConversationMessageRole(renderItem),
          resolvePlainConversationMessageRole(previousRenderItem),
        );

        // Check for transcript events first
        if (renderItem.kind === "transcript-event") {
          return (
            <div key={renderItem.renderKey} className={spacingClassName}>
              <TranscriptEventRow entry={renderItem.entry} />
            </div>
          );
        }

        if (renderItem.kind === "thinking") {
          return (
            <div key={renderItem.renderKey} className={spacingClassName}>
              <PlainThinkingItem
                items={renderItem.thinkingParts ?? [renderItem.thinking]}
                hasNewerContent={index < renderMessages.length - 1}
              />
            </div>
          );
        }
        if (renderItem.kind === "tool-group") {
          return (
            <div key={renderItem.renderKey} className={spacingClassName}>
              <PlainToolGroupItem
                group={renderItem.group}
                hasNewerContent={index < renderMessages.length - 1}
              />
            </div>
          );
        }
        if (renderItem.kind === "tool") {
          return (
            <div key={renderItem.renderKey} className={spacingClassName}>
              <PlainToolCallItem item={renderItem.toolCall} />
            </div>
          );
        }
        if (renderItem.kind === "subagent") {
          const detailParentToolCallId = resolveSubagentDetailParentId(renderItem.toolCall);
          return (
            <div key={renderItem.renderKey} className={spacingClassName}>
              <PlainSubagentItem
                item={renderItem.toolCall}
                hasNewerContent={index < renderMessages.length - 1}
                detail={sessionId ? subagentDetails[`${sessionId}\0${detailParentToolCallId}`] : undefined}
                detailContent={sessionId ? (
                  <PlainSubagentConversation
                    detail={subagentDetails[`${sessionId}\0${detailParentToolCallId}`]}
                  />
                ) : undefined}
                onToggleDetail={sessionId && onToggleSubagentDetail
                  ? (open) => onToggleSubagentDetail(sessionId, detailParentToolCallId, open)
                  : undefined}
              />
            </div>
          );
        }

        const isExpanded = expandedMessageIds.has(renderItem.message.id);
        return (
          <div key={renderItem.renderKey} className={spacingClassName}>
            <PlainMessageItem
              assistantActions={
                assistantActionTarget?.renderKey === renderItem.renderKey
                  ? {
                      canHandoff: canHandoffAssistantMessage,
                      copyText: assistantActionTarget.copyText,
                      handoffBusy: assistantHandoffBusy,
                      onHandoff: onHandoffAssistantMessage,
                    }
                  : undefined
              }
              isExpanded={isExpanded}
              message={renderItem.message}
              onDismiss={renderItem.message.role === "system" ? dismissSystemMessage : undefined}
              onToggleExpandedMessage={onToggleExpandedMessage}
              onAddDraftContext={onAddDraftContext}
            />
          </div>
        );
      })}
    </div>
  );
}

function PlainSubagentConversation({
  detail,
}: {
  detail?: SessionSubagentDetail & { loading?: boolean; failed?: boolean };
}) {
  const entries = normalizeTimelineItems(detail?.entries);
  if (!entries.length) return null;
  const items = resolvePlainConversationDisplayItems({
    displayMessages: [],
    timelineItems: sortSessionTimelineEntries(entries),
    showThinking: true,
    toolCalls: [],
    groupTools: false,
  });
  const renderItems = resolvePlainMessageRenderItems(items);
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)]" data-subagent-conversation>
      {renderItems.map((item, index) => {
        const previousKind = renderItems[index - 1]?.kind;
        const startsSection = index > 0 &&
          !(item.kind === "tool" && previousKind === "tool");
        const className = item.kind === "tool"
          ? `${startsSection ? "border-t border-border-ghost/70 " : ""}pb-0.5 ${startsSection ? "pt-1.5" : "pt-0.5"}`
          : `${startsSection ? "border-t border-border-ghost/70 pt-2 " : ""}pb-2`;
        if (item.kind === "message") {
          return (
            <div key={item.renderKey} className={className}>
              <PlainMessageItem
                isExpanded={false}
                message={item.message}
                onToggleExpandedMessage={() => undefined}
              />
            </div>
          );
        }
        if (item.kind === "thinking") {
          return (
            <div key={item.renderKey} className={className}>
              <PlainThinkingItem
                items={item.thinkingParts ?? [item.thinking]}
                hasNewerContent={index < renderItems.length - 1}
              />
            </div>
          );
        }
        if (item.kind === "tool") {
          return (
            <div key={item.renderKey} className={className}>
              <PlainToolCallItem item={item.toolCall} />
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

type ScrollSnapshot = {
  scrollHeight: number;
  scrollTop: number;
  mode?: "preserve" | "top";
};

export type RemoteHistoryRevealBaseline = {
  displayItemsLength: number;
  visibleRenderSignature: string;
};

type PlainConversationItem =
  | { kind: "message"; sourceIndex?: number; timestamp: string; sequence?: number; message: AgentMessage }
  | {
      kind: "thinking";
      sourceIndex?: number;
      timestamp: string;
      sequence?: number;
      thinking: SessionTimelineThinkingChunk;
      thinkingParts?: SessionTimelineThinkingChunk[];
    }
  | { kind: "subagent"; sourceIndex?: number; timestamp: string; sequence?: number; toolCall: ConversationToolCallItem }
  | { kind: "tool"; sourceIndex?: number; timestamp: string; sequence?: number; toolCall: ConversationToolCallItem }
  | { kind: "tool-group"; sourceIndex?: number; timestamp: string; sequence?: number; group: ConversationToolCallItem[] }
  | { kind: "transcript-event"; sourceIndex?: number; timestamp: string; sequence?: number; entry: Extract<SessionTimelineEntry, { kind: "context_compaction" | "history_gap" }> };

type PlainMessageRenderSource = AgentMessage | PlainConversationItem;

export type PlainMessageRenderItem =
  | {
      isContinuation: boolean;
      kind: "message";
      message: AgentMessage;
      renderKey: string;
    }
  | {
      kind: "thinking";
      renderKey: string;
      thinking: SessionTimelineThinkingChunk;
      thinkingParts?: SessionTimelineThinkingChunk[];
    }
  | {
      kind: "tool";
      renderKey: string;
      toolCall: ConversationToolCallItem;
    }
  | {
      group: ConversationToolCallItem[];
      kind: "tool-group";
      renderKey: string;
    }
  | {
      kind: "subagent";
      renderKey: string;
      toolCall: ConversationToolCallItem;
    }
  | {
      kind: "transcript-event";
      renderKey: string;
      entry: Extract<SessionTimelineEntry, { kind: "context_compaction" | "history_gap" }>;
    };

export type PlainConversationRenderKind = PlainMessageRenderItem["kind"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isRenderableAgentMessage(value: unknown): value is AgentMessage {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    (value.role === "assistant" || value.role === "system" || value.role === "user") &&
    typeof value.text === "string" &&
    typeof value.timestamp === "string"
  );
}

function isRenderableToolLike(value: unknown): value is AgentToolCall {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    typeof value.title === "string" &&
    typeof value.status === "string" &&
    typeof value.timestamp === "string"
  );
}

function isRenderableTimelineChunk(value: unknown) {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.text !== "string" || typeof value.timestamp !== "string") {
    return false;
  }
  if (value.kind === "content") {
    return true;
  }
  return value.kind === "thinking" &&
    typeof value.title === "string" &&
    typeof value.status === "string" &&
    typeof value.updatedAt === "string";
}

function isRenderableTimelineEntry(value: unknown): value is SessionTimelineEntry {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.kind !== "string" || typeof value.timestamp !== "string") {
    return false;
  }
  switch (value.kind) {
    case "user_message":
    case "system_message":
      return isRenderableAgentMessage(value.message);
    case "assistant_message":
      return Array.isArray(value.chunks) && value.chunks.every(isRenderableTimelineChunk);
    case "tool_call":
      return isRenderableToolLike(value.toolCall);
    case "command_output": {
      const output = value.output;
      return isRecord(output) &&
        typeof value.commandId === "string" &&
        typeof output.id === "string" &&
        typeof output.commandId === "string" &&
        typeof output.text === "string" &&
        typeof output.stream === "string" &&
        typeof output.timestamp === "string";
    }
    case "context_compaction":
      return typeof value.phase === "string" && typeof value.source === "string";
    case "history_gap":
      return typeof value.message === "string";
    default:
      return false;
  }
}

function normalizeAgentMessages(items: AgentMessage[] | null | undefined) {
  return Array.isArray(items)
    ? items.filter(isRenderableAgentMessage)
    : [];
}

function normalizeAgentToolCalls(toolCalls: AgentToolCall[] | null | undefined) {
  return Array.isArray(toolCalls)
    ? toolCalls.filter(isRenderableToolLike)
    : [];
}

function normalizeTimelineItems(items: SessionTimelineEntry[] | null | undefined) {
  return Array.isArray(items)
    ? items.filter(isRenderableTimelineEntry)
    : [];
}

function resolvePlainConversationMessageRole(
  item: PlainMessageRenderItem | undefined,
) {
  return item?.kind === "message" ? item.message.role : undefined;
}

export function resolvePlainConversationItemSpacingClass(
  itemKind: PlainConversationRenderKind,
  previousKind?: PlainConversationRenderKind,
  itemRole?: AgentMessage["role"],
  previousRole?: AgentMessage["role"],
) {
  const isMessageRoleBoundary =
    itemKind === "message" &&
    previousKind === "message" &&
    Boolean(itemRole) &&
    Boolean(previousRole) &&
    itemRole !== previousRole;
  const touchesMessage = Boolean(previousKind) && (
    itemKind === "message" || previousKind === "message"
  );
  return cn(
    "plain-message-block min-w-0",
    isMessageRoleBoundary ? "mt-4" : touchesMessage && "mt-2",
  );
}

export function resolvePlainMessageRenderItems(
  items: PlainMessageRenderSource[],
): PlainMessageRenderItem[] {
  const normalizedItems = items
    .map(normalizePlainMessageRenderSource)
    .filter((item): item is PlainConversationItem => Boolean(item));
  const seenKeys = new Map<string, number>();
  return normalizedItems.map((item, index) => {
    if (item.kind === "transcript-event") {
      const baseKey = `transcript-${item.entry.kind}-${item.entry.id}`;
      const seenCount = seenKeys.get(baseKey) ?? 0;
      seenKeys.set(baseKey, seenCount + 1);
      return {
        kind: "transcript-event",
        renderKey: seenCount === 0 ? baseKey : `${baseKey}#${seenCount}`,
        entry: item.entry,
      };
    }
    if (item.kind === "thinking") {
      const baseKey = `thinking-${item.thinking.id}`;
      const seenCount = seenKeys.get(baseKey) ?? 0;
      seenKeys.set(baseKey, seenCount + 1);
      return {
        kind: "thinking",
        renderKey: seenCount === 0 ? baseKey : `${baseKey}#${seenCount}`,
        thinking: item.thinking,
        thinkingParts: item.thinkingParts,
      };
    }
    if (item.kind === "tool") {
      const baseKey = `tool-${item.toolCall.id}`;
      const seenCount = seenKeys.get(baseKey) ?? 0;
      seenKeys.set(baseKey, seenCount + 1);
      return {
        kind: "tool",
        renderKey: seenCount === 0 ? baseKey : `${baseKey}#${seenCount}`,
        toolCall: item.toolCall,
      };
    }
    if (item.kind === "tool-group") {
      const baseKey = `tool-group-${item.group[0]?.id}`;
      const seenCount = seenKeys.get(baseKey) ?? 0;
      seenKeys.set(baseKey, seenCount + 1);
      return {
        group: item.group,
        kind: "tool-group",
        renderKey: seenCount === 0 ? baseKey : `${baseKey}#${seenCount}`,
      };
    }
    if (item.kind === "subagent") {
      const baseKey = `subagent-${item.toolCall.id}`;
      const seenCount = seenKeys.get(baseKey) ?? 0;
      seenKeys.set(baseKey, seenCount + 1);
      return {
        kind: "subagent",
        renderKey: seenCount === 0 ? baseKey : `${baseKey}#${seenCount}`,
        toolCall: item.toolCall,
      };
    }

    const previous = normalizedItems[index - 1];
    const baseKey = item.message.id || `${item.message.role}-${item.message.timestamp || index}`;
    const seenCount = seenKeys.get(baseKey) ?? 0;
    seenKeys.set(baseKey, seenCount + 1);
    return {
      isContinuation: item.message.role === "assistant" && previous?.kind === "message" && previous.message.role === "assistant",
      kind: "message",
      message: item.message,
      renderKey: seenCount === 0 ? baseKey : `${baseKey}#${seenCount}`,
    };
  });
}

export function resolvePlainMessageRenderSignature(
  items: PlainMessageRenderItem[],
) {
  return items.map(resolvePlainMessageRenderSignaturePart).join("|");
}

function resolvePlainMessageRenderSignaturePart(item: PlainMessageRenderItem) {
  if (item.kind === "message") {
    return [
      item.renderKey,
      item.message.role,
      item.message.timestamp,
      item.message.streaming ? "streaming" : "stable",
      item.message.text.length,
    ].join(":");
  }
  if (item.kind === "thinking") {
    const thinkingParts = item.thinkingParts ?? [item.thinking];
    return [
      item.renderKey,
      ...thinkingParts.map((thinking) => resolveToolRenderSignaturePart(
        thinking.id,
        thinking,
        thinking.text,
        "",
      )),
    ].join(":");
  }
  if (item.kind === "subagent") {
    return resolveToolRenderSignaturePart(
      item.renderKey,
      item.toolCall,
      item.toolCall.text,
      item.toolCall.input,
    );
  }
  if (item.kind === "tool") {
    return resolveToolRenderSignaturePart(
      item.renderKey,
      item.toolCall,
      item.toolCall.text,
      item.toolCall.input,
    );
  }
  if (item.kind === "transcript-event") {
    return [item.renderKey, item.entry.kind, item.entry.id].join(":");
  }
  return [
    item.renderKey,
    ...item.group.map((toolCall: any) => resolveToolRenderSignaturePart(
      toolCall.id,
      toolCall,
      toolCall.text,
      toolCall.input,
    )),
  ].join(":");
}

function resolveToolRenderSignaturePart(
  renderKey: string,
  toolCall: AgentToolCall | ConversationToolCallItem | SessionTimelineThinkingChunk,
  outputText: string,
  inputText: string,
) {
  const updatedAt = "updatedAt" in toolCall ? toolCall.updatedAt : "";
  return [
    renderKey,
    toolCall.status,
    toolCall.timestamp,
    updatedAt,
    outputText.length,
    inputText.length,
  ].join(":");
}

function resolveRenderablePlainMessageItems(
  items: PlainMessageRenderItem[],
  hideDetachedLeadingContext: boolean,
) {
  if (!hideDetachedLeadingContext) {
    return items;
  }
  const firstStableIndex = items.findIndex(
    (item) =>
      item.kind === "message" ||
      item.kind === "transcript-event",
  );
  return firstStableIndex >= 0 ? items.slice(firstStableIndex) : [];
}

export function resolveFinalAssistantActionTarget(
  items: PlainMessageRenderItem[],
) {
  const finalItem = items.at(-1);
  if (
    finalItem?.kind !== "message" ||
    finalItem.message.role !== "assistant" ||
    finalItem.message.streaming ||
    !finalItem.message.text.trim()
  ) {
    return null;
  }

  return {
    copyText: finalItem.message.text,
    messageId: finalItem.message.id,
    renderKey: finalItem.renderKey,
  };
}

function sortDisplayMessages(items: AgentMessage[], boundaryTimestamps: string[] = []) {
  const sortedMessages = normalizeAgentMessages(items)
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const sequenceDelta = compareOptionalTimelineSequence(
        left.message.sequence,
        right.message.sequence,
      );
      if (sequenceDelta !== null) {
        return sequenceDelta;
      }
      const timestampDelta = comparePlainItemTimestamps(
        left.message.timestamp,
        right.message.timestamp,
      );
      return timestampDelta !== 0 ? timestampDelta : left.index - right.index;
    })
    .map((entry) => entry.message);
  return coalesceDisplayMessages(
    sortedMessages.filter(
      (message) => !isAcpPromptWrapperEcho(message, sortedMessages),
    ),
    boundaryTimestamps,
  );
}

export function resolvePlainDisplayMessages(
  items: AgentMessage[] | null | undefined,
  boundaryTimestamps: string[] = [],
) {
  return sortDisplayMessages(normalizeAgentMessages(items), boundaryTimestamps);
}

export function shouldAutoLoadOlderHistory(
  metrics: { scrollHeight: number; clientHeight: number },
  threshold = 48,
) {
  return metrics.scrollHeight <= metrics.clientHeight + threshold;
}

export function shouldPrimeOlderHistoryLoad({
  scrollTop,
  scrollHeight,
  clientHeight,
  canLoadMore,
}: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  canLoadMore: boolean;
}) {
  return canLoadMore && (
    scrollTop <= PLAIN_MESSAGE_TOP_LOAD_THRESHOLD_PX ||
    shouldAutoLoadOlderHistory({ scrollHeight, clientHeight })
  );
}

export function resolvePlainMessageScrollContainer(
  listElement: HTMLDivElement | null,
): HTMLElement | null {
  return listElement?.closest<HTMLElement>("[data-session-card-body]") ?? listElement?.parentElement ?? null;
}

function setPlainHistoryRevealLock(scrollContainer: HTMLElement | null, locked: boolean) {
  if (!scrollContainer) {
    return;
  }
  if (locked) {
    scrollContainer.dataset[PLAIN_HISTORY_REVEAL_LOCK_DATASET_KEY] = "true";
    return;
  }
  delete scrollContainer.dataset[PLAIN_HISTORY_REVEAL_LOCK_DATASET_KEY];
}

function clearPlainHistoryRevealUnlockTimeout(timeoutRef: { current: number | null }) {
  if (timeoutRef.current === null) {
    return;
  }
  window.clearTimeout(timeoutRef.current);
  timeoutRef.current = null;
}

export function resolveVisiblePlainConversationItems<T>(
  items: T[],
  limit = INITIAL_PLAIN_MESSAGE_RENDER_LIMIT,
): T[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  if (safeLimit <= 0 || items.length <= safeLimit) {
    return items;
  }
  const startIndex = resolvePlainConversationWindowStartIndex(
    items,
    items.length - safeLimit,
  );
  return items.slice(startIndex);
}

function resolvePlainConversationWindowStartIndex<T>(items: T[], startIndex: number) {
  if (startIndex <= 0 || !isPlainConversationContextItem(items[startIndex])) {
    return startIndex;
  }
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (isPlainConversationMessageItem(item)) {
      return index;
    }
    if (!isPlainConversationContextItem(item)) {
      return startIndex;
    }
  }
  return startIndex;
}

function isPlainConversationContextItem(item: unknown) {
  return isPlainConversationItemKind(item, "thinking") ||
    isPlainConversationItemKind(item, "subagent") ||
    isPlainConversationItemKind(item, "tool-group");
}

function isPlainConversationMessageItem(item: unknown) {
  return isPlainConversationItemKind(item, "message");
}

function isPlainConversationItemKind(item: unknown, kind: PlainConversationItem["kind"]) {
  return Boolean(item && typeof item === "object" && "kind" in item && item.kind === kind);
}

export function resolveNextPlainConversationRenderLimit(
  currentLimit: number,
  totalItems: number,
  step = PLAIN_MESSAGE_RENDER_LOAD_STEP,
): number {
  const safeTotal = Math.max(0, Math.floor(totalItems));
  const safeCurrent = Math.max(0, Math.floor(currentLimit));
  const safeStep = Math.max(1, Math.floor(step));
  if (safeCurrent >= safeTotal) {
    return safeTotal;
  }
  return Math.min(safeTotal, safeCurrent + safeStep);
}

export function resolveLocalHistoryRevealPlan({
  scrollTop,
  currentLimit,
  totalItems,
  absoluteTopThreshold = 1,
}: {
  scrollTop: number;
  currentLimit: number;
  totalItems: number;
  absoluteTopThreshold?: number;
}) {
  const atAbsoluteTop = scrollTop <= absoluteTopThreshold;
  return {
    nextLimit: atAbsoluteTop
      ? Math.max(0, Math.floor(totalItems))
      : resolveNextPlainConversationRenderLimit(currentLimit, totalItems),
    preserveScroll: !atAbsoluteTop,
  };
}

export function resolvePlainConversationDisplayItems({
  sessionId,
  displayMessages,
  timelineItems,
  showThinking,
  toolCalls,
  groupTools = true,
}: {
  sessionId?: string | null;
  displayMessages: AgentMessage[];
  timelineItems: SessionTimelineEntry[];
  showThinking: boolean;
  toolCalls: AgentToolCall[];
  groupTools?: boolean;
}) {
  const safeDisplayMessages = normalizeAgentMessages(displayMessages);
  const safeTimelineItems = normalizeTimelineItems(timelineItems);
  const safeToolCalls = normalizeAgentToolCalls(toolCalls);

  if (!safeTimelineItems.length) {
    return buildPlainConversationItems(
      safeDisplayMessages,
      safeToolCalls,
      showThinking,
      groupTools,
    );
  }

  return buildPlainConversationItemsFromTimelineWithLiveMessages(
    sessionId,
    safeTimelineItems,
    safeDisplayMessages,
    safeToolCalls,
    showThinking,
    groupTools,
  );
}

function resolveSubagentDetailParentId(toolCall: Pick<ConversationToolCallItem, "id" | "commandId">) {
  return toolCall.commandId || toolCall.id;
}

export function resolveRemoteHistoryRevealAction({
  previousDisplayItemsLength,
  nextDisplayItemsLength,
  previousVisibleRenderSignature,
  nextVisibleRenderSignature,
  visibleItemLimit,
}: {
  previousDisplayItemsLength: number;
  nextDisplayItemsLength: number;
  previousVisibleRenderSignature: string;
  nextVisibleRenderSignature: string;
  visibleItemLimit: number;
}): "reveal-more" | "preserve-scroll" | "clear-pending" {
  const loadedOlderItems = nextDisplayItemsLength > previousDisplayItemsLength;
  const visibleWindowShifted =
    previousVisibleRenderSignature.length > 0 &&
    previousVisibleRenderSignature !== nextVisibleRenderSignature;
  if (loadedOlderItems && visibleItemLimit < nextDisplayItemsLength) {
    return "reveal-more";
  }
  if (loadedOlderItems || visibleWindowShifted) {
    return "preserve-scroll";
  }
  return "clear-pending";
}

export function resolveRemoteHistoryRevealBaseline({
  previousBaseline,
  pendingRemoteHistoryReveal,
  displayItemsLength,
  visibleRenderSignature,
}: {
  previousBaseline: RemoteHistoryRevealBaseline | null;
  pendingRemoteHistoryReveal: boolean;
  displayItemsLength: number;
  visibleRenderSignature: string;
}) {
  const currentBaseline = { displayItemsLength, visibleRenderSignature };
  if (!pendingRemoteHistoryReveal) {
    return currentBaseline;
  }
  return previousBaseline ?? currentBaseline;
}

function normalizePlainMessageRenderSource(
  item: PlainMessageRenderSource | null | undefined,
): PlainConversationItem | null {
  if (!item || typeof item !== "object") {
    return null;
  }
  if ("role" in item) {
    if (!isRenderableAgentMessage(item)) {
      return null;
    }
    const text = normalizePlainMessageText(item.text);
    if (!text) {
      return null;
    }
    return {
      kind: "message",
      timestamp: item.timestamp,
      sequence: item.sequence,
      message: text === item.text ? item : { ...item, text },
    };
  }
  if (!("kind" in item) || typeof item.kind !== "string") {
    return null;
  }
  if (item.kind === "message") {
    if (!isRenderableAgentMessage(item.message)) {
      return null;
    }
    const text = normalizePlainMessageText(item.message.text);
    if (!text) {
      return null;
    }
    return {
      ...item,
      message: text === item.message.text ? item.message : { ...item.message, text },
    };
  }
  if (item.kind === "thinking") {
    return isRenderableTimelineChunk(item.thinking) && item.thinking.kind === "thinking" ? item : null;
  }
  if (item.kind === "tool" || item.kind === "subagent") {
    return isRenderableToolLike(item.toolCall) ? item : null;
  }
  if (item.kind === "tool-group") {
    return Array.isArray(item.group) && item.group.every(isRenderableToolLike) ? item : null;
  }
  if (item.kind === "transcript-event") {
    return isRenderableTimelineEntry(item.entry) ? item : null;
  }
  return null;
}

function normalizePlainMessageText(text: string): string {
  const normalizedText = normalizeLocalCommandMessageText(text);
  return normalizedText.trim() ? normalizedText : "";
}

function buildPlainConversationItems(
  messages: AgentMessage[],
  toolCalls: AgentToolCall[],
  showThinking: boolean,
  groupTools = true,
): PlainConversationItem[] {
  const safeMessages = normalizeAgentMessages(messages);
  const visibleToolCalls = normalizeAgentToolCalls(toolCalls);
  const messageItems = safeMessages.flatMap<PlainConversationItem>((message, index) => {
    if (message.role === "assistant" && message.contentKind === "thought") {
      return showThinking
        ? [{
            kind: "thinking",
            sourceIndex: index,
            timestamp: message.timestamp,
            sequence: message.sequence,
            thinking: {
              id: `${message.id}:thinking`,
              kind: "thinking",
              title: "Thinking",
              status: message.streaming === false ? "completed" : "running",
              streamMode: message.streamMode,
              text: message.text,
              timestamp: message.timestamp,
              updatedAt: message.timestamp,
              sequence: message.sequence,
            },
          }]
        : [];
    }
    const text = normalizePlainMessageText(message.text);
    return text
      ? [{ kind: "message" as const, sourceIndex: index, timestamp: message.timestamp, sequence: message.sequence, message: text === message.text ? message : { ...message, text } }]
      : [];
  });
  const normalizedToolCalls = groupToolCalls(visibleToolCalls);
  const toolItems = normalizedToolCalls.map((toolCall, index) => toPlainToolConversationItem(
    toolCall,
    messages.length + index,
    !groupTools,
  ));
  const sorted = [...messageItems, ...toolItems].sort(comparePlainConversationItems);
  return maybeMergeAdjacentToolItems(mergeAdjacentThinkingItems(sorted), groupTools);
}

function buildPlainConversationItemsFromTimeline(
  timelineItems: SessionTimelineEntry[],
  showThinking: boolean,
  groupTools = true,
): PlainConversationItem[] {
  timelineItems = normalizeTimelineItems(timelineItems);
  const items: PlainConversationItem[] = [];
  const hasCompactionTranscriptEvent = timelineItems.some(
    (entry) => entry.kind === "context_compaction",
  );
  let sourceIndex = 0;

  for (const entry of timelineItems) {
    // Handle transcript events (context_compaction, history_gap)
    if (isTranscriptEventEntry(entry)) {
      items.push({
        kind: "transcript-event",
        sourceIndex,
        timestamp: entry.timestamp,
        sequence: undefined,
        entry,
      });
      sourceIndex += 1;
      continue;
    }

    if (entry.kind === "user_message" || entry.kind === "system_message") {
      if (
        hasCompactionTranscriptEvent &&
        (
          looksLikeContinuationSummary(entry.message.text) ||
          looksLikeCompactionLifecycleMessage(entry.message.text)
        )
      ) {
        continue;
      }
      const text = normalizePlainMessageText(entry.message.text);
      if (text) {
        items.push({
          kind: "message",
          sourceIndex,
          timestamp: entry.timestamp,
          sequence: entry.sequence,
          message: text === entry.message.text ? entry.message : { ...entry.message, text },
        });
        sourceIndex += 1;
      }
      continue;
    }

    if (entry.kind === "assistant_message") {
      for (const chunk of entry.chunks) {
        if (chunk.kind === "thinking") {
          if (showThinking) {
            items.push({
              kind: "thinking",
              sourceIndex,
              timestamp: chunk.timestamp,
              sequence: chunk.sequence,
              thinking: chunk,
            });
            sourceIndex += 1;
          }
          continue;
        }

        if (
          hasCompactionTranscriptEvent &&
          looksLikeCompactionLifecycleMessage(chunk.text)
        ) {
          continue;
        }
        const text = normalizePlainMessageText(chunk.text);
        if (text) {
          items.push({
            kind: "message",
            sourceIndex,
            timestamp: chunk.timestamp,
            sequence: chunk.sequence,
            message: {
              id: entry.id,
              role: "assistant",
              text,
              timestamp: chunk.timestamp,
              sequence: chunk.sequence,
              streaming: chunk.streaming,
            },
          });
          sourceIndex += 1;
        }
      }
      continue;
    }

    if (entry.kind === "tool_call") {
      const [toolCall] = groupToolCalls([entry.toolCall]);
      if (toolCall) {
        items.push(toPlainToolConversationItem(
          {
            ...toolCall,
            timestamp: entry.timestamp,
            sequence: entry.sequence,
          },
          sourceIndex,
          !groupTools,
        ));
        sourceIndex += 1;
      }
    }
  }

  const orderedItems = [...items].sort(compareSequencedPlainConversationItems);
  return maybeMergeAdjacentToolItems(
    mergeAdjacentThinkingItems(mergeAdjacentMessageItems(orderedItems)),
    groupTools,
  );
}

function buildPlainConversationItemsFromTimelineWithLiveMessages(
  sessionId: string | null | undefined,
  timelineItems: SessionTimelineEntry[],
  messages: AgentMessage[],
  toolCalls: AgentToolCall[],
  showThinking: boolean,
  groupTools: boolean,
): PlainConversationItem[] {
  const groupedLiveToolCalls = groupToolCalls(toolCalls);
  const timelineConversationItems = mergeLiveSubagentItemsIntoTimeline(
    buildPlainConversationItemsFromTimeline(
    timelineItems,
    showThinking,
    groupTools,
    ),
    groupedLiveToolCalls,
  );
  const hasCompactionTranscriptEvent = timelineItems.some(
    (entry) => entry.kind === "context_compaction",
  );
  const timelineMessageIds = collectTimelineMessageIds(timelineItems);
  const representedLiveUserMessageIds = resolveTimelineRepresentedUserMessageIds(
    timelineItems,
    messages,
  );
  const representedLiveAssistantMessageIds = resolveTimelineRepresentedAssistantMessageIds(
    timelineItems,
    messages,
  );
  const continuationPrefaceMessageIds = resolveContinuationPrefaceMessageIds(messages);
  const continuationPrefaceAnchor = resolveContinuationPrefaceAnchor(
    messages,
    continuationPrefaceMessageIds,
  );
  const liveMessageItems = messages.flatMap<PlainConversationItem>((message, index) => {
    if (
      hasCompactionTranscriptEvent &&
      (
        looksLikeContinuationSummary(message.text) ||
        looksLikeCompactionLifecycleMessage(message.text)
      )
    ) {
      return [];
    }
    if (
      timelineMessageIds.has(message.id) ||
      representedLiveUserMessageIds.has(message.id) ||
      representedLiveAssistantMessageIds.has(message.id)
    ) {
      return [];
    }
    return buildPlainConversationItems([message], [], showThinking, groupTools).map((item) => ({
      ...item,
      sourceIndex: timelineConversationItems.length + index,
    }));
  });
  const canonicalToolCallIds = new Set(
    timelineItems.flatMap((entry) => entry.kind === "tool_call" ? [entry.toolCall.id] : []),
  );
  const canonicalSubagentCommandIds = new Set(
    timelineConversationItems.flatMap((item) =>
      item.kind === "subagent" && item.toolCall.commandId
        ? [item.toolCall.commandId]
        : []
    ),
  );
  const liveToolItems = groupedLiveToolCalls.filter((toolCall) =>
    !canonicalToolCallIds.has(toolCall.id) &&
    !(toolCall.toolKind === "subagent" && canonicalSubagentCommandIds.has(toolCall.commandId))
  ).map((toolCall, index) =>
    toPlainToolConversationItem(
      toolCall,
      timelineConversationItems.length + messages.length + index,
      !groupTools,
    )
  );
  const continuationPrefaceItems = continuationPrefaceAnchor
    ? liveMessageItems.filter(
        (item) => item.kind === "message" &&
          continuationPrefaceMessageIds.has(item.message.id),
      )
    : [];
  const regularLiveMessageItems = continuationPrefaceItems.length
    ? liveMessageItems.filter(
        (item) => item.kind !== "message" ||
          !continuationPrefaceMessageIds.has(item.message.id),
      )
    : liveMessageItems;
  const regularLiveItems = [
    ...regularLiveMessageItems,
    ...liveToolItems,
  ];

  if (!regularLiveItems.length && !continuationPrefaceItems.length) {
    return timelineConversationItems;
  }

  const sequencedLiveItems = regularLiveItems.filter(
    (item) => typeof item.sequence === "number",
  );
  const unsequencedLiveItems = regularLiveItems.filter(
    (item) => typeof item.sequence !== "number",
  );
  const optimisticUnsequencedLiveMessageItems = unsequencedLiveItems.filter(
    (item) => item.kind === "message" && isOptimisticLiveMessage(sessionId, item.message),
  );
  const historicalUnsequencedLiveItems = unsequencedLiveItems.filter(
    (item) => item.kind !== "message" || !isOptimisticLiveMessage(sessionId, item.message),
  );
  const mergedSequencedTimelineItems = mergeSequencedLiveMessageItemsIntoTimeline(
    timelineConversationItems,
    sequencedLiveItems,
  );
  const mergedTimelineAndLiveItems = mergeUnsequencedLiveMessageItemsIntoTimeline(
    mergedSequencedTimelineItems,
    historicalUnsequencedLiveItems,
  );
  const mergedSequencedItems = maybeMergeAdjacentToolItems(
    mergeAdjacentThinkingItems(mergeAdjacentMessageItems(mergedTimelineAndLiveItems)),
    groupTools,
  );
  const itemsWithContinuationPreface = continuationPrefaceItems.length
    ? insertContinuationPrefaceItems(
        mergedSequencedItems,
        continuationPrefaceItems,
        continuationPrefaceAnchor,
      )
    : mergedSequencedItems;
  return [...itemsWithContinuationPreface, ...optimisticUnsequencedLiveMessageItems];
}

function mergeLiveSubagentItemsIntoTimeline(
  timelineItems: PlainConversationItem[],
  liveToolCalls: ConversationToolCallItem[],
) {
  const liveByCommandId = new Map(
    liveToolCalls
      .filter((toolCall) => toolCall.toolKind === "subagent")
      .map((toolCall) => [toolCall.commandId, toolCall]),
  );
  if (!liveByCommandId.size) {
    return timelineItems;
  }
  return timelineItems.map((item) => {
    if (item.kind !== "subagent") {
      return item;
    }
    const liveToolCall = liveByCommandId.get(item.toolCall.commandId);
    if (!liveToolCall) {
      return item;
    }
    return {
      ...item,
      toolCall: {
        ...item.toolCall,
        ...liveToolCall,
        id: item.toolCall.id,
        commandId: item.toolCall.commandId,
        timestamp: item.toolCall.timestamp,
        sequence: item.sequence ?? liveToolCall.sequence,
      },
    };
  });
}

function isOptimisticLiveMessage(
  sessionId: string | null | undefined,
  message: AgentMessage,
) {
  if (!sessionId) {
    return false;
  }
  if (message.role === "user") {
    return message.id === `${sessionId}-user-pending`;
  }
  return message.role === "assistant" && message.streaming === true;
}

function mergeSequencedLiveMessageItemsIntoTimeline(
  timelineItems: PlainConversationItem[],
  liveItems: PlainConversationItem[],
) {
  if (!timelineItems.length) {
    return [...liveItems].sort(compareSequencedPlainConversationItems);
  }
  if (!liveItems.length) {
    return timelineItems;
  }

  const merged = [...timelineItems];
  const sortedLiveItems = [...liveItems].sort(compareSequencedPlainConversationItems);
  for (const liveItem of sortedLiveItems) {
    const insertIndex = resolveSequencedLiveMessageInsertIndex(merged, liveItem);
    merged.splice(insertIndex, 0, liveItem);
  }
  return merged;
}

function mergeUnsequencedLiveMessageItemsIntoTimeline(
  timelineItems: PlainConversationItem[],
  liveItems: PlainConversationItem[],
) {
  if (!timelineItems.length) {
    return [...liveItems].sort(compareUnsequencedPlainConversationItems);
  }
  if (!liveItems.length) {
    return timelineItems;
  }

  const merged = [...timelineItems];
  const sortedLiveItems = [...liveItems].sort(compareUnsequencedPlainConversationItems);
  for (const liveItem of sortedLiveItems) {
    const insertIndex = resolveUnsequencedLiveMessageInsertIndex(merged, liveItem);
    merged.splice(insertIndex, 0, liveItem);
  }
  return merged;
}

function resolveSequencedLiveMessageInsertIndex(
  items: PlainConversationItem[],
  liveItem: PlainConversationItem,
) {
  const liveSequence = liveItem.sequence;
  if (typeof liveSequence !== "number") {
    return items.length;
  }

  let fallbackIndex = items.length;
  for (let index = 0; index < items.length; index += 1) {
    const currentItem = items[index];
    if (!currentItem || typeof currentItem.sequence !== "number") {
      continue;
    }
    const timelineDelta = currentItem.sequence - liveSequence;
    const timestampDelta = comparePlainItemTimestamps(currentItem.timestamp, liveItem.timestamp);
    const sourceIndexDelta = comparePlainConversationSourceIndex(currentItem, liveItem);
    const sequenceResetTimestampDelta = compareSequenceResetTimestampDelta(
      timelineDelta,
      timestampDelta,
    );
    if (sequenceResetTimestampDelta !== null) {
      if (sourceIndexDelta !== null) {
        if (sourceIndexDelta > 0) {
          return index;
        }
        fallbackIndex = index + 1;
        continue;
      }
      if (sequenceResetTimestampDelta > 0) {
        return index;
      }
      fallbackIndex = index + 1;
      continue;
    }
    if (currentItem.sequence > liveSequence) {
      return index;
    }
    if (currentItem.sequence === liveSequence) {
      if (timestampDelta > 0) {
        return index;
      }
      if (sourceIndexDelta !== null) {
        if (sourceIndexDelta > 0) {
          return index;
        }
        fallbackIndex = index + 1;
        continue;
      }
    }
    fallbackIndex = index + 1;
  }
  return fallbackIndex;
}

function resolveUnsequencedLiveMessageInsertIndex(
  items: PlainConversationItem[],
  liveItem: PlainConversationItem,
) {
  for (let index = 0; index < items.length; index += 1) {
    const currentItem = items[index];
    if (!currentItem) {
      continue;
    }
    const timestampDelta = comparePlainItemTimestamps(currentItem.timestamp, liveItem.timestamp);
    if (timestampDelta > 0) {
      return index;
    }
    if (timestampDelta === 0) {
      const sourceIndexDelta = comparePlainConversationSourceIndex(currentItem, liveItem);
      if (sourceIndexDelta !== null) {
        if (sourceIndexDelta > 0) {
          return index;
        }
        continue;
      }
      if (plainConversationKindRank(currentItem) > plainConversationKindRank(liveItem)) {
        return index;
      }
    }
  }
  return items.length;
}

function compareUnsequencedPlainConversationItems(
  left: PlainConversationItem,
  right: PlainConversationItem,
) {
  const transcriptAnchorDelta = compareTranscriptEventAnchorSourceIndex(left, right);
  if (transcriptAnchorDelta !== null) {
    return transcriptAnchorDelta;
  }
  const timestampDelta = comparePlainItemTimestamps(left.timestamp, right.timestamp);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  const sourceIndexDelta = comparePlainConversationSourceIndex(left, right);
  if (sourceIndexDelta !== null) {
    return sourceIndexDelta;
  }
  return plainConversationKindRank(left) - plainConversationKindRank(right);
}

function resolveContinuationPrefaceMessageIds(messages: AgentMessage[]) {
  const markerIndex = messages.findIndex((message) =>
    looksLikeContinuationSummary(message.text)
  );
  if (markerIndex === -1) {
    return new Set<string>();
  }
  const ids = new Set<string>();
  for (let index = markerIndex; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (index > markerIndex && typeof message.sequence === "number") {
      break;
    }
    ids.add(message.id);
  }
  return ids;
}

function resolveContinuationPrefaceAnchor(
  messages: AgentMessage[],
  continuationPrefaceMessageIds: ReadonlySet<string>,
) {
  return messages.find((message) =>
    !continuationPrefaceMessageIds.has(message.id) &&
    typeof message.sequence === "number"
  );
}

function insertContinuationPrefaceItems(
  items: PlainConversationItem[],
  continuationPrefaceItems: PlainConversationItem[],
  anchor: AgentMessage | undefined,
) {
  if (!continuationPrefaceItems.length || !anchor) {
    return items;
  }
  const insertIndex = resolveContinuationPrefaceInsertIndex(items, anchor);
  const next = [...items];
  next.splice(
    insertIndex,
    0,
    ...continuationPrefaceItems.sort(compareUnsequencedPlainConversationItems),
  );
  return next;
}

function resolveContinuationPrefaceInsertIndex(
  items: PlainConversationItem[],
  anchor: AgentMessage,
) {
  const anchorSequence = anchor.sequence;
  if (typeof anchorSequence === "number") {
    for (let index = 0; index < items.length; index += 1) {
      if (items[index]?.sequence === anchorSequence) {
        return index;
      }
    }
    for (let index = 0; index < items.length; index += 1) {
      const currentSequence = items[index]?.sequence;
      if (typeof currentSequence === "number" && currentSequence > anchorSequence) {
        return index;
      }
    }
  }
  const anchorTime = Date.parse(anchor.timestamp);
  for (let index = 0; index < items.length; index += 1) {
    const currentItem = items[index];
    if (!currentItem) {
      continue;
    }
    const currentTime = Date.parse(currentItem.timestamp);
    if (Number.isFinite(currentTime) && currentTime >= anchorTime) {
      return index;
    }
  }
  return 0;
}

function collectTimelineMessageIds(timelineItems: SessionTimelineEntry[]) {
  const ids = new Set<string>();
  for (const entry of timelineItems) {
    if (entry.kind === "user_message" || entry.kind === "system_message") {
      ids.add(entry.message.id);
      continue;
    }
    if (entry.kind === "assistant_message") {
      const contentChunks = entry.chunks.filter(
        (chunk) => chunk.kind === "content" && Boolean(chunk.text.trim()),
      );
      if (contentChunks.length > 0) {
        ids.add(entry.id);
        for (const chunk of contentChunks) {
          ids.add(chunk.id);
        }
      }
    }
  }
  return ids;
}

type TimelineUserMessageAnchor = {
  id: string;
  entryId: string;
  text: string;
  timestamp: string;
  sequence?: number;
};

function resolveTimelineRepresentedUserMessageIds(
  entries: SessionTimelineEntry[],
  messages: AgentMessage[],
) {
  const candidates = messages.filter(
    (message) => message.role === "user" && Boolean(message.text.trim()),
  );
  const represented = new Set<string>();
  for (const anchor of collectTimelineUserMessageAnchors(entries)) {
    const matchIndex = findRepresentedUserMessageIndex(candidates, anchor);
    if (matchIndex === -1) {
      continue;
    }
    const [match] = candidates.splice(matchIndex, 1);
    if (match) {
      represented.add(match.id);
    }
  }
  return represented;
}

function collectTimelineUserMessageAnchors(
  entries: SessionTimelineEntry[],
): TimelineUserMessageAnchor[] {
  return entries.flatMap((entry) => {
    if (entry.kind !== "user_message") {
      return [];
    }
    return [{
      id: entry.message.id,
      entryId: entry.id,
      text: entry.message.text.trim(),
      timestamp: entry.message.timestamp,
      sequence: entry.message.sequence ?? entry.sequence,
    }];
  });
}

function findRepresentedUserMessageIndex(
  candidates: AgentMessage[],
  anchor: TimelineUserMessageAnchor,
) {
  const idMatchIndex = candidates.findIndex(
    (message) => message.id === anchor.id || message.id === anchor.entryId,
  );
  if (idMatchIndex !== -1) {
    return idMatchIndex;
  }

  let nearestIndex = -1;
  let nearestDelta = Number.POSITIVE_INFINITY;
  let textFallbackIndex = -1;
  for (const [index, message] of candidates.entries()) {
    if (message.text.trim() !== anchor.text) {
      continue;
    }
    if (textFallbackIndex === -1) {
      textFallbackIndex = index;
    }
    if (
      typeof anchor.sequence === "number" &&
      typeof message.sequence === "number" &&
      anchor.sequence === message.sequence
    ) {
      return index;
    }
    const delta = Math.abs(Date.parse(anchor.timestamp) - Date.parse(message.timestamp));
    if (
      Number.isFinite(delta) &&
      delta <= USER_PROMPT_REPRESENTATION_WINDOW_MS &&
      delta < nearestDelta
    ) {
      nearestDelta = delta;
      nearestIndex = index;
    }
  }
  return nearestIndex === -1 ? textFallbackIndex : nearestIndex;
}

function resolveTimelineRepresentedAssistantMessageIds(
  timelineItems: SessionTimelineEntry[],
  messages: AgentMessage[],
) {
  const candidates = messages.filter((message) =>
    message.role === "assistant" &&
    message.contentKind !== "thought" &&
    Boolean(message.text.trim())
  );
  const represented = new Set<string>();
  for (const snapshot of collectTimelineAssistantMessageSnapshots(timelineItems)) {
    const matchIndex = findRepresentedAssistantMessageIndex(candidates, snapshot);
    if (matchIndex === -1) {
      continue;
    }
    const [match] = candidates.splice(matchIndex, 1);
    if (match) {
      represented.add(match.id);
    }
  }
  return represented;
}

type TimelineAssistantMessageSnapshot = {
  id: string;
  text: string;
  timestamp: string;
  sequence?: number;
};

function collectTimelineAssistantMessageSnapshots(
  timelineItems: SessionTimelineEntry[],
): TimelineAssistantMessageSnapshot[] {
  const snapshots: TimelineAssistantMessageSnapshot[] = [];
  for (const entry of timelineItems) {
    if (entry.kind !== "assistant_message") {
      continue;
    }
    let cumulativeText = "";
    for (const chunk of entry.chunks) {
      if (chunk.kind !== "content") {
        continue;
      }
      cumulativeText += chunk.text;
      const text = cumulativeText.trim();
      if (!text) {
        continue;
      }
      snapshots.push({
        id: entry.id,
        text,
        timestamp: chunk.timestamp,
        sequence: chunk.sequence ?? entry.sequence,
      });
    }
  }
  return snapshots;
}

function findRepresentedAssistantMessageIndex(
  candidates: AgentMessage[],
  snapshot: TimelineAssistantMessageSnapshot,
) {
  const idMatchIndex = candidates.findIndex((message) => message.id === snapshot.id);
  if (idMatchIndex !== -1) {
    return idMatchIndex;
  }
  const snapshotText = normalizeComparableReplayText(snapshot.text);
  const snapshotTime = Date.parse(snapshot.timestamp);
  let nearestIndex = -1;
  let nearestDelta = Number.POSITIVE_INFINITY;
  for (const [index, message] of candidates.entries()) {
    if (normalizeComparableReplayText(message.text) !== snapshotText) {
      continue;
    }
    if (
      typeof snapshot.sequence === "number" &&
      typeof message.sequence === "number" &&
      snapshot.sequence === message.sequence
    ) {
      return index;
    }
    const messageTime = Date.parse(message.timestamp);
    const delta = Math.abs(messageTime - snapshotTime);
    if (Number.isFinite(delta) && delta <= USER_PROMPT_REPRESENTATION_WINDOW_MS && delta < nearestDelta) {
      nearestDelta = delta;
      nearestIndex = index;
    }
  }
  return nearestIndex;
}

function compareSequencedPlainConversationItems(
  left: PlainConversationItem,
  right: PlainConversationItem,
) {
  const transcriptAnchorDelta = compareTranscriptEventAnchorSourceIndex(left, right);
  if (transcriptAnchorDelta !== null) {
    return transcriptAnchorDelta;
  }
  const timelineDelta = compareOptionalTimelineSequence(
    left.sequence,
    right.sequence,
  );
  const timestampDelta = comparePlainItemTimestamps(left.timestamp, right.timestamp);
  const sourceIndexDelta = comparePlainConversationSourceIndex(left, right);
  if (timelineDelta !== null) {
    const sequenceResetTimestampDelta = compareSequenceResetTimestampDelta(
      timelineDelta,
      timestampDelta,
    );
    if (sequenceResetTimestampDelta !== null) {
      if (sourceIndexDelta !== null) {
        return sourceIndexDelta;
      }
      return sequenceResetTimestampDelta;
    }
    return timelineDelta;
  }
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  if (sourceIndexDelta !== null) {
    return sourceIndexDelta;
  }
  return plainConversationKindRank(left) - plainConversationKindRank(right);
}

function toPlainToolConversationItem(
  toolCall: ConversationToolCallItem,
  sourceIndex: number,
  flat = false,
): PlainConversationItem {
  if (flat) {
    return {
      kind: "tool",
      sourceIndex,
      timestamp: toolCall.timestamp,
      sequence: toolCall.sequence,
      toolCall,
    };
  }
  if (isSubagentToolCall(toolCall)) {
    return {
      kind: "subagent",
      sourceIndex,
      timestamp: toolCall.timestamp,
      sequence: toolCall.sequence,
      toolCall,
    };
  }
  return {
    kind: "tool-group",
    sourceIndex,
    timestamp: toolCall.timestamp,
    sequence: toolCall.sequence,
    group: [toolCall],
  };
}

function maybeMergeAdjacentToolItems(
  items: PlainConversationItem[],
  groupTools: boolean,
) {
  return groupTools ? mergeAdjacentToolItems(items) : items;
}

function isSubagentToolCall(toolCall: ConversationToolCallItem) {
  return toolCall.toolKind === "subagent";
}

function mergeAdjacentToolItems(
  items: PlainConversationItem[],
): PlainConversationItem[] {
  return items.reduce<PlainConversationItem[]>((merged, item) => {
    const last = merged.at(-1);
    if (last?.kind !== "tool-group" || item.kind !== "tool-group") {
      merged.push(item);
      return merged;
    }
    merged[merged.length - 1] = {
      kind: "tool-group",
      sourceIndex: last.sourceIndex,
      timestamp: last.timestamp,
      sequence: last.sequence ?? item.sequence,
      group: [...last.group, ...item.group],
    };
    return merged;
  }, []);
}

function mergeAdjacentThinkingItems(
  items: PlainConversationItem[],
): PlainConversationItem[] {
  return items.reduce<PlainConversationItem[]>((merged, item) => {
    const last = merged.at(-1);
    if (last?.kind !== "thinking" || item.kind !== "thinking") {
      merged.push(item);
      return merged;
    }

    const currentParts = last.thinkingParts ?? [last.thinking];
    const incomingParts = item.thinkingParts ?? [item.thinking];
    const currentPart = currentParts.at(-1);
    const incomingPart = incomingParts[0];
    if (!currentPart || !incomingPart) {
      merged.push(item);
      return merged;
    }

    const nextParts = shouldMergeAdjacentThinkingItems(currentPart, incomingPart)
      ? [
          ...currentParts.slice(0, -1),
          mergeThinkingChunks(currentPart, incomingPart),
          ...incomingParts.slice(1),
        ]
      : [...currentParts, ...incomingParts];

    merged[merged.length - 1] = {
      kind: "thinking",
      sourceIndex: last.sourceIndex,
      timestamp: last.timestamp,
      sequence: last.sequence ?? item.sequence,
      thinking: nextParts[0] ?? last.thinking,
      thinkingParts: nextParts.length > 1 ? nextParts : undefined,
    };
    return merged;
  }, []);
}

function shouldMergeAdjacentThinkingItems(
  current: SessionTimelineThinkingChunk,
  incoming: SessionTimelineThinkingChunk,
) {
  if (current.id === incoming.id) {
    return true;
  }
  if (!isGenericThinkingChunk(current) || !isGenericThinkingChunk(incoming)) {
    return false;
  }
  return areGenericThinkingSnapshotsCompatible(current, incoming);
}

function isGenericThinkingChunk(chunk: SessionTimelineThinkingChunk) {
  return /^thinking$/iu.test(chunk.title.trim());
}

function areGenericThinkingSnapshotsCompatible(
  current: SessionTimelineThinkingChunk,
  incoming: SessionTimelineThinkingChunk,
) {
  const currentText = current.text.trim();
  const incomingText = incoming.text.trim();
  if (!currentText || !incomingText) {
    return true;
  }
  return currentText === incomingText ||
    currentText.startsWith(incomingText) ||
    currentText.endsWith(incomingText) ||
    incomingText.startsWith(currentText) ||
    incomingText.endsWith(currentText);
}

function mergeAdjacentMessageItems(
  items: PlainConversationItem[],
): PlainConversationItem[] {
  return items.reduce<PlainConversationItem[]>((merged, item) => {
    const last = merged.at(-1);
    if (last?.kind !== "message" || item.kind !== "message") {
      merged.push(item);
      return merged;
    }

    const [mergedMessage, extraMessage] = mergeAgentMessages(
      [last.message],
      item.message,
    );
    if (!mergedMessage || extraMessage) {
      merged.push(item);
      return merged;
    }

    merged[merged.length - 1] = {
      kind: "message",
      sourceIndex: last.sourceIndex,
      timestamp: mergedMessage.timestamp,
      sequence: last.sequence ?? item.sequence,
      message: mergedMessage,
    };
    return merged;
  }, []);
}

function mergeThinkingChunks(
  current: SessionTimelineThinkingChunk,
  incoming: SessionTimelineThinkingChunk,
): SessionTimelineThinkingChunk {
  return {
    ...current,
    ...incoming,
    id: current.id,
    title: resolveMergedThinkingTitle(current.title, incoming.title),
    status: resolveMergedThinkingStatus(current.status, incoming.status),
    text: mergeThinkingText(current.text, incoming.text, incoming.streamMode),
    timestamp: current.timestamp,
    updatedAt: incoming.updatedAt,
  };
}

function resolveMergedThinkingTitle(
  current: AgentToolCall["title"],
  incoming: AgentToolCall["title"],
) {
  return /^thinking$/iu.test(current.trim()) ? incoming : current;
}

function resolveMergedThinkingStatus(
  _current: SessionTimelineThinkingChunk["status"],
  incoming: SessionTimelineThinkingChunk["status"],
) {
  return incoming;
}

function mergeThinkingText(
  current: string,
  incoming: string,
  streamMode: SessionTimelineThinkingChunk["streamMode"] | "auto" = "auto",
) {
  return mergeStreamingText(current, incoming, streamMode ?? "auto") ?? "";
}

function isAcpPromptWrapperEcho(message: AgentMessage, messages: AgentMessage[]) {
  if (message.role !== "user") {
    return false;
  }
  const text = message.text.trim();
  if (!text.includes("MANDATORY delegate_task params")) {
    return text === "---" || /^\[[a-z-]+mode\]/iu.test(text) || text.includes("SYNTHESIZE findings before proceeding.");
  }
  const originalPrompt = extractOpenCodeWrapperOriginalPrompt(text);
  return Boolean(
    originalPrompt &&
      messages.some(
        (candidate) =>
          candidate.id !== message.id &&
          candidate.role === "user" &&
          candidate.text.trim() === originalPrompt,
      ),
  );
}

function extractOpenCodeWrapperOriginalPrompt(text: string) {
  if (!/^\[[a-z-]+-mode\]/iu.test(text)) {
    return null;
  }
  return text.split(/\n---\n/u).at(-1)?.trim() || null;
}

function comparePlainConversationItems(left: PlainConversationItem, right: PlainConversationItem) {
  const transcriptAnchorDelta = compareTranscriptEventAnchorSourceIndex(left, right);
  if (transcriptAnchorDelta !== null) {
    return transcriptAnchorDelta;
  }
  const timestampDelta = comparePlainItemTimestamps(left.timestamp, right.timestamp);
  const timelineDelta = compareOptionalTimelineSequence(
    left.sequence,
    right.sequence,
  );
  if (timelineDelta !== null) {
    const sequenceResetTimestampDelta = compareSequenceResetTimestampDelta(
      timelineDelta,
      timestampDelta,
    );
    if (sequenceResetTimestampDelta !== null) {
      return sequenceResetTimestampDelta;
    }
    return timelineDelta;
  }
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  const sourceIndexDelta = comparePlainConversationSourceIndex(left, right);
  if (sourceIndexDelta !== null) {
    return sourceIndexDelta;
  }
  return plainConversationKindRank(left) - plainConversationKindRank(right);
}

function compareOptionalTimelineSequence(
  left: number | undefined,
  right: number | undefined,
) {
  if (left === undefined || right === undefined) {
    return null;
  }
  const sequenceDelta = left - right;
  return sequenceDelta === 0 ? null : sequenceDelta;
}

function compareSequenceResetTimestampDelta(
  timelineDelta: number,
  timestampDelta: number,
) {
  if (
    timestampDelta === 0 ||
    Math.abs(timestampDelta) < TIMELINE_SEQUENCE_RESET_TIMESTAMP_GAP_MS
  ) {
    return null;
  }
  return Math.sign(timelineDelta) === Math.sign(timestampDelta)
    ? null
    : timestampDelta;
}

function comparePlainItemTimestamps(leftTimestamp: string, rightTimestamp: string) {
  const leftTime = Date.parse(leftTimestamp);
  const rightTime = Date.parse(rightTimestamp);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return 0;
  }
  return leftTime - rightTime;
}

function comparePlainConversationSourceIndex(
  left: PlainConversationItem,
  right: PlainConversationItem,
) {
  if (typeof left.sourceIndex !== "number" || typeof right.sourceIndex !== "number") {
    return null;
  }
  const sourceIndexDelta = left.sourceIndex - right.sourceIndex;
  return sourceIndexDelta === 0 ? null : sourceIndexDelta;
}

function compareTranscriptEventAnchorSourceIndex(
  left: PlainConversationItem,
  right: PlainConversationItem,
) {
  if (left.kind !== "transcript-event" && right.kind !== "transcript-event") {
    return null;
  }
  return comparePlainConversationSourceIndex(left, right);
}

function plainConversationKindRank(item: PlainConversationItem) {
  if (item.kind === "thinking") {
    return 0;
  }
  if (item.kind === "subagent") {
    return 1;
  }
  if (item.kind === "tool" || item.kind === "tool-group") {
    return 2;
  }
  return 3;
}
