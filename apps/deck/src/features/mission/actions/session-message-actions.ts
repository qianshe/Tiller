import type { AgentMessage, AgentPromptImageContent } from "@tiller/shared";
import { mergeMessageHistory, normalizeSystemMessageText } from "../../logbook";

type MessageMap = Record<string, AgentMessage[]>;

type UseSessionMessageActionsOptions = {
  setMessages: (updater: (current: MessageMap) => MessageMap) => void;
};

export function useSessionMessageActions({
  setMessages,
}: UseSessionMessageActionsOptions) {
  function createClientUserMessageId(sessionId: string) {
    return `${sessionId}-user-${Date.now()}`;
  }

  function appendSystemMessage(sessionId: string, text: string) {
    setMessages((current) => {
      const messages = current[sessionId] ?? [];
      const last = messages[messages.length - 1];
      if (last?.role === "system" && normalizeSystemMessageText(last.text) === normalizeSystemMessageText(text)) {
        const updated = [...messages];
        updated[updated.length - 1] = { ...last, timestamp: new Date().toISOString() };
        return { ...current, [sessionId]: updated };
      }
      return {
        ...current,
        [sessionId]: [
          ...messages,
          {
            id: `${sessionId}-system-${Date.now()}`,
            role: "system",
            text,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    });
  }

  function appendUserMessage(
    sessionId: string,
    text: string,
    id = createClientUserMessageId(sessionId),
    attachments: AgentPromptImageContent[] = [],
  ) {
    setMessages((current) => ({
      ...current,
      [sessionId]: mergeMessageHistory(current[sessionId] ?? [], [
        {
          id,
          role: "user",
          text,
          timestamp: new Date().toISOString(),
          ...(attachments.length ? { attachments } : {}),
        },
      ]),
    }));
  }

  return { appendSystemMessage, appendUserMessage, createClientUserMessageId };
}
