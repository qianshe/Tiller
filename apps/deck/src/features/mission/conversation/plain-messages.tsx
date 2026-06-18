import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentMessage, AgentToolCall, SessionTimelineEntry } from "@tiller/shared";
import { resolveTimelineRepresentedUserMessageIds } from "@tiller/shared";
import { looksLikeContinuationSummary } from "../../../shared/utils/continuation-summary";
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

export const INITIAL_PLAIN_MESSAGE_RENDER_LIMIT = 96;
export const PLAIN_MESSAGE_RENDER_LOAD_STEP = 96;
const TIMELINE_SEQUENCE_RESET_TIMESTAMP_GAP_MS = 60_000;

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
    timelineHasMore?: boolean;
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
  const timelineCacheRef = useRef<{
    items: SessionTimelineEntry[];
    sessionId: string | null;
  }>({ items: [], sessionId: null });
  const [visibleItemLimit, setVisibleItemLimit] = useState(INITIAL_PLAIN_MESSAGE_RENDER_LIMIT);
  const [dismissedSystemMessageIds, setDismissedSystemMessageIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
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
      timelineHasMore: Boolean(historyState?.timelineHasMore),
    }),
    [displayMessages, effectiveTimelineItems, historyState?.timelineHasMore, showThinking, thinkingToolCalls, toolCalls],
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
      captureScrollSnapshot();
      renderRevealRequestedRef.current = true;
      setVisibleItemLimit((currentLimit) => resolveNextPlainConversationRenderLimit(
        currentLimit,
        displayItems.length,
      ));
    }

    function loadOlderWhenScrolledToTop() {
      if (olderLoadRequestedRef.current || container.scrollTop > 200) {
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
      olderLoadRequestedRef.current = true;
      pendingRemoteHistoryRevealRef.current = true;
      remoteHistoryRevealBaselineRef.current = {
        displayItemsLength: displayItems.length,
        visibleRenderSignature,
      };
      onLoadOlderMessages();
    }

    container.addEventListener("scroll", loadOlderWhenScrolledToTop, { passive: true });
    if (shouldAutoLoadOlderHistory({
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    })) {
      loadOlderWhenScrolledToTop();
    }
    return () => container.removeEventListener("scroll", loadOlderWhenScrolledToTop);
  }, [displayItems.length, hasHiddenLoadedItems, historyState?.canLoadMore, historyState?.hasMore, historyState?.loading, onLoadOlderMessages, visibleRenderSignature]);

  useEffect(() => {
    renderRevealRequestedRef.current = false;
    const snapshot = localScrollSnapshotRef.current;
    const scrollContainer = resolvePlainMessageScrollContainer(listRef.current);
    if (!snapshot || !scrollContainer) {
      return;
    }
    
    // Use requestAnimationFrame to ensure DOM is fully rendered before adjusting scroll
    requestAnimationFrame(() => {
      const newScrollTop = scrollContainer.scrollHeight - snapshot.scrollHeight + snapshot.scrollTop;
      scrollContainer.scrollTo({
        top: newScrollTop,
        behavior: 'instant'
      });
      localScrollSnapshotRef.current = null;
    });
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

type ScrollSnapshot = { scrollHeight: number; scrollTop: number };

export type RemoteHistoryRevealBaseline = {
  displayItemsLength: number;
  visibleRenderSignature: string;
};

type PlainConversationItem =
  | { kind: "message"; sourceIndex?: number; timestamp: string; timelineSequence?: number; message: AgentMessage }
  | { kind: "thinking"; sourceIndex?: number; timestamp: string; timelineSequence?: number; toolCall: AgentToolCall }
  | { kind: "subagent"; sourceIndex?: number; timestamp: string; timelineSequence?: number; toolCall: ConversationToolCallItem }
  | { kind: "tool-group"; sourceIndex?: number; timestamp: string; timelineSequence?: number; group: ConversationToolCallItem[] };

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
      const baseKey = `tool-group-${item.group.map((tool) => tool.id).join("-")}`;
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
  return [
    item.renderKey,
    ...item.group.map((toolCall) => resolveToolRenderSignaturePart(
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
  const firstMessageIndex = items.findIndex((item) => item.kind === "message");
  return firstMessageIndex >= 0 ? items.slice(firstMessageIndex) : [];
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

export function resolvePlainMessageScrollContainer(
  listElement: HTMLDivElement | null,
): HTMLElement | null {
  return listElement?.closest<HTMLElement>("[data-session-card-body]") ?? listElement?.parentElement ?? null;
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

export function resolvePlainConversationDisplayItems({
  sessionId,
  displayMessages,
  timelineItems,
  showThinking,
  thinkingToolCalls,
  toolCalls,
  timelineHasMore,
}: {
  sessionId?: string | null;
  displayMessages: AgentMessage[];
  timelineItems: SessionTimelineEntry[];
  showThinking: boolean;
  thinkingToolCalls: AgentToolCall[];
  toolCalls: AgentToolCall[];
  timelineHasMore: boolean;
}) {
  return timelineItems.length
    ? buildPlainConversationItemsFromTimelineWithLiveMessages(
        sessionId,
        timelineItems,
        displayMessages,
        showThinking,
        timelineHasMore,
      )
    : buildPlainConversationItems(
        displayMessages,
        showThinking ? thinkingToolCalls : [],
        toolCalls,
      );
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
      timelineSequence: item.timelineSequence,
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
): PlainConversationItem[] {
  const visibleToolCalls = toolCalls.filter((toolCall) => toolCall.kind !== "think");
  const messageItems = messages.flatMap((message, index) => {
    const text = normalizeLocalCommandMessageText(message.text);
    return text
      ? [{ kind: "message" as const, sourceIndex: index, timestamp: message.timestamp, timelineSequence: message.timelineSequence, message: text === message.text ? message : { ...message, text } }]
      : [];
  });
  const thinkingItems = thinkingToolCalls.map((toolCall, index) => ({
    kind: "thinking" as const,
    sourceIndex: messageItems.length + index,
    timestamp: toolCall.timestamp,
    timelineSequence: toolCall.timelineSequence,
    toolCall,
  }));
  const toolItems = groupToolCalls(visibleToolCalls).map((toolCall, index) => toPlainToolConversationItem(
    toolCall,
    messageItems.length + thinkingItems.length + index,
  ));
  const sorted = [...messageItems, ...thinkingItems, ...toolItems].sort(comparePlainConversationItems);
  return mergeAdjacentToolItems(mergeAdjacentThinkingItems(sorted));
}

function buildPlainConversationItemsFromTimeline(
  timelineItems: SessionTimelineEntry[],
  showThinking: boolean,
): PlainConversationItem[] {
  const items: PlainConversationItem[] = [];
  let sourceIndex = 0;

  for (const entry of timelineItems) {
    if (entry.kind === "user_message" || entry.kind === "system_message") {
      const text = normalizeLocalCommandMessageText(entry.message.text);
      if (text) {
        items.push({
          kind: "message",
          sourceIndex,
          timestamp: entry.timestamp,
          timelineSequence: entry.timelineSequence,
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
              timelineSequence: chunk.timelineSequence,
              toolCall: {
                id: chunk.id,
                kind: "think",
                title: chunk.title,
                status: chunk.status,
                output: chunk.text,
                timestamp: chunk.timestamp,
                updatedAt: chunk.updatedAt,
                timelineSequence: chunk.timelineSequence,
              },
            });
            sourceIndex += 1;
          }
          continue;
        }

        const text = normalizeLocalCommandMessageText(chunk.text);
        if (text) {
          items.push({
            kind: "message",
            sourceIndex,
            timestamp: chunk.timestamp,
            timelineSequence: chunk.timelineSequence,
            message: {
              id: entry.id,
              role: "assistant",
              text,
              timestamp: chunk.timestamp,
              timelineSequence: chunk.timelineSequence,
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
            timelineSequence: entry.timelineSequence,
          },
          sourceIndex,
        ));
        sourceIndex += 1;
      }
    }
  }

  return mergeAdjacentToolItems(
    mergeAdjacentThinkingItems(mergeAdjacentMessageItems(items)),
  );
}

function buildPlainConversationItemsFromTimelineWithLiveMessages(
  sessionId: string | null | undefined,
  timelineItems: SessionTimelineEntry[],
  messages: AgentMessage[],
  showThinking: boolean,
  omitMessagesBeforeTimelineWindow: boolean,
): PlainConversationItem[] {
  const timelineConversationItems = buildPlainConversationItemsFromTimeline(
    timelineItems,
    showThinking,
  );
  const timelineMessageIds = collectTimelineMessageIds(timelineItems);
  const representedLiveUserMessageIds = resolveTimelineRepresentedUserMessageIds(
    timelineItems,
    messages,
  );
  const continuationPrefaceMessageIds = resolveContinuationPrefaceMessageIds(messages);
  const continuationPrefaceAnchor = resolveContinuationPrefaceAnchor(
    messages,
    continuationPrefaceMessageIds,
  );
  const timelineWindowLowerBound = resolveTimelineWindowLowerBound(timelineItems);
  const liveMessageItems = messages.flatMap((message, index) => {
    if (
      timelineMessageIds.has(message.id) ||
      representedLiveUserMessageIds.has(message.id) ||
      (
        omitMessagesBeforeTimelineWindow &&
        isMessageBeforeTimelineWindow(message, timelineWindowLowerBound)
      )
    ) {
      return [];
    }
    const text = normalizeLocalCommandMessageText(message.text);
    return text
      ? [{
          kind: "message" as const,
          sourceIndex: timelineConversationItems.length + index,
          timestamp: message.timestamp,
          timelineSequence: message.timelineSequence,
          message: text === message.text ? message : { ...message, text },
        }]
      : [];
  });
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

  if (!regularLiveMessageItems.length && !continuationPrefaceItems.length) {
    return timelineConversationItems;
  }

  const sequencedLiveMessageItems = regularLiveMessageItems.filter(
    (item) => typeof item.timelineSequence === "number",
  );
  const unsequencedLiveMessageItems = regularLiveMessageItems.filter(
    (item) => typeof item.timelineSequence !== "number",
  );
  const optimisticUnsequencedLiveMessageItems = unsequencedLiveMessageItems.filter(
    (item) => item.kind === "message" && isOptimisticLiveMessage(sessionId, item.message),
  );
  const historicalUnsequencedLiveMessageItems = unsequencedLiveMessageItems.filter(
    (item) => item.kind !== "message" || !isOptimisticLiveMessage(sessionId, item.message),
  );
  const mergedSequencedTimelineItems = mergeSequencedLiveMessageItemsIntoTimeline(
    timelineConversationItems,
    sequencedLiveMessageItems,
  );
  const mergedTimelineAndLiveItems = mergeUnsequencedLiveMessageItemsIntoTimeline(
    mergedSequencedTimelineItems,
    historicalUnsequencedLiveMessageItems,
  );
  const mergedSequencedItems = mergeAdjacentToolItems(
    mergeAdjacentThinkingItems(mergeAdjacentMessageItems(mergedTimelineAndLiveItems)),
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

function isOptimisticLiveMessage(
  sessionId: string | null | undefined,
  message: AgentMessage,
) {
  if (!sessionId) {
    return false;
  }
  if (message.role === "user") {
    return message.id.startsWith(`${sessionId}-user-`);
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
  const liveSequence = liveItem.timelineSequence;
  if (typeof liveSequence !== "number") {
    return items.length;
  }

  let fallbackIndex = items.length;
  for (let index = 0; index < items.length; index += 1) {
    const currentItem = items[index];
    if (!currentItem) {
      continue;
    }
    const currentSequence = currentItem.timelineSequence;
    if (typeof currentSequence !== "number") {
      continue;
    }
    if (currentSequence > liveSequence) {
      return index;
    }
    if (currentSequence === liveSequence) {
      const timestampDelta = comparePlainItemTimestamps(currentItem.timestamp, liveItem.timestamp);
      if (timestampDelta > 0) {
        return index;
      }
    }
    fallbackIndex = index + 1;
  }
  return fallbackIndex;
}

function compareSequencedPlainConversationItems(
  left: PlainConversationItem,
  right: PlainConversationItem,
) {
  const timelineDelta = compareOptionalTimelineSequence(
    left.timelineSequence,
    right.timelineSequence,
  );
  if (timelineDelta !== null) {
    return timelineDelta;
  }
  const timestampDelta = comparePlainItemTimestamps(left.timestamp, right.timestamp);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return plainConversationKindRank(left) - plainConversationKindRank(right);
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
    if (
      timestampDelta === 0 &&
      plainConversationKindRank(currentItem) > plainConversationKindRank(liveItem)
    ) {
      return index;
    }
  }
  return items.length;
}

function compareUnsequencedPlainConversationItems(
  left: PlainConversationItem,
  right: PlainConversationItem,
) {
  const timestampDelta = comparePlainItemTimestamps(left.timestamp, right.timestamp);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return plainConversationKindRank(left) - plainConversationKindRank(right);
}

type TimelineWindowLowerBound = {
  timestamp?: string;
  timelineSequence?: number;
};

function resolveTimelineWindowLowerBound(
  timelineItems: SessionTimelineEntry[],
): TimelineWindowLowerBound | undefined {
  const first = timelineItems[0];
  if (!first) {
    return undefined;
  }
  if (first.kind === "assistant_message") {
    const firstChunk = first.chunks[0];
    return {
      timestamp: firstChunk?.timestamp ?? first.timestamp,
      timelineSequence: firstChunk?.timelineSequence ?? first.timelineSequence,
    };
  }
  if (first.kind === "tool_call") {
    return {
      timestamp: first.timestamp,
      timelineSequence: first.timelineSequence ?? first.toolCall.timelineSequence,
    };
  }
  return {
    timestamp: first.timestamp,
    timelineSequence: first.timelineSequence ?? first.message.timelineSequence,
  };
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
    if (index > markerIndex && typeof message.timelineSequence === "number") {
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
    typeof message.timelineSequence === "number"
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
  const anchorSequence = anchor.timelineSequence;
  if (typeof anchorSequence === "number") {
    for (let index = 0; index < items.length; index += 1) {
      const currentItem = items[index];
      if (currentItem?.timelineSequence === anchorSequence) {
        return index;
      }
    }
    for (let index = 0; index < items.length; index += 1) {
      const currentItem = items[index];
      if (
        typeof currentItem?.timelineSequence === "number" &&
        currentItem.timelineSequence > anchorSequence
      ) {
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

function isMessageBeforeTimelineWindow(
  message: AgentMessage,
  lowerBound: TimelineWindowLowerBound | undefined,
) {
  if (!lowerBound) {
    return false;
  }
  if (
    typeof message.timelineSequence === "number" &&
    typeof lowerBound.timelineSequence === "number"
  ) {
    return message.timelineSequence < lowerBound.timelineSequence;
  }
  const messageTime = Date.parse(message.timestamp);
  const lowerBoundTime = lowerBound.timestamp ? Date.parse(lowerBound.timestamp) : Number.NaN;
  return Number.isFinite(messageTime) &&
    Number.isFinite(lowerBoundTime) &&
    messageTime < lowerBoundTime;
}

function collectTimelineMessageIds(timelineItems: SessionTimelineEntry[]) {
  const ids = new Set<string>();
  for (const entry of timelineItems) {
    if (entry.kind === "user_message" || entry.kind === "system_message") {
      ids.add(entry.message.id);
      continue;
    }
    if (entry.kind === "assistant_message") {
      ids.add(entry.id);
    }
  }
  return ids;
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
      timelineSequence: toolCall.timelineSequence,
      toolCall,
    };
  }
  return {
    kind: "tool-group",
    sourceIndex,
    timestamp: toolCall.timestamp,
    timelineSequence: toolCall.timelineSequence,
    group: [toolCall],
  };
}

function isSubagentToolCall(toolCall: ConversationToolCallItem) {
  if (toolCall.toolKind === "subagent") {
    return true;
  }
  const input = parseToolInputRecord(toolCall.input);
  if (!input) {
    return false;
  }
  if (typeof input.subagent_type === "string" || typeof input.subagentType === "string") {
    return true;
  }
  if (typeof input.agent_type === "string" || typeof input.agentType === "string") {
    return true;
  }
  return typeof input.task_id === "string" &&
    (input.run_in_background === true || toolCall.title.startsWith("background_"));
}

function parseToolInputRecord(input: string) {
  const trimmed = input.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
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
      timelineSequence: last.timelineSequence ?? item.timelineSequence,
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
      timelineSequence: last.timelineSequence ?? item.timelineSequence,
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
  const currentText = resolveThinkingText(current);
  const incomingText = resolveThinkingText(incoming);
  if (!currentText || !incomingText) {
    return true;
  }
  return incomingText.startsWith(currentText) || currentText.endsWith(incomingText);
}

function isGenericThinkingToolCall(toolCall: AgentToolCall) {
  return /^thinking$/iu.test(toolCall.title.trim());
}

function resolveThinkingText(toolCall: AgentToolCall) {
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
      timelineSequence: last.timelineSequence ?? item.timelineSequence,
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
    output: mergeOptionalText(current.output, incoming.output),
    input: mergeOptionalText(current.input, incoming.input),
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

function mergeOptionalText(
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
  return `${current}${incoming}`;
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
  const timestampDelta = comparePlainItemTimestamps(left.timestamp, right.timestamp);
  const timelineDelta = compareOptionalTimelineSequence(
    left.timelineSequence,
    right.timelineSequence,
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
