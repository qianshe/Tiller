import { useMemo } from "react";
import type { AgentMessage, AgentToolCall } from "@tiller/shared";

export function createActiveConversationUpdateKey(
  activeSessionId: string | null,
  activeSessionMessages: AgentMessage[],
  activeSessionToolCalls: AgentToolCall[] = [],
) {
  const lastMessage = activeSessionMessages.at(-1);
  const lastToolCall = activeSessionToolCalls.at(-1);
  return [
    activeSessionId ?? "",
    activeSessionMessages.length,
    lastMessage?.timestamp ?? "",
    lastMessage?.text.length ?? 0,
    activeSessionToolCalls.length,
    lastToolCall?.updatedAt ?? lastToolCall?.timestamp ?? "",
    lastToolCall?.output?.length ?? 0,
  ].join("|");
}

export function useActiveConversationUpdateKey(
  activeSessionId: string | null,
  activeSessionMessages: AgentMessage[],
  activeSessionToolCalls: AgentToolCall[] = [],
) {
  return useMemo(
    () => createActiveConversationUpdateKey(
      activeSessionId,
      activeSessionMessages,
      activeSessionToolCalls,
    ),
    [activeSessionId, activeSessionMessages, activeSessionToolCalls],
  );
}
