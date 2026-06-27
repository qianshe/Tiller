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
  const representedLocalUserIds = resolveRepresentedLocalUserIds(
    currentMessages,
    mergedLoadedMessages,
  );
  const loadedIds = new Set(mergedLoadedMessages.map((message) => message.id));
  const latestLoadedTime = Math.max(
    ...mergedLoadedMessages.map((message) => Date.parse(message.timestamp)).filter(Number.isFinite),
  );
  const liveMessages = currentMessages.filter((message) => {
    if (loadedIds.has(message.id)) {
      return false;
    }
    if (message.role === "user" && !representedLocalUserIds.has(message.id)) {
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
  const matchLocalUserPrompt = createLocalUserPromptMatcher(currentMessages);
  return loadedMessages.map((message) => {
    if (message.role !== "user") {
      return message;
    }
    const localUser = matchLocalUserPrompt(message);
    return localUser?.attachments?.length ? mergeRepresentedLoadedUser(localUser, message) : message;
  });
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

function resolveRepresentedLocalUserIds(
  currentMessages: AgentMessage[],
  loadedMessages: AgentMessage[],
) {
  const matchLocalUserPrompt = createLocalUserPromptMatcher(currentMessages);
  const represented = new Set<string>();
  for (const message of loadedMessages) {
    if (message.role !== "user") {
      continue;
    }
    const localUser = matchLocalUserPrompt(message);
    if (localUser) {
      represented.add(localUser.id);
    }
  }
  return represented;
}

function createLocalUserPromptMatcher(currentMessages: AgentMessage[]) {
  const candidates = currentMessages.filter((message) => message.role === "user");
  return (loadedUserMessage: AgentMessage) => {
    const matchIndex = findRepresentedLocalUserIndex(candidates, loadedUserMessage);
    if (matchIndex === -1) {
      return null;
    }
    const [match] = candidates.splice(matchIndex, 1);
    return match ?? null;
  };
}

function findRepresentedLocalUserIndex(
  candidates: AgentMessage[],
  loadedUserMessage: AgentMessage,
) {
  const idMatchIndex = candidates.findIndex((message) => message.id === loadedUserMessage.id);
  if (idMatchIndex !== -1) {
    return idMatchIndex;
  }

  const loadedText = loadedUserMessage.text.trim();
  let nearestIndex = -1;
  let nearestDelta = Number.POSITIVE_INFINITY;
  let textFallbackIndex = -1;
  const loadedTime = Date.parse(loadedUserMessage.timestamp);
  for (const [index, message] of candidates.entries()) {
    if (message.text.trim() !== loadedText) {
      continue;
    }
    if (textFallbackIndex === -1) {
      textFallbackIndex = index;
    }
    const localTime = Date.parse(message.timestamp);
    const delta = Math.abs(localTime - loadedTime);
    if (Number.isFinite(delta) && delta < nearestDelta) {
      nearestDelta = delta;
      nearestIndex = index;
    }
  }

  return nearestIndex === -1 ? textFallbackIndex : nearestIndex;
}
