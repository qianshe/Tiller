import { memo, useEffect, useMemo, useState } from "react";
import type { AgentMessage } from "@tiller/shared";
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

  useEffect(() => {
    setVisibleMessageCount(DEFAULT_VISIBLE_MESSAGE_LIMIT);
  }, [sessionId]);

  const displayMessages = useMemo(
    () => sortDisplayMessages(items, boundaryTimestamps),
    [items, boundaryTimestamps],
  );
  const visibleMessages = useMemo(
    () => displayMessages.slice(-visibleMessageCount),
    [displayMessages, visibleMessageCount],
  );
  const hasHiddenLoadedMessages = visibleMessages.length < displayMessages.length;
  const canLoadMoreMessages =
    hasHiddenLoadedMessages || Boolean(historyState?.hasMore);

  function showMoreMessages() {
    const nextVisibleCount = visibleMessageCount + DEFAULT_VISIBLE_MESSAGE_LIMIT;
    setVisibleMessageCount(nextVisibleCount);
    if (
      displayMessages.length <= nextVisibleCount &&
      historyState?.hasMore &&
      !historyState.loading
    ) {
      onLoadOlderMessages();
    }
  }

  if (!displayMessages.length) {
    return <div className="empty-state rounded-md border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">{emptyText}</div>;
  }

  return (
    <div className="plain-message-list conversation-timeline grid gap-4">
      {canLoadMoreMessages ? (
        <button
          className="secondary load-more-history rounded-md border border-border-ghost bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-emphasis disabled:opacity-60"
          type="button"
          onClick={showMoreMessages}
          disabled={historyState?.loading}
        >
          {historyState?.loading ? "加载中..." : "查看更多"}
        </button>
      ) : null}
      {visibleMessages.map((message) => {
        const isExpanded = expandedMessageIds.has(message.id);
        return (
          <PlainMessageItem
            key={message.id}
            isExpanded={isExpanded}
            message={message}
            onToggleExpandedMessage={onToggleExpandedMessage}
            roleLabel={resolveMessageRoleLabel(
              message,
              assistantLabel,
              roleLabels,
            )}
          />
        );
      })}
    </div>
  );
}

type PlainMessageItemProps = {
  isExpanded: boolean;
  message: AgentMessage;
  onToggleExpandedMessage: (messageId: string) => void;
  roleLabel: string;
};

const PlainMessageItem = memo(function PlainMessageItem({
  isExpanded,
  message,
  onToggleExpandedMessage,
  roleLabel,
}: PlainMessageItemProps) {
  const isAssistant = message.role === "assistant";
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
        isAssistant
          ? "mr-auto grid max-w-[min(820px,100%)] grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-3"
          : "ml-auto grid max-w-[min(720px,88%)] gap-2 rounded-2xl border border-border-ghost bg-surface-elevated p-3 shadow-ambient",
      )}
    >
      {isAssistant ? (
        <span
          aria-hidden="true"
          className="plain-assistant-segment-marker flex min-h-6 justify-center pt-2"
        >
          <span className="plain-assistant-segment-dot size-2 rounded-full bg-success-container ring-4 ring-surface-sunken" />
        </span>
      ) : null}
      <div className="grid min-w-0 gap-2">
        <span className="plain-message-role text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {roleLabel}
        </span>
        <div
          className={`${messageBodyClassName} min-w-0 text-sm leading-relaxed [overflow-wrap:anywhere]`}
        >
          {renderPlainMessageContent(message, isCollapsible && !isExpanded)}
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

function renderPlainMessageContent(
  message: AgentMessage,
  collapsed: boolean,
) {
  return message.role === "user" ? (
    <div
      className={
        collapsed ? "plain-message-text plain-message-text-collapsed line-clamp-3 overflow-hidden whitespace-pre-wrap" : "plain-message-text whitespace-pre-wrap"
      }
    >
      {message.text}
    </div>
  ) : (
    <div className="min-w-0 [&_.markdown-table-scroll]:max-w-full [&_.markdown-table-scroll]:overflow-x-auto [&_.markdown-table-scroll]:overflow-y-hidden">
      <MarkdownMessage text={message.text} />
    </div>
  );
}

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
