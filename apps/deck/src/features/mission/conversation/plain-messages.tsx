import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentMessage, AgentToolCall, SessionTimelineEntry } from "@tiller/shared";
import { normalizeLocalCommandMessageText } from "../../../shared/utils/local-command-message";
import { cn } from "../../../shared/utils/cn";
import { coalesceDisplayMessages, groupToolCalls, sortAgentMessagesByTimeline, type ConversationToolCallItem } from "../../logbook";
import { PlainMessageItem, PlainThinkingItem, PlainToolGroupItem } from "./plain-message-items";

export const DEFAULT_VISIBLE_MESSAGE_LIMIT = 20;

type PlainMessagesProps = {
  sessionId: string | null;
  items: AgentMessage[];
  timelineItems?: SessionTimelineEntry[];
  thinkingToolCalls?: AgentToolCall[];
  toolCalls?: AgentToolCall[];
  showThinking?: boolean;
  emptyText: string;
  assistantLabel: string;
  roleLabels: Record<AgentMessage["role"], string>;
  expandedMessageIds: ReadonlySet<string>;
  boundaryTimestamps?: string[];
  historyState?: { hasMore: boolean; loading: boolean };
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
  emptyText,
  assistantLabel,
  roleLabels,
  expandedMessageIds,
  boundaryTimestamps = [],
  historyState,
  onLoadOlderMessages,
  onToggleExpandedMessage,
}: PlainMessagesProps) {
  const [visibleMessageCount, setVisibleMessageCount] = useState(
    DEFAULT_VISIBLE_MESSAGE_LIMIT,
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const localScrollSnapshotRef = useRef<ScrollSnapshot | null>(null);

  useEffect(() => {
    setVisibleMessageCount(DEFAULT_VISIBLE_MESSAGE_LIMIT);
  }, [sessionId]);

  const displayMessages = useMemo(
    () => sortDisplayMessages(items, boundaryTimestamps),
    [items, boundaryTimestamps],
  );
  const displayItems = useMemo(
    () => timelineItems.length
      ? buildPlainConversationItemsFromTimeline(timelineItems, showThinking)
      : buildPlainConversationItems(
          displayMessages,
          showThinking ? thinkingToolCalls : [],
          toolCalls,
        ),
    [displayMessages, showThinking, thinkingToolCalls, timelineItems, toolCalls],
  );
  const visibleItems = useMemo(
    () => displayItems.slice(-visibleMessageCount),
    [displayItems, visibleMessageCount],
  );
  const visibleRenderMessages = useMemo(
    () => resolvePlainMessageRenderItems(visibleItems),
    [visibleItems],
  );
  const hasHiddenLoadedMessages = visibleItems.length < displayItems.length;
  const canLoadMoreMessages =
    hasHiddenLoadedMessages || Boolean(historyState?.hasMore);
  const loadMoreLabel = resolveLoadMoreMessagesLabel(
    Boolean(historyState?.loading),
  );

  useEffect(() => {
    const snapshot = localScrollSnapshotRef.current;
    const scrollContainer = listRef.current?.parentElement;
    if (!snapshot || !scrollContainer) {
      return;
    }
    scrollContainer.scrollTop =
      scrollContainer.scrollHeight - snapshot.scrollHeight + snapshot.scrollTop;
    localScrollSnapshotRef.current = null;
  }, [visibleRenderMessages.length]);

  function showMoreMessages() {
    const nextVisibleCount = visibleMessageCount + DEFAULT_VISIBLE_MESSAGE_LIMIT;
    const scrollContainer = listRef.current?.parentElement;
    if (scrollContainer) {
      localScrollSnapshotRef.current = {
        scrollHeight: scrollContainer.scrollHeight,
        scrollTop: scrollContainer.scrollTop,
      };
    }
    setVisibleMessageCount(nextVisibleCount);
    if (
      displayItems.length <= nextVisibleCount &&
      historyState?.hasMore &&
      !historyState.loading
    ) {
      onLoadOlderMessages();
    }
  }

  if (!displayItems.length) {
    return <div className="empty-state rounded-md border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">{emptyText}</div>;
  }

  return (
    <div ref={listRef} className="plain-message-list conversation-timeline mx-auto grid w-full max-w-[min(1120px,calc(100%_-_32px))] gap-4">
      {canLoadMoreMessages ? (
        <button
          className="secondary load-more-history rounded-md border border-border-ghost bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-emphasis disabled:opacity-60"
          type="button"
          onClick={showMoreMessages}
          disabled={historyState?.loading}
        >
          {loadMoreLabel}
        </button>
      ) : null}
      {visibleRenderMessages.map((renderItem, index) => {
        if (renderItem.kind === "thinking") {
          return <PlainThinkingItem key={renderItem.renderKey} item={renderItem.toolCall} />;
        }
        if (renderItem.kind === "tool-group") {
          return (
            <PlainToolGroupItem
              key={renderItem.renderKey}
              group={renderItem.group}
              hasNewerContent={index < visibleRenderMessages.length - 1}
            />
          );
        }

        const isExpanded = expandedMessageIds.has(renderItem.message.id);
        return (
          <PlainMessageItem
            key={renderItem.renderKey}
            isContinuation={renderItem.isContinuation}
            isExpanded={isExpanded}
            message={renderItem.message}
            onToggleExpandedMessage={onToggleExpandedMessage}
            roleLabel={resolveMessageRoleLabel(
              renderItem.message,
              assistantLabel,
              roleLabels,
            )}
          />
        );
      })}
    </div>
  );
}

type ScrollSnapshot = { scrollHeight: number; scrollTop: number };

export function resolveLoadMoreMessagesLabel(loading: boolean) {
  if (loading) {
    return "加载中...";
  }
  return "查看更多";
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

export function resolveVisiblePlainMessages(
  items: AgentMessage[],
  visibleCount = DEFAULT_VISIBLE_MESSAGE_LIMIT,
  boundaryTimestamps: string[] = [],
) {
  return sortDisplayMessages(items, boundaryTimestamps).slice(-visibleCount);
}

type PlainConversationItem =
  | { kind: "message"; sourceIndex?: number; timestamp: string; timelineSequence?: number; message: AgentMessage }
  | { kind: "thinking"; sourceIndex?: number; timestamp: string; timelineSequence?: number; toolCall: AgentToolCall }
  | { kind: "tool-group"; sourceIndex?: number; timestamp: string; timelineSequence?: number; group: ConversationToolCallItem[] };

type PlainMessageRenderSource = AgentMessage | PlainConversationItem;

type PlainMessageRenderItem =
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
    };

export function resolvePlainMessageRenderItems(
  items: PlainMessageRenderSource[],
): PlainMessageRenderItem[] {
  const normalizedItems = items.map(normalizePlainMessageRenderSource).filter((item): item is PlainConversationItem => Boolean(item));
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
  const toolItems = groupToolCalls(visibleToolCalls).map((toolCall, index) => ({
    kind: "tool-group" as const,
    sourceIndex: messageItems.length + thinkingItems.length + index,
    timestamp: toolCall.timestamp,
    timelineSequence: toolCall.timelineSequence,
    group: [toolCall],
  }));
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
              id: chunk.id,
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
        items.push({
          kind: "tool-group",
          sourceIndex,
          timestamp: entry.timestamp,
          timelineSequence: entry.timelineSequence,
          group: [toolCall],
        });
        sourceIndex += 1;
      }
    }
  }

  return mergeAdjacentToolItems(mergeAdjacentThinkingItems(items));
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
      last.toolCall.id !== item.toolCall.id
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

function resolveMessageRoleLabel(
  message: AgentMessage,
  assistantLabel: string,
  roleLabels: Record<AgentMessage["role"], string>,
) {
  return message.role === "assistant"
    ? assistantLabel
    : roleLabels[message.role];
}

function comparePlainConversationItems(left: PlainConversationItem, right: PlainConversationItem) {
  const timelineDelta = compareOptionalTimelineSequence(
    left.timelineSequence,
    right.timelineSequence,
  );
  if (timelineDelta !== null) {
    return timelineDelta;
  }
  if (hasMixedTimelineSequence(left, right) && left.sourceIndex !== undefined && right.sourceIndex !== undefined) {
    return left.sourceIndex - right.sourceIndex;
  }
  const timestampDelta = Date.parse(left.timestamp) - Date.parse(right.timestamp);
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

function hasMixedTimelineSequence(
  left: { timelineSequence?: number },
  right: { timelineSequence?: number },
) {
  return (left.timelineSequence === undefined) !== (right.timelineSequence === undefined);
}

function plainConversationKindRank(item: PlainConversationItem) {
  if (item.kind === "thinking") {
    return 0;
  }
  if (item.kind === "tool-group") {
    return 1;
  }
  return 2;
}
