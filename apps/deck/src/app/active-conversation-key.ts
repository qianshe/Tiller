import { useMemo } from "react";
import type { AgentMessage } from "@tiller/shared";

export function useActiveConversationUpdateKey(
  activeSessionId: string | null,
  activeSessionMessages: AgentMessage[],
) {
  return useMemo(() => {
    const lastMessage = activeSessionMessages.at(-1);
    return [
      activeSessionId ?? "",
      activeSessionMessages.length,
      lastMessage?.timestamp ?? "",
      lastMessage?.text.length ?? 0,
    ].join("|");
  }, [activeSessionId, activeSessionMessages]);
}
