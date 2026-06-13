import { memo, useCallback } from "react";
import type { AgentMessage, AgentToolCall, SessionTimelineEntry } from "@tiller/shared";
import { PlainMessages } from "./plain-messages";

type MessageHistoryState = {
  nextCursor?: string;
  hasMore: boolean;
  timelineNextCursor?: string;
  timelineHasMore?: boolean;
  loading: boolean;
};

type MissionMessageTimelineCopy = {
  waitingForAgent: string;
};

type MissionMessageTimelineProps = {
  items: AgentMessage[];
  timelineItems?: SessionTimelineEntry[];
  thinkingToolCalls?: AgentToolCall[];
  toolCalls?: AgentToolCall[];
  showThinking?: boolean;
  sessionId?: string;
  copy: MissionMessageTimelineCopy;
  canHandoffAssistantMessage?: boolean;
  assistantHandoffBusy?: boolean;
  onHandoffAssistantMessage?: (assistantBlockText: string) => void;
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
  timelineItems = [],
  thinkingToolCalls = [],
  toolCalls = [],
  showThinking = true,
  sessionId,
  copy,
  canHandoffAssistantMessage = false,
  assistantHandoffBusy = false,
  onHandoffAssistantMessage,
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
      timelineItems={timelineItems}
      thinkingToolCalls={thinkingToolCalls}
      toolCalls={toolCalls}
      showThinking={showThinking}
      canHandoffAssistantMessage={canHandoffAssistantMessage}
      assistantHandoffBusy={assistantHandoffBusy}
      onHandoffAssistantMessage={onHandoffAssistantMessage}
      emptyText={copy.waitingForAgent}
      expandedMessageIds={expandedMessageIds}
      boundaryTimestamps={boundaryTimestamps}
      historyState={historyState}
      onLoadOlderMessages={loadOlderMessages}
      onToggleExpandedMessage={onToggleExpandedMessage}
    />
  );
});

export function resolveConversationHistoryState(
  messageHistoryState?: MessageHistoryState,
  activityHistoryState?: MessageHistoryState,
): MessageHistoryState | undefined {
  if (!messageHistoryState && !activityHistoryState) {
    return undefined;
  }
  const hasLoadableMessages = Boolean(
    messageHistoryState?.hasMore && messageHistoryState.nextCursor,
  );
  const hasLoadableTimeline = Boolean(
    messageHistoryState?.timelineHasMore && messageHistoryState.timelineNextCursor,
  );
  const hasLoadableActivities = Boolean(
    activityHistoryState?.hasMore && activityHistoryState.nextCursor,
  );
  return {
    hasMore: hasLoadableMessages || hasLoadableTimeline || hasLoadableActivities,
    loading: Boolean(messageHistoryState?.loading || activityHistoryState?.loading),
  };
}
