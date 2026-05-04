import type { AgentMessage } from "@tiller/shared";
import { MarkdownMessage } from "../../../components/markdown";

const COLLAPSED_MESSAGE_LINE_LIMIT = 5;
const COLLAPSED_MESSAGE_CHAR_LIMIT = 300;

type PlainMessagesProps = {
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
  items,
  emptyText,
  assistantLabel,
  roleLabels,
  expandedMessageIds,
  historyState,
  onLoadOlderMessages,
  onToggleExpandedMessage,
}: PlainMessagesProps) {
  const displayMessages = sortDisplayMessages(items);
  if (!displayMessages.length) {
    return <div className="empty-state">{emptyText}</div>;
  }

  return (
    <div className="plain-message-list conversation-timeline">
      {historyState?.hasMore ? (
        <button
          className="secondary load-more-history"
          type="button"
          onClick={onLoadOlderMessages}
          disabled={historyState.loading}
        >
          {historyState.loading ? "加载中..." : "加载更早消息"}
        </button>
      ) : null}
      {displayMessages.map((message) => {
        const isExpanded = expandedMessageIds.has(message.id);
        const isCollapsible =
          message.role === "user" && shouldCollapsePlainMessage(message.text);
        const markdownClassName =
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
            <div className={markdownClassName}>
              <MarkdownMessage text={message.text} />
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

function sortDisplayMessages(items: AgentMessage[]) {
  return items;
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
