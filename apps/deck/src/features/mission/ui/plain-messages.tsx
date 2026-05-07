import { Fragment, useEffect, useState } from "react";
import type { AgentMessage } from "@tiller/shared";
import { MarkdownMessage } from "../../../shared/ui/markdown";
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

  const displayMessages = sortDisplayMessages(items, boundaryTimestamps);
  const visibleMessages = resolveVisiblePlainMessages(
    displayMessages,
    visibleMessageCount,
    boundaryTimestamps,
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
    <div className="plain-message-list conversation-timeline grid gap-3">
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
      {visibleMessages.map((message, index) => {
        const previousMessage = visibleMessages[index - 1];
        const showToolBoundary = previousMessage
          ? hasToolBoundaryBetweenMessages(
              previousMessage,
              message,
              boundaryTimestamps,
            )
          : false;
        const isExpanded = expandedMessageIds.has(message.id);
        const isCollapsible =
          message.role === "user" && shouldCollapsePlainMessage(message.text);
        const messageBodyClassName =
          isCollapsible && !isExpanded
            ? "plain-message-body plain-message-body-collapsed"
            : "plain-message-body";
        return (
          <Fragment key={message.id}>
            {showToolBoundary ? (
              <div
                key={`${previousMessage?.id ?? "start"}-${message.id}-tool-boundary`}
                className="mission-message-tool-boundary flex items-center gap-3 py-1 text-xs font-semibold text-muted-foreground"
                aria-label="工具调用分隔"
              >
                <span className="h-px flex-1 bg-border-ghost" />
                <span className="rounded-full bg-surface px-2 py-0.5">---</span>
                <span className="h-px flex-1 bg-border-ghost" />
              </div>
            ) : null}
            <article
              className={`plain-message plain-${message.role} grid gap-2 rounded-lg border border-border-ghost bg-surface p-3 text-foreground ${message.role === "assistant" ? "plain-assistant" : "plain-user"}`}
            >
              <span className="plain-message-role text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {resolveMessageRoleLabel(message, assistantLabel, roleLabels)}
              </span>
              <div className={`${messageBodyClassName} min-w-0 text-sm leading-relaxed`}>
                {renderPlainMessageContent(message, isCollapsible && !isExpanded)}
              </div>
              {isCollapsible ? (
                <button
                  className="plain-message-expand w-fit rounded-md border border-border-ghost px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-emphasis hover:text-foreground"
                  type="button"
                  onClick={() => onToggleExpandedMessage(message.id)}
                >
                  {isExpanded ? "收起消息" : "展开完整消息"}
                </button>
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
            </article>
          </Fragment>
        );
      })}
    </div>
  );
}

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
    <div className="[&_.markdown-table-scroll]:overflow-x-auto [&_.markdown-table-scroll]:overflow-y-hidden">
      <MarkdownMessage text={message.text} />
    </div>
  );
}

function sortDisplayMessages(items: AgentMessage[], boundaryTimestamps: string[] = []) {
  return coalesceDisplayMessages(
    sortAgentMessagesByTimeline(items),
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

function hasToolBoundaryBetweenMessages(
  left: AgentMessage,
  right: AgentMessage,
  boundaryTimestamps: string[],
) {
  const leftTime = Date.parse(left.timestamp);
  const rightTime = Date.parse(right.timestamp);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return false;
  }

  const minTime = Math.min(leftTime, rightTime);
  const maxTime = Math.max(leftTime, rightTime);
  return boundaryTimestamps.some((timestamp) => {
    const boundaryTime = Date.parse(timestamp);
    return (
      Number.isFinite(boundaryTime) &&
      boundaryTime > minTime &&
      boundaryTime <= maxTime
    );
  });
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
