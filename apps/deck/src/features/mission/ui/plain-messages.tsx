import { useEffect, useState } from "react";
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

  const displayMessages = sortDisplayMessages(items);
  const visibleMessages = resolveVisiblePlainMessages(
    displayMessages,
    visibleMessageCount,
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
    return <div className="empty-state">{emptyText}</div>;
  }

  return (
    <div className="plain-message-list conversation-timeline">
      {canLoadMoreMessages ? (
        <button
          className="secondary load-more-history"
          type="button"
          onClick={showMoreMessages}
          disabled={historyState?.loading}
        >
          {historyState?.loading ? "加载中..." : "查看更多"}
        </button>
      ) : null}
      {visibleMessages.map((message) => {
        const isExpanded = expandedMessageIds.has(message.id);
        const isCollapsible =
          message.role === "user" && shouldCollapsePlainMessage(message.text);
        const messageBodyClassName =
          isCollapsible && !isExpanded
            ? "plain-message-body plain-message-body-collapsed"
            : "plain-message-body";
        return (
          <article
            key={message.id}
            className={`plain-message plain-${message.role}`}
          >
            <span className="plain-message-role">
              {resolveMessageRoleLabel(message, assistantLabel, roleLabels)}
            </span>
            <div className={messageBodyClassName}>
              {renderPlainMessageContent(message, isCollapsible && !isExpanded)}
            </div>
            {isCollapsible ? (
              <button
                className="plain-message-expand"
                type="button"
                onClick={() => onToggleExpandedMessage(message.id)}
              >
                {isExpanded ? "收起消息" : "展开完整消息"}
              </button>
            ) : null}
            {message.attachments?.length ? (
              <div className="mission-message-attachments">
                {message.attachments.map((image, index) => (
                  <figure
                    key={`${message.id}-image-${index}`}
                    className="mission-message-image"
                  >
                    <img
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt={image.name ?? `粘贴图片 ${index + 1}`}
                    />
                    <figcaption>
                      {image.name ?? `粘贴图片 ${index + 1}`}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : null}
          </article>
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
        collapsed ? "plain-message-text plain-message-text-collapsed" : "plain-message-text"
      }
    >
      {message.text}
    </div>
  ) : (
    <MarkdownMessage text={message.text} />
  );
}

function sortDisplayMessages(items: AgentMessage[]) {
  return coalesceDisplayMessages(sortAgentMessagesByTimeline(items));
}

export function resolveVisiblePlainMessages(
  items: AgentMessage[],
  visibleCount = DEFAULT_VISIBLE_MESSAGE_LIMIT,
) {
  return sortDisplayMessages(items).slice(-visibleCount);
}

function shouldCollapsePlainMessage(text: string) {
  const lineCount = text.split(/\r?\n/).length;
  return (
    lineCount > COLLAPSED_MESSAGE_LINE_LIMIT ||
    text.length > COLLAPSED_MESSAGE_CHAR_LIMIT
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
