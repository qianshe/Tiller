import { memo, useCallback } from "react";
import type { AgentMessage, AgentToolCall } from "@tiller/shared";
import { PlainMessages } from "./plain-messages";

type MessageHistoryState = {
  hasMore: boolean;
  loading: boolean;
};

type MissionMessageTimelineCopy = {
  waitingForAgent: string;
  role: Record<AgentMessage["role"], string>;
};

type MissionMessageTimelineProps = {
  items: AgentMessage[];
  thinkingToolCalls?: AgentToolCall[];
  toolCalls?: AgentToolCall[];
  sessionId?: string;
  assistantLabel?: string;
  copy: MissionMessageTimelineCopy;
  expandedMessageIds: ReadonlySet<string>;
  boundaryTimestamps?: string[];
  historyStateBySession: Record<string, MessageHistoryState | undefined>;
  activityHistoryStateBySession?: Record<string, MessageHistoryState | undefined>;
  onLoadOlderMessages: (sessionId: string) => void;
  onToggleExpandedMessage: (messageId: string) => void;
};

/**
 * Binds session history state to the plain mission message list.
 */
export const MissionMessageTimeline = memo(function MissionMessageTimeline({
  items,
  thinkingToolCalls = [],
  toolCalls = [],
  sessionId,
  assistantLabel,
  copy,
  expandedMessageIds,
  boundaryTimestamps = [],
  historyStateBySession,
  activityHistoryStateBySession = {},
  onLoadOlderMessages,
  onToggleExpandedMessage,
}: MissionMessageTimelineProps) {
  const loadOlderMessages = useCallback(() => {
    if (sessionId) {
      onLoadOlderMessages(sessionId);
    }
  }, [onLoadOlderMessages, sessionId]);

  const historyState = resolveConversationHistoryState(
    sessionId ? historyStateBySession[sessionId] : undefined,
    sessionId ? activityHistoryStateBySession[sessionId] : undefined,
  );

  return (
    <PlainMessages
      sessionId={sessionId ?? null}
      items={items}
      thinkingToolCalls={thinkingToolCalls}
      toolCalls={toolCalls}
      emptyText={copy.waitingForAgent}
      assistantLabel={assistantLabel ?? copy.role.assistant}
      roleLabels={copy.role}
      expandedMessageIds={expandedMessageIds}
      boundaryTimestamps={boundaryTimestamps}
      historyState={historyState}
      onLoadOlderMessages={loadOlderMessages}
      onToggleExpandedMessage={onToggleExpandedMessage}
    />
  );
});

function resolveConversationHistoryState(
  messageHistoryState?: MessageHistoryState,
  activityHistoryState?: MessageHistoryState,
): MessageHistoryState | undefined {
  if (!messageHistoryState && !activityHistoryState) {
    return undefined;
  }
  return {
    hasMore: Boolean(messageHistoryState?.hasMore || activityHistoryState?.hasMore),
    loading: Boolean(messageHistoryState?.loading || activityHistoryState?.loading),
  };
}
