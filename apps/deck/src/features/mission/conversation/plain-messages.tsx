import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { AgentMessage, AgentToolCall } from "@tiller/shared";
import { Badge, Button, Icon, type TillerIconName } from "../../../shared/ui";
import { MarkdownMessage } from "../../../shared/ui/markdown";
import { normalizeLocalCommandMessageText } from "../../../shared/utils/local-command-message";
import { cn } from "../../../shared/utils/cn";
import { coalesceDisplayMessages, groupToolCalls, sortAgentMessagesByTimeline, type ConversationToolCallItem } from "../../logbook";
import { resolveToolCallTone } from "../../logbook/tool-call-tone";

const COLLAPSED_MESSAGE_LINE_LIMIT = 3;
const COLLAPSED_MESSAGE_CHAR_LIMIT = 300;
export const DEFAULT_VISIBLE_MESSAGE_LIMIT = 20;

type PlainMessagesProps = {
  sessionId: string | null;
  items: AgentMessage[];
  thinkingToolCalls?: AgentToolCall[];
  toolCalls?: AgentToolCall[];
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
  toolCalls = [],
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
    () => buildPlainConversationItems(displayMessages, thinkingToolCalls, toolCalls),
    [displayMessages, thinkingToolCalls, toolCalls],
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
      {visibleRenderMessages.map((renderItem) => {
        if (renderItem.kind === "thinking") {
          return <PlainThinkingItem key={renderItem.renderKey} item={renderItem.toolCall} />;
        }
        if (renderItem.kind === "tool-group") {
          return <PlainToolGroupItem key={renderItem.renderKey} group={renderItem.group} />;
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
          ? "mr-auto grid w-full max-w-full grid-cols-[0.75rem_minmax(0,1fr)] items-start gap-x-2.5"
          : "ml-auto grid max-w-[min(620px,72%)] justify-items-end gap-2 text-left",
      )}
      data-streaming={isStreaming ? "true" : undefined}
    >
      {isAssistant ? (
        <span
          aria-hidden="true"
          className="plain-assistant-segment-marker flex min-h-5 justify-center pt-2"
        >
          <span className={cn(
            "plain-assistant-segment-dot size-1.5 rounded-full ring-2 ring-surface-sunken",
            isStreaming ? "animate-pulse bg-accent" : "bg-success",
          )} />
        </span>
      ) : null}
      <div
        className={cn(
          "grid min-w-0 gap-2",
          message.role === "user" && "w-full justify-items-end",
        )}
      >
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
        {message.role === "user" && message.attachments?.length ? (
          <div className="mission-message-attachments ml-auto flex w-fit max-w-full flex-wrap justify-end gap-2 justify-self-end">
            {message.attachments.map((image, index) => (
              <figure
                key={`${message.id}-image-${index}`}
                className="mission-message-image w-28 max-w-[30vw] overflow-hidden rounded-[10px] border border-border-ghost bg-surface-sunken shadow-[0_8px_24px_rgb(0_0_0/0.10)]"
              >
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt={image.name ?? `粘贴图片 ${index + 1}`}
                  className="h-16 w-full object-cover"
                />
                <figcaption className="truncate px-2 py-1 text-xs text-muted-foreground">
                  {image.name ?? `粘贴图片 ${index + 1}`}
                </figcaption>
              </figure>
            ))}
          </div>
        ) : null}
        <div
          className={cn(
            `${messageBodyClassName} min-w-0 text-sm leading-relaxed [overflow-wrap:anywhere]`,
            message.role === "user" && "rounded-[14px] border border-primary/20 bg-primary-soft/25 px-3 py-2 shadow-[0_8px_24px_rgb(0_0_0/0.12)]",
          )}
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
        {message.role !== "user" && message.attachments?.length ? (
          <div className="mission-message-attachments flex max-w-full flex-wrap gap-2">
            {message.attachments.map((image, index) => (
              <figure
                key={`${message.id}-image-${index}`}
                className="mission-message-image w-28 max-w-[30vw] overflow-hidden rounded-[10px] border border-border-ghost bg-surface-sunken shadow-[0_8px_24px_rgb(0_0_0/0.08)]"
              >
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt={image.name ?? `粘贴图片 ${index + 1}`}
                  className="h-16 w-full object-cover"
                />
                <figcaption className="truncate px-2 py-1 text-xs text-muted-foreground">
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

function PlainThinkingIcon() {
  return (
    <svg
      className="plain-thinking-icon size-3"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5.6 11.4c-1.8 0-3.2-1.3-3.2-3 0-1.4.9-2.5 2.2-2.9.3-1.7 1.8-3 3.6-3 1.5 0 2.8.9 3.4 2.2 1.2.3 2.1 1.4 2.1 2.7 0 1.6-1.3 2.9-3 2.9H8.8L6.6 13v-1.6h-1Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.4 6.4h3.4M5.9 8.3h4.2"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlainThinkingItem({ item }: { item: AgentToolCall }) {
  const isRunning = item.status === "pending" || item.status === "running";
  const text = item.output?.trim() || item.input?.trim() || "暂无 Thinking 内容";
  const [open, setOpen] = useState(isRunning);

  useEffect(() => {
    setOpen(isRunning);
  }, [isRunning]);

  return (
    <div className="plain-thinking-row mr-auto grid w-full max-w-full grid-cols-[0.75rem_minmax(0,1fr)] items-start gap-x-2.5 text-muted-foreground">
      <span aria-hidden="true" />
      <details
        className="plain-thinking min-w-0 w-full rounded-[8px] border border-border-ghost bg-surface-sunken/55 px-2 py-1 text-muted-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary
          className="flex w-full cursor-pointer list-none items-center gap-2 rounded-sm py-0.5 text-xs leading-4 text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-border-ghost [&::-webkit-details-marker]:hidden"
          aria-label={open ? "收起 Thinking" : "展开 Thinking"}
        >
          <span aria-hidden="true" className="shrink-0 text-primary">
            <PlainThinkingIcon />
          </span>
          <span className="min-w-0 truncate font-medium">
            Thinking
          </span>
          <Icon
            name="chevronDown"
            size={12}
            className={cn(
              "ml-auto text-muted-foreground/60 transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </summary>
        <div className="plain-thinking-content ml-1.5 border-l border-primary/25 pl-3.5 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere] [&_.markdown-message]:text-muted-foreground [&_.markdown-paragraph]:text-muted-foreground">
          <MarkdownMessage text={text} />
        </div>
      </details>
    </div>
  );
}

function PlainToolGroupItem({ group }: { group: ConversationToolCallItem[] }) {
  const isRunning = group.some((item) => isActiveToolStatus(item.status));
  const [open, setOpen] = useState(isRunning);
  const summaryTitle = summarizeToolGroupTitle(group);
  const groupBadgeLabel = resolveToolGroupBadgeLabel(group);

  useEffect(() => {
    setOpen(isRunning);
  }, [isRunning]);

  return (
    <div className="plain-tool-row mr-auto grid w-full max-w-full grid-cols-[0.75rem_minmax(0,1fr)] items-start gap-x-2.5 text-muted-foreground">
      <span aria-hidden="true" />
      <details
        className="plain-tool-group min-w-0 w-full rounded-[8px] border border-border-ghost bg-surface-sunken/55 px-2 py-1 text-muted-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]"
        data-tool-group-kind={groupBadgeLabel.toLowerCase()}
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary
          className="flex w-full cursor-pointer list-none items-center gap-1.5 rounded-sm py-0.5 text-xs leading-4 text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-border-ghost [&::-webkit-details-marker]:hidden"
          aria-label={open ? "收起工具调用" : "展开工具调用"}
        >
          <Icon name="hammer" size={12} className="text-primary" />
          <span className="whitespace-nowrap font-medium text-muted-foreground">
            工具调用 · {group.length} 项
          </span>
          <span className="min-w-0 truncate text-muted-foreground/70">
            {summaryTitle}
          </span>
          {isRunning ? (
            <span className="ml-auto shrink-0 rounded-sm bg-accent/10 px-1.5 py-0.5 text-2xs font-semibold text-accent">
              运行中
            </span>
          ) : null}
          <Icon
            name="chevronDown"
            size={12}
            className={cn(
              "text-muted-foreground/60 transition-transform duration-150",
              isRunning ? "ml-1.5" : "ml-auto",
              open && "rotate-180",
            )}
          />
        </summary>
        <div className="plain-tool-group-content ml-1.5 grid max-h-36 gap-1 overflow-y-auto border-l border-primary/25 pl-3.5 pr-1 text-sm text-muted-foreground" data-mission-swipe-lock="true">
          {group.map((item) => (
            <PlainToolCallItem key={item.id} item={item} />
          ))}
        </div>
      </details>
    </div>
  );
}

function PlainToolCallItem({ item }: { item: ConversationToolCallItem }) {
  const tone = resolveToolCallTone(item.toolKind, item.title);
  const preview = item.text.trim() || formatToolInputPreview(item.input);
  return (
    <details
      className="plain-tool-call grid gap-0.5 py-0.5 text-muted-foreground"
      data-tool-kind={tone.label.toLowerCase()}
    >
      <summary className="flex min-w-0 cursor-pointer list-none items-center gap-1.5 text-2xs leading-4 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className={cn("grid size-3 place-items-center rounded-sm", tone.className)}>
          <Icon name={resolveToolCallIconName(tone.label)} size={9} />
        </span>
        <Badge
          variant="secondary"
          className={cn("h-4 shrink-0 rounded-sm px-1.5 py-0 text-[10px] font-semibold leading-none", tone.className)}
        >
          {tone.label}
        </Badge>
        <strong className="min-w-0 truncate font-medium text-foreground">
          {item.title}
        </strong>
        <span className="ml-auto shrink-0 text-2xs text-muted-foreground/60">
          {resolveToolStatusLabel(item.status)}
        </span>
      </summary>
      {preview ? (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words pl-8 font-mono text-xs leading-snug text-foreground/85" data-mission-swipe-lock="true">
          {preview}
        </pre>
      ) : null}
    </details>
  );
}

function resolveToolCallIconName(label: string): TillerIconName {
  if (label === "Read" || label === "Write" || label === "File") return "fileText";
  if (label === "Search") return "search";
  if (label === "Shell") return "terminal";
  if (label === "Fetch") return "globe";
  if (label === "MCP") return "server";
  if (label === "Skill") return "sparkle";
  if (label === "Todo") return "check";
  if (label === "Subagent") return "message";
  if (label === "Built-in") return "panel";
  if (label === "Think") return "activity";
  return "inspect";
}

function resolveToolGroupBadgeLabel(group: ConversationToolCallItem[]): string {
  const labels = resolveToolGroupLabels(group);
  return labels[0] ?? "Tool";
}

function resolveToolGroupLabels(group: ConversationToolCallItem[]) {
  const labels = group.map((item) => resolveToolCallTone(item.toolKind, item.title).label);
  return Array.from(new Set(labels));
}

function summarizeToolGroupTitle(group: ConversationToolCallItem[]) {
  return resolveToolGroupLabels(group).slice(0, 3).join(" / ");
}

function isActiveToolStatus(status: AgentToolCall["status"]) {
  return status === "pending" || status === "running" || status === "waiting_for_permission";
}

function resolveToolStatusLabel(status: AgentToolCall["status"]) {
  if (status === "completed") {
    return "完成";
  }
  if (status === "failed") {
    return "失败";
  }
  if (status === "waiting_for_permission") {
    return "等待授权";
  }
  return "运行中";
}

function formatToolInputPreview(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
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
  | { kind: "message"; timestamp: string; timelineSequence?: number; message: AgentMessage }
  | { kind: "thinking"; timestamp: string; timelineSequence?: number; toolCall: AgentToolCall }
  | { kind: "tool-group"; timestamp: string; timelineSequence?: number; group: ConversationToolCallItem[] };

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
  const sorted = [
    ...messages.flatMap((message) => {
      const text = normalizeLocalCommandMessageText(message.text);
      return text
        ? [{ kind: "message" as const, timestamp: message.timestamp, timelineSequence: message.timelineSequence, message: text === message.text ? message : { ...message, text } }]
        : [];
    }),
    ...thinkingToolCalls.map((toolCall) => ({
      kind: "thinking" as const,
      timestamp: toolCall.timestamp,
      timelineSequence: toolCall.timelineSequence,
      toolCall,
    })),
    ...groupToolCalls(visibleToolCalls).map((toolCall) => ({
      kind: "tool-group" as const,
      timestamp: toolCall.timestamp,
      timelineSequence: toolCall.timelineSequence,
      group: [toolCall],
    })),
  ].sort(comparePlainConversationItems);
  return mergeAdjacentToolItems(mergeAdjacentThinkingItems(sorted));
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
      timestamp: last.timestamp,
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

function shouldCollapsePlainMessage(text: string) {
  const lineCount = text.split(/\r?\n/).length;
  return (
    lineCount > COLLAPSED_MESSAGE_LINE_LIMIT ||
    text.length > COLLAPSED_MESSAGE_CHAR_LIMIT
  );
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
  if (left.timelineSequence !== undefined && right.timelineSequence !== undefined) {
    const sequenceDelta = left.timelineSequence - right.timelineSequence;
    if (sequenceDelta !== 0) {
      return sequenceDelta;
    }
  }
  const timestampDelta = Date.parse(left.timestamp) - Date.parse(right.timestamp);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return plainConversationKindRank(left) - plainConversationKindRank(right);
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
