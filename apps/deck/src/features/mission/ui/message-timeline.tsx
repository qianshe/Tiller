import type { AgentMessage } from "@tiller/shared";
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
  sessionId?: string;
  assistantLabel?: string;
  copy: MissionMessageTimelineCopy;
  expandedMessageIds: ReadonlySet<string>;
  boundaryTimestamps?: string[];
  historyStateBySession: Record<string, MessageHistoryState | undefined>;
  onLoadOlderMessages: (sessionId: string) => void;
  onToggleExpandedMessage: (messageId: string) => void;
};

/**
 * Binds session history state to the plain mission message list.
 */
export function MissionMessageTimeline({
  items,
  sessionId,
  assistantLabel,
  copy,
  expandedMessageIds,
  boundaryTimestamps = [],
  historyStateBySession,
  onLoadOlderMessages,
  onToggleExpandedMessage,
}: MissionMessageTimelineProps) {
  return (
    <PlainMessages
      sessionId={sessionId ?? null}
      items={items}
      emptyText={copy.waitingForAgent}
      assistantLabel={assistantLabel ?? copy.role.assistant}
      roleLabels={copy.role}
      expandedMessageIds={expandedMessageIds}
      boundaryTimestamps={boundaryTimestamps}
      historyState={sessionId ? historyStateBySession[sessionId] : undefined}
      onLoadOlderMessages={() => {
        if (sessionId) {
          onLoadOlderMessages(sessionId);
        }
      }}
      onToggleExpandedMessage={onToggleExpandedMessage}
    />
  );
}
