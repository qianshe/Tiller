import type {
  AgentMessage,
  AgentPromptContent,
  AgentPromptImageContent,
} from "@tiller/shared";
import { mergeMessageHistory, sortAgentMessagesByTimeline } from "../logbook";

export function pendingInitialPromptMessageId(sessionId: string) {
  return `${sessionId}-user-pending`;
}

export function pendingPromptImages(content: AgentPromptContent[] | undefined) {
  return content?.filter(
    (item): item is AgentPromptImageContent => item.type === "image",
  ) ?? [];
}

export function replaceInitialMessageHistory(
  currentMessages: AgentMessage[],
  loadedMessages: AgentMessage[],
): AgentMessage[] {
  const mergedLoadedMessages = mergeLoadedMessagesWithLocalUserAttachments(
    currentMessages,
    loadedMessages,
  );
  const loadedIds = new Set(mergedLoadedMessages.map((message) => message.id));
  const latestLoadedTime = Math.max(
    ...mergedLoadedMessages.map((message) => Date.parse(message.timestamp)).filter(Number.isFinite),
  );
  const liveMessages = currentMessages.filter((message) => {
    if (loadedIds.has(message.id)) {
      return false;
    }
    if (message.role === "user" && !hasRepresentedUserPrompt(mergedLoadedMessages, message)) {
      return true;
    }
    if (message.streaming === true) {
      return true;
    }
    const messageTime = Date.parse(message.timestamp);
    return Number.isFinite(messageTime) && messageTime > latestLoadedTime;
  });
  return sortAgentMessagesByTimeline(mergeMessageHistory(mergedLoadedMessages, liveMessages));
}

function mergeLoadedMessagesWithLocalUserAttachments(
  currentMessages: AgentMessage[],
  loadedMessages: AgentMessage[],
): AgentMessage[] {
  return loadedMessages.map((message) => {
    if (message.role !== "user") {
      return message;
    }
    const localUser = findRepresentedLocalUserWithAttachments(currentMessages, message);
    return localUser ? mergeRepresentedLoadedUser(localUser, message) : message;
  });
}

function findRepresentedLocalUserWithAttachments(
  currentMessages: AgentMessage[],
  loadedUserMessage: AgentMessage,
) {
  const loadedText = loadedUserMessage.text.trim();
  return currentMessages.find(
    (message) =>
      message.role === "user" &&
      Boolean(message.attachments?.length) &&
      (message.id === loadedUserMessage.id || message.text.trim() === loadedText),
  );
}

function mergeRepresentedLoadedUser(local: AgentMessage, loaded: AgentMessage): AgentMessage {
  return {
    ...loaded,
    id: local.id,
    timestamp: local.timestamp,
    timelineSequence: local.timelineSequence ?? loaded.timelineSequence,
    ...(local.attachments?.length ? { attachments: local.attachments } : {}),
  };
}

function hasRepresentedUserPrompt(
  loadedMessages: AgentMessage[],
  localUserMessage: AgentMessage,
) {
  const localText = localUserMessage.text.trim();
  return loadedMessages.some(
    (message) =>
      message.role === "user" &&
      (message.id === localUserMessage.id || message.text.trim() === localText),
  );
}
