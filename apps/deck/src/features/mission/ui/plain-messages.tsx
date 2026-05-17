import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { AgentMessage, AgentToolCall } from "@tiller/shared";
import { Button } from "../../../shared/ui";
import { MarkdownMessage } from "../../../shared/ui/markdown";
import { cn } from "../../../shared/utils/cn";
import { coalesceDisplayMessages, sortAgentMessagesByTimeline } from "../../logbook";

const COLLAPSED_MESSAGE_LINE_LIMIT = 3;
const COLLAPSED_MESSAGE_CHAR_LIMIT = 300;
export const DEFAULT_VISIBLE_MESSAGE_LIMIT = 20;

type PlainMessagesProps = {
  sessionId: string | null;
  items: AgentMessage[];
  thinkingToolCalls?: AgentToolCall[];
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
  thinkingToolCalls = [],
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
    () => buildPlainConversationItems(displayMessages, thinkingToolCalls),
    [displayMessages, thinkingToolCalls],
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
  const loadMoreLabel = resolveLoadMoreMessagesLabel({
    hasMoreHistory: Boolean(historyState?.hasMore),
    loading: Boolean(historyState?.loading),
    pageSize: DEFAULT_VISIBLE_MESSAGE_LIMIT,
    totalLoaded: displayItems.length,
    visible: visibleItems.length,
  });

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
    <div ref={listRef} className="plain-message-list conversation-timeline grid gap-4">
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
      {visibleRenderMessages.map((renderItem) => {
        if (renderItem.kind === "thinking") {
          return <PlainThinkingItem key={renderItem.renderKey} item={renderItem.toolCall} />;
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

type LoadMoreMessagesLabelInput = {
  hasMoreHistory: boolean;
  loading: boolean;
  pageSize: number;
  totalLoaded: number;
  visible: number;
};

export function resolveLoadMoreMessagesLabel({
  hasMoreHistory,
  loading,
  pageSize,
  totalLoaded,
  visible,
}: LoadMoreMessagesLabelInput) {
  if (loading) {
    return "加载中...";
  }
  const historyHint = hasMoreHistory ? `，继续加载每次最多 ${pageSize} 条` : "";
  return `查看更多（已显示 ${visible}/${totalLoaded}${historyHint}）`;
}

type PlainMessageItemProps = {
  isContinuation: boolean;
  isExpanded: boolean;
  message: AgentMessage;
  onToggleExpandedMessage: (messageId: string) => void;
  roleLabel: string;
};

const PlainMessageItem = memo(function PlainMessageItem({
  isContinuation,
  isExpanded,
  message,
  onToggleExpandedMessage,
  roleLabel,
}: PlainMessageItemProps) {
  const isAssistant = message.role === "assistant";
  const isStreaming = isAssistant && message.streaming;
  const isCollapsible =
    message.role === "user" && shouldCollapsePlainMessage(message.text);
  const messageBodyClassName =
    isCollapsible && !isExpanded
      ? "plain-message-body plain-message-body-collapsed"
      : "plain-message-body";

  return (
    <article
      className={cn(
        "plain-message min-w-0 text-foreground",
        `plain-${message.role}`,
        isStreaming && "plain-message-streaming",
        isAssistant
          ? "mr-auto grid max-w-[min(820px,100%)] grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-3"
          : "ml-auto grid max-w-[min(720px,88%)] gap-2 rounded-2xl border border-border-ghost bg-surface-elevated p-3 shadow-ambient",
      )}
      data-streaming={isStreaming ? "true" : undefined}
    >
      {isAssistant ? (
        <span
          aria-hidden="true"
          className="plain-assistant-segment-marker flex min-h-6 justify-center pt-2"
        >
          <span className={cn(
            "plain-assistant-segment-dot size-2 rounded-full ring-4 ring-surface-sunken",
            isStreaming ? "animate-pulse bg-accent" : "bg-success",
          )} />
        </span>
      ) : null}
      <div className="grid min-w-0 gap-2">
        {message.role === "user" ? null : (
          <span
            className={cn(
              "plain-message-role text-xs font-semibold uppercase tracking-wider text-muted-foreground",
              isContinuation && "sr-only",
            )}
          >
            {roleLabel}
          </span>
        )}
        <div
          className={`${messageBodyClassName} min-w-0 text-sm leading-relaxed [overflow-wrap:anywhere]`}
        >
          {renderPlainMessageContent(message, isCollapsible && !isExpanded, isStreaming)}
        </div>
        {isCollapsible ? (
          <Button
            className="plain-message-expand w-fit px-3 py-1.5 text-xs"
            type="button"
            variant="outline"
            onClick={() => onToggleExpandedMessage(message.id)}
          >
            {isExpanded ? "收起消息" : "展开完整消息"}
          </Button>
        ) : null}
        {message.attachments?.length ? (
          <div className="mission-message-attachments grid gap-2 sm:grid-cols-2">
            {message.attachments.map((image, index) => (
              <figure
                key={`${message.id}-image-${index}`}
                className="mission-message-image overflow-hidden rounded-md border border-border-ghost bg-surface-sunken"
              >
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt={image.name ?? `粘贴图片 ${index + 1}`}
                  className="w-full object-contain"
                />
                <figcaption className="px-2 py-1 text-xs text-muted-foreground">
                  {image.name ?? `粘贴图片 ${index + 1}`}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
});

function PlainThinkingItem({ item }: { item: AgentToolCall }) {
  const isRunning = item.status === "pending" || item.status === "running";
  const text = item.output?.trim() || item.input?.trim() || "暂无 Thinking 内容";
  const title = resolveThinkingTitle(item);

  return (
    <details
      className="plain-thinking rounded-xl border border-border-ghost bg-surface-elevated/80 p-0 shadow-ambient"
      open={isRunning || undefined}
    >
      <summary className="grid cursor-pointer list-none grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className={cn(
            "size-2 rounded-full ring-4 ring-surface-sunken",
            isRunning ? "animate-pulse bg-accent" : "bg-info",
          )}
        />
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">
          {title}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {resolveThinkingStatusLabel(item.status)}
        </span>
      </summary>
      <div className="border-t border-border-ghost px-3 py-2 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
        <MarkdownMessage text={text} />
      </div>
    </details>
  );
}

function resolveThinkingTitle(item: AgentToolCall) {
  const rawTitle = item.title?.trim();
  if (!rawTitle || /^thinking$/iu.test(rawTitle) || rawTitle === item.id) {
    return "Thinking";
  }
  return `Thinking · ${rawTitle}`;
}

function resolveThinkingStatusLabel(status: AgentToolCall["status"]) {
  switch (status) {
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "取消";
    case "waiting_for_permission":
      return "等待";
    default:
      return "思考中";
  }
}

function renderPlainMessageContent(
  message: AgentMessage,
  collapsed: boolean,
  streaming = false,
) {
  if (message.role === "user") {
    return (
      <div
        className={
          collapsed ? "plain-message-text plain-message-text-collapsed line-clamp-3 overflow-hidden whitespace-pre-wrap" : "plain-message-text whitespace-pre-wrap"
        }
      >
        {message.text}
      </div>
    );
  }

  if (streaming) {
    const segmented = splitStreamingMarkdown(message.text);
    if (!segmented) {
      return <PlainStreamingText text={message.text} />;
    }
    return (
      <>
        <div
          className="min-w-0 [&_.markdown-table-scroll]:max-w-full [&_.markdown-table-scroll]:overflow-x-auto [&_.markdown-table-scroll]:overflow-y-hidden"
          data-mission-swipe-lock="true"
        >
          <MarkdownMessage text={segmented.markdown} />
        </div>
        {segmented.tail ? <PlainStreamingText text={segmented.tail} tail /> : null}
      </>
    );
  }

  return (
    <div
      className="min-w-0 [&_.markdown-table-scroll]:max-w-full [&_.markdown-table-scroll]:overflow-x-auto [&_.markdown-table-scroll]:overflow-y-hidden"
      data-mission-swipe-lock="true"
    >
      <MarkdownMessage text={message.text} />
    </div>
  );
}

type PlainStreamingTextProps = {
  tail?: boolean;
  text: string;
};

function PlainStreamingText({ tail = false, text }: PlainStreamingTextProps) {
  return (
    <div
      className={cn(
        "plain-message-text whitespace-pre-wrap",
        tail && "plain-message-streaming-tail",
      )}
    >
      {text}
    </div>
  );
}

type StreamingMarkdownSegment = {
  markdown: string;
  tail: string;
};

function splitStreamingMarkdown(text: string): StreamingMarkdownSegment | null {
  const splitIndex = findStreamingMarkdownSplitIndex(text);
  if (splitIndex === null) {
    return null;
  }
  const markdown = text.slice(0, splitIndex).trimEnd();
  if (!markdown.trim()) {
    return null;
  }
  return {
    markdown,
    tail: text.slice(splitIndex).replace(/^\r?\n/u, ""),
  };
}

function findStreamingMarkdownSplitIndex(text: string) {
  let splitIndex: number | null = null;
  let fence: MarkdownFenceState | null = null;
  const linePattern = /.*(?:\r?\n|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(text))) {
    const line = match[0];
    if (!line) {
      break;
    }
    const lineEnd = match.index + line.length;
    const marker = /^[ \t]*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker) {
      const markerKind = marker[0] as "`" | "~";
      if (fence && fence.marker === markerKind && marker.length >= fence.length) {
        fence = null;
        splitIndex = lineEnd;
      } else if (!fence) {
        fence = { marker: markerKind, length: marker.length };
      }
    }
    if (!fence && /^\s*$/u.test(line) && match.index > 0) {
      splitIndex = lineEnd;
    }
    if (lineEnd >= text.length) {
      break;
    }
  }
  return splitIndex;
}

type MarkdownFenceState = {
  marker: "`" | "~";
  length: number;
};

function sortDisplayMessages(items: AgentMessage[], boundaryTimestamps: string[] = []) {
  return coalesceDisplayMessages(
    sortAgentMessagesByTimeline(items).filter(
      (message) => !isAcpPromptWrapperEcho(message),
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
  | { kind: "message"; timestamp: string; message: AgentMessage }
  | { kind: "thinking"; timestamp: string; toolCall: AgentToolCall };

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
    };

export function resolvePlainMessageRenderItems(
  items: PlainMessageRenderSource[],
): PlainMessageRenderItem[] {
  const normalizedItems = items.map(normalizePlainMessageRenderSource);
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
): PlainConversationItem {
  if ("role" in item) {
    return {
      kind: "message",
      timestamp: item.timestamp,
      message: item,
    };
  }
  return item;
}

function buildPlainConversationItems(
  messages: AgentMessage[],
  thinkingToolCalls: AgentToolCall[],
): PlainConversationItem[] {
  return [
    ...messages.map((message) => ({
      kind: "message" as const,
      timestamp: message.timestamp,
      message,
    })),
    ...thinkingToolCalls.map((toolCall) => ({
      kind: "thinking" as const,
      timestamp: toolCall.timestamp,
      toolCall,
    })),
  ].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function shouldCollapsePlainMessage(text: string) {
  const lineCount = text.split(/\r?\n/).length;
  return (
    lineCount > COLLAPSED_MESSAGE_LINE_LIMIT ||
    text.length > COLLAPSED_MESSAGE_CHAR_LIMIT
  );
}

function isAcpPromptWrapperEcho(message: AgentMessage) {
  if (message.role !== "user") {
    return false;
  }
  const text = message.text.trim();
  return (
    /^\[[a-z-]+mode\]/iu.test(text) ||
    text === "---" ||
    text.includes("SYNTHESIZE findings before proceeding.") ||
    text.includes("MANDATORY delegate_task params")
  );
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