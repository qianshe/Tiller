import { memo, useCallback } from "react";
import type {
  AgentMessage,
  AgentToolCall,
  SessionTimelineEntry,
  SessionSubagentDetail,
} from "@tiller/shared";
import { resolveConversationHistoryFlags } from "../history/model";
import { PlainMessages } from "./plain-messages";

type MessageHistoryState = {
  nextCursor?: string;
  hasMore: boolean;
  canLoadMore?: boolean;
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
  onLoadOlderMessages: (sessionId: string) => void;
  onToggleExpandedMessage: (messageId: string) => void;
  subagentDetails?: Record<string, SessionSubagentDetail | undefined>;
  onToggleSubagentDetail?: (sessionId: string, parentToolCallId: string, open: boolean) => void;
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
  onLoadOlderMessages,
  onToggleExpandedMessage,
  subagentDetails,
  onToggleSubagentDetail,
}: MissionMessageTimelineProps) {
  const loadOlderMessages = useCallback(() => {
    if (sessionId) {
      onLoadOlderMessages(sessionId);
    }
  }, [onLoadOlderMessages, sessionId]);

  const historyState = resolveConversationHistoryState(
    sessionId ? historyStateBySession[sessionId] : undefined,
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
      subagentDetails={subagentDetails}
      onToggleSubagentDetail={onToggleSubagentDetail}
    />
  );
});

export function resolveConversationHistoryState(
  messageHistoryState?: MessageHistoryState,
): MessageHistoryState | undefined {
  return resolveConversationHistoryFlags(messageHistoryState) as
    MessageHistoryState | undefined;
}
