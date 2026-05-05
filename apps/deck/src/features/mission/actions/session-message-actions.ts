import type { AgentMessage, AgentPromptImageContent } from "@tiller/shared";
import { mergeMessageHistory } from "../../logbook";

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
    setMessages((current) => ({
      ...current,
      [sessionId]: [
        ...(current[sessionId] ?? []),
        {
          id: `${sessionId}-system-${Date.now()}`,
          role: "system",
          text,
          timestamp: new Date().toISOString(),
        },
      ],
    }));
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
