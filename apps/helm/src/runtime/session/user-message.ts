import type { AgentMessage, AgentPromptContent } from "@tiller/shared";

export type UserPromptMessageInput = {
  sessionId: string;
  text: string;
  content?: AgentPromptContent[];
  clientMessageId: string;
  timestamp: string;
};

export function createUserPromptMessage(
  item: UserPromptMessageInput,
  allocateTimelineSequence: (sessionId: string) => number,
): AgentMessage {
  const imageAttachments = item.content?.filter((content) => content.type === "image") ?? [];
  return {
    id: item.clientMessageId,
    role: "user" as const,
    text: item.text,
    timestamp: item.timestamp,
    sequence: allocateTimelineSequence(item.sessionId),
    ...(imageAttachments.length ? { attachments: imageAttachments } : {}),
  };
}
