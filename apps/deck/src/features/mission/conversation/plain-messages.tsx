import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  AgentMessage,
  AgentToolCall,
  SessionTimelineEntry,
} from "@tiller/shared";
import {
  normalizeComparableReplayText,
  isTranscriptEventEntry,
  looksLikeCompactionLifecycleMessage,
  looksLikeContinuationSummary,
} from "@tiller/shared";
import { normalizeLocalCommandMessageText } from "../../../shared/utils/local-command-message";
import { cn } from "../../../shared/utils/cn";
import {
  coalesceDisplayMessages,
  groupToolCalls,
  mergeAgentMessages,
  sortAgentMessagesByTimeline,
  type ConversationToolCallItem,
} from "../../logbook";
import { PlainMessageItem, PlainSubagentItem, PlainThinkingItem, PlainToolGroupItem } from "./plain-message-items";
import { TranscriptEventRow } from "./transcript-event-row";

export const INITIAL_PLAIN_MESSAGE_RENDER_LIMIT = 96;
export const PLAIN_MESSAGE_RENDER_LOAD_STEP = 96;
const PLAIN_MESSAGE_TOP_LOAD_THRESHOLD_PX = 200;
const PLAIN_HISTORY_REVEAL_LOCK_DATASET_KEY = "plainHistoryRevealLock";
const PLAIN_HISTORY_REVEAL_UNLOCK_DELAY_MS = 220;

type PlainMessagesProps = {
  sessionId: string | null;
  items: AgentMessage[];
  timelineItems?: SessionTimelineEntry[];
  thinkingToolCalls?: AgentToolCall[];
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
};

export function PlainMessages({
  sessionId,
  items,
  timelineItems = [],
  thinkingToolCalls = [],
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
}: PlainMessagesProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const localScrollSnapshotRef = useRef<ScrollSnapshot | null>(null);
  const olderLoadRequestedRef = useRef(false);
  const pendingRemoteHistoryRevealRef = useRef(false);
  const remoteHistoryRevealBaselineRef = useRef<RemoteHistoryRevealBaseline | null>(null);
  const renderRevealRequestedRef = useRef(false);
  const historyRevealUnlockTimeoutRef = useRef<number | null>(null);
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
    timelineCacheRef.current = { items: [], sessionId };
    setVisibleItemLimit(INITIAL_PLAIN_MESSAGE_RENDER_LIMIT);
    setDismissedSystemMessageIds(new Set());
  }, [sessionId]);

  if (timelineCacheRef.current.sessionId !== sessionId) {
    timelineCacheRef.current = { items: [], sessionId };
  }
  if (timelineItems.length > 0) {
    timelineCacheRef.current = { items: timelineItems, sessionId };
  }
  const effectiveTimelineItems =
    timelineItems.length > 0 || !historyState?.loading
      ? timelineItems
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
      thinkingToolCalls,
      toolCalls,
    }),
    [
      displayMessages,
      effectiveTimelineItems,
      historyState?.hasMore,
      sessionId,
      showThinking,
      thinkingToolCalls,
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
    if (shouldPrimeOlderHistoryLoad({
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      canLoadMore: hasHiddenLoadedItems || Boolean(historyState?.canLoadMore ?? historyState?.hasMore),
    })) {
      loadOlderWhenScrolledToTop();
    }
    return () => container.removeEventListener("scroll", loadOlderWhenScrolledToTop);
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

  if (!displayItems.length) {
    return <div className="empty-state rounded-md border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">{emptyText}</div>;
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
                item={renderItem.toolCall}
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
        if (renderItem.kind === "subagent") {
          return (
            <div key={renderItem.renderKey} className={spacingClassName}>
              <PlainSubagentItem
                item={renderItem.toolCall}
                hasNewerContent={index < renderMessages.length - 1}
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
            />
          </div>
        );
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
  | { kind: "thinking"; sourceIndex?: number; timestamp: string; sequence?: number; toolCall: AgentToolCall }
  | { kind: "subagent"; sourceIndex?: number; timestamp: string; sequence?: number; toolCall: ConversationToolCallItem }
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
      toolCall: AgentToolCall;
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
      const baseKey = `thinking-${item.toolCall.id}`;
      const seenCount = seenKeys.get(baseKey) ?? 0;
      seenKeys.set(baseKey, seenCount + 1);
      return {
        kind: "thinking",
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
    return resolveToolRenderSignaturePart(
      item.renderKey,
      item.toolCall,
      item.toolCall.output ?? "",
      item.toolCall.input ?? "",
    );
  }
  if (item.kind === "subagent") {
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
  toolCall: AgentToolCall | ConversationToolCallItem,
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
  const sortedMessages = sortAgentMessagesByTimeline(items);
  return coalesceDisplayMessages(
    sortedMessages.filter(
      (message) => !isAcpPromptWrapperEcho(message, sortedMessages),
    ),
    boundaryTimestamps,
  );
}

export function resolvePlainDisplayMessages(
  items: AgentMessage[],
  boundaryTimestamps: string[] = [],
) {
  return sortDisplayMessages(items, boundaryTimestamps);
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
  sessionId: _sessionId,
  displayMessages,
  timelineItems,
  showThinking,
  thinkingToolCalls,
  toolCalls,
}: {
  sessionId?: string | null;
  displayMessages: AgentMessage[];
  timelineItems: SessionTimelineEntry[];
  showThinking: boolean;
  thinkingToolCalls: AgentToolCall[];
  toolCalls: AgentToolCall[];
}) {
  if (!timelineItems.length) {
    return buildPlainConversationItems(
      displayMessages,
      showThinking ? thinkingToolCalls : [],
      toolCalls,
      showThinking,
    );
  }

  const canonicalItems = buildPlainConversationItemsFromTimeline(timelineItems, showThinking);
  const canonicalToolCallIds = new Set(
    timelineItems.flatMap((entry) => {
      if (entry.kind === "tool_call") {
        return [entry.toolCall.id];
      }
      if (entry.kind === "assistant_message") {
        return entry.chunks.flatMap((chunk) => chunk.kind === "thinking" ? [chunk.id] : []);
      }
      return [];
    }),
  );
  const liveToolItems = groupToolCalls(
    toolCalls.filter((toolCall) =>
      toolCall.kind !== "think" && !canonicalToolCallIds.has(toolCall.id)
    ),
  ).map((toolCall, index) =>
    toPlainToolConversationItem(toolCall, canonicalItems.length + index)
  );
  const canonicalAndLiveItems = liveToolItems.length
    ? mergeAdjacentToolItems(
        mergeAdjacentThinkingItems(
          [...canonicalItems, ...liveToolItems].sort(comparePlainConversationItems),
        ),
      )
    : canonicalItems;
  const optimisticMessages = resolveOptimisticTimelineSupplementMessages(
    displayMessages,
    timelineItems,
  );
  if (!optimisticMessages.length) {
    return canonicalAndLiveItems;
  }

  const optimisticItems = buildPlainConversationItems(
    optimisticMessages,
    [],
    [],
    showThinking,
  );
  return mergeAdjacentToolItems(
    mergeAdjacentThinkingItems(
      [...canonicalAndLiveItems, ...optimisticItems],
    ),
  );
}

function resolveOptimisticTimelineSupplementMessages(
  displayMessages: AgentMessage[],
  timelineItems: SessionTimelineEntry[],
) {
  const canonicalMessageIds = new Set(
    timelineItems.flatMap((entry) => {
      if (entry.kind === "user_message" || entry.kind === "system_message") {
        return [entry.message.id];
      }
      if (entry.kind === "assistant_message") {
        return [entry.id];
      }
      return [];
    }),
  );
  const canonicalAssistantMessages = timelineItems.flatMap((entry) => {
    if (entry.kind !== "assistant_message") {
      return [];
    }
    return entry.chunks.flatMap((chunk) => {
      if (chunk.kind !== "content" || !chunk.text.trim()) {
        return [];
      }
      return [{
        id: chunk.id,
        role: "assistant" as const,
        text: chunk.text,
        timestamp: chunk.timestamp,
        sequence: chunk.sequence,
        streaming: chunk.streaming,
      }];
    });
  });

  return displayMessages.filter((message) => {
    if (canonicalMessageIds.has(message.id)) {
      return false;
    }
    if (message.role === "user") {
      return true;
    }
    return message.role === "assistant" &&
      message.streaming === true &&
      !isRepresentedOptimisticAssistantMessage(message, canonicalAssistantMessages);
  });
}

function isRepresentedOptimisticAssistantMessage(
  message: AgentMessage,
  canonicalAssistantMessages: AgentMessage[],
) {
  const normalizedMessageText = normalizeComparableReplayText(message.text);
  if (!normalizedMessageText) {
    return false;
  }
  const optimisticTime = Date.parse(message.timestamp);
  return canonicalAssistantMessages.some((canonicalMessage) => {
    const normalizedCanonicalText = normalizeComparableReplayText(canonicalMessage.text);
    if (
      !normalizedCanonicalText ||
      (
        !normalizedCanonicalText.includes(normalizedMessageText) &&
        !normalizedMessageText.includes(normalizedCanonicalText)
      )
    ) {
      return false;
    }
    const canonicalTime = Date.parse(canonicalMessage.timestamp);
    if (!Number.isFinite(optimisticTime) || !Number.isFinite(canonicalTime)) {
      return true;
    }
    return canonicalTime >= optimisticTime - 15_000;
  });
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
  item: PlainMessageRenderSource,
): PlainConversationItem | null {
  if ("role" in item) {
    const text = normalizeLocalCommandMessageText(item.text);
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
  if (item.kind === "message") {
    const text = normalizeLocalCommandMessageText(item.message.text);
    if (!text) {
      return null;
    }
    return {
      ...item,
      message: text === item.message.text ? item.message : { ...item.message, text },
    };
  }
  return item;
}

function buildPlainConversationItems(
  messages: AgentMessage[],
  thinkingToolCalls: AgentToolCall[],
  toolCalls: AgentToolCall[],
  showThinking: boolean,
): PlainConversationItem[] {
  const visibleToolCalls = toolCalls.filter((toolCall) => toolCall.kind !== "think");
  const messageItems = messages.flatMap<PlainConversationItem>((message, index) => {
    if (message.role === "assistant" && message.contentKind === "thought") {
      return showThinking
        ? [{
            kind: "thinking",
            sourceIndex: index,
            timestamp: message.timestamp,
            sequence: message.sequence,
            toolCall: {
              id: `${message.id}:thinking`,
              kind: "think",
              title: "Thinking",
              status: message.streaming === false ? "completed" : "running",
              output: message.text,
              timestamp: message.timestamp,
              updatedAt: message.timestamp,
              sequence: message.sequence,
            },
          }]
        : [];
    }
    const text = normalizeLocalCommandMessageText(message.text);
    return text
      ? [{ kind: "message" as const, sourceIndex: index, timestamp: message.timestamp, sequence: message.sequence, message: text === message.text ? message : { ...message, text } }]
      : [];
  });
  const thinkingItems = thinkingToolCalls.map((toolCall, index) => ({
    kind: "thinking" as const,
    sourceIndex: messages.length + index,
    timestamp: toolCall.timestamp,
    sequence: toolCall.sequence,
    toolCall,
  }));
  const toolItems = groupToolCalls(visibleToolCalls).map((toolCall, index) => toPlainToolConversationItem(
    toolCall,
    messages.length + thinkingItems.length + index,
  ));
  const sorted = [...messageItems, ...thinkingItems, ...toolItems].sort(comparePlainConversationItems);
  return mergeAdjacentToolItems(mergeAdjacentThinkingItems(sorted));
}

function buildPlainConversationItemsFromTimeline(
  timelineItems: SessionTimelineEntry[],
  showThinking: boolean,
): PlainConversationItem[] {
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
      const text = normalizeLocalCommandMessageText(entry.message.text);
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
              toolCall: {
                id: chunk.id,
                kind: "think",
                title: chunk.title,
                status: chunk.status,
                output: chunk.text,
                timestamp: chunk.timestamp,
                updatedAt: chunk.updatedAt,
                sequence: chunk.sequence,
              },
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
        const text = normalizeLocalCommandMessageText(chunk.text);
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
        ));
        sourceIndex += 1;
      }
    }
  }

  const orderedItems = [...items].sort(compareSequencedPlainConversationItems);
  return mergeAdjacentToolItems(
    mergeAdjacentThinkingItems(mergeAdjacentMessageItems(orderedItems)),
  );
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
  const sourceIndexDelta = comparePlainConversationSourceIndex(left, right);
  if (timelineDelta !== null) {
    return timelineDelta;
  }
  if (sourceIndexDelta !== null) {
    return sourceIndexDelta;
  }
  return plainConversationKindRank(left) - plainConversationKindRank(right);
}

function toPlainToolConversationItem(
  toolCall: ConversationToolCallItem,
  sourceIndex: number,
): PlainConversationItem {
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
    if (
      last?.kind !== "thinking" ||
      item.kind !== "thinking" ||
      !shouldMergeAdjacentThinkingItems(last.toolCall, item.toolCall)
    ) {
      merged.push(item);
      return merged;
    }

    merged[merged.length - 1] = {
      kind: "thinking",
      sourceIndex: last.sourceIndex,
      timestamp: last.timestamp,
      sequence: last.sequence ?? item.sequence,
      toolCall: mergeThinkingToolCalls(last.toolCall, item.toolCall),
    };
    return merged;
  }, []);
}

function shouldMergeAdjacentThinkingItems(
  current: AgentToolCall,
  incoming: AgentToolCall,
) {
  if (current.id === incoming.id) {
    return true;
  }
  if (!isGenericThinkingToolCall(current) || !isGenericThinkingToolCall(incoming)) {
    return false;
  }
  return areGenericThinkingSnapshotsCompatible(current, incoming);
}

function isGenericThinkingToolCall(toolCall: AgentToolCall) {
  return /^thinking$/iu.test(toolCall.title.trim());
}

function areGenericThinkingSnapshotsCompatible(
  current: AgentToolCall,
  incoming: AgentToolCall,
) {
  const currentText = resolveThinkingToolCallText(current);
  const incomingText = resolveThinkingToolCallText(incoming);
  if (!currentText || !incomingText) {
    return true;
  }
  return currentText === incomingText ||
    currentText.startsWith(incomingText) ||
    currentText.endsWith(incomingText) ||
    incomingText.startsWith(currentText) ||
    incomingText.endsWith(currentText);
}

function resolveThinkingToolCallText(toolCall: AgentToolCall) {
  return (toolCall.output ?? toolCall.input ?? "").trim();
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

function mergeThinkingToolCalls(
  current: AgentToolCall,
  incoming: AgentToolCall,
): AgentToolCall {
  return {
    ...current,
    ...incoming,
    id: current.id,
    title: resolveMergedThinkingTitle(current.title, incoming.title),
    status: resolveMergedThinkingStatus(current.status, incoming.status),
    output: mergeThinkingText(current.output, incoming.output),
    input: mergeThinkingText(current.input, incoming.input),
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
  _current: AgentToolCall["status"],
  incoming: AgentToolCall["status"],
) {
  return incoming;
}

function mergeThinkingText(
  current: string | undefined,
  incoming: string | undefined,
) {
  if (!current) {
    return incoming;
  }
  if (!incoming || current.endsWith(incoming)) {
    return current;
  }
  if (incoming.startsWith(current)) {
    return incoming;
  }
  return `${current}\n\n${incoming}`;
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
  const timelineDelta = compareOptionalTimelineSequence(
    left.sequence,
    right.sequence,
  );
  if (timelineDelta !== null) {
    return timelineDelta;
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
  if (item.kind === "tool-group") {
    return 2;
  }
  return 3;
}
