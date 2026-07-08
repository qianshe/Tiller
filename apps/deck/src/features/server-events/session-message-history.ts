import type {
  AgentMessage,
  AgentPromptContent,
  AgentPromptImageContent,
} from "@tiller/shared";
import {
  findEquivalentReplayDuplicateMessageIndex,
  normalizeComparableReplayText,
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
  const representedLocalAssistantIds = resolveRepresentedLocalAssistantIds(
    currentMessages,
    mergedLoadedMessages,
  );
  const anchoredLocalAssistantIds = resolveAnchoredLocalAssistantIds(
    currentMessages,
    representedLocalUserIds,
    representedLocalAssistantIds,
  );
  const loadedIds = new Set(mergedLoadedMessages.map((message) => message.id));
  const latestLoadedTime = Math.max(
    ...mergedLoadedMessages.map((message) => Date.parse(message.timestamp)).filter(Number.isFinite),
  );
  const liveMessages: AgentMessage[] = [];
  for (const message of currentMessages) {
    if (loadedIds.has(message.id)) {
      continue;
    }
    if (findEquivalentReplayDuplicateMessageIndex(mergedLoadedMessages, message) !== -1) {
      continue;
    }
    if (findEquivalentReplayDuplicateMessageIndex(liveMessages, message) !== -1) {
      continue;
    }
    if (message.role === "user" && !representedLocalUserIds.has(message.id)) {
      liveMessages.push(message);
      continue;
    }
    if (message.role === "assistant") {
      if (representedLocalAssistantIds.has(message.id)) {
        continue;
      }
      if (anchoredLocalAssistantIds.has(message.id)) {
        liveMessages.push(message);
        continue;
      }
    }
    if (message.streaming === true) {
      liveMessages.push(message);
      continue;
    }
    const messageTime = Date.parse(message.timestamp);
    if (Number.isFinite(messageTime) && messageTime > latestLoadedTime) {
      liveMessages.push(message);
    }
  }
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
    sequence: local.sequence ?? loaded.sequence,
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

function resolveRepresentedLocalAssistantIds(
  currentMessages: AgentMessage[],
  loadedMessages: AgentMessage[],
) {
  const matchLocalAssistantMessage = createLocalAssistantMessageMatcher(currentMessages);
  const represented = new Set<string>();
  for (const message of loadedMessages) {
    if (message.role !== "assistant") {
      continue;
    }
    const localAssistant = matchLocalAssistantMessage(message);
    if (localAssistant) {
      represented.add(localAssistant.id);
    }
  }
  return represented;
}

function resolveAnchoredLocalAssistantIds(
  currentMessages: AgentMessage[],
  representedLocalUserIds: ReadonlySet<string>,
  representedLocalAssistantIds: ReadonlySet<string>,
) {
  const preserved = new Set<string>();
  let withinRepresentedWindow = false;
  let pendingAssistantIds: string[] = [];
  for (const message of currentMessages) {
    if (message.role === "user") {
      if (representedLocalUserIds.has(message.id)) {
        if (withinRepresentedWindow) {
          for (const assistantId of pendingAssistantIds) {
            preserved.add(assistantId);
          }
        }
        withinRepresentedWindow = true;
        pendingAssistantIds = [];
        continue;
      }
      withinRepresentedWindow = false;
      pendingAssistantIds = [];
      continue;
    }
    if (
      withinRepresentedWindow &&
      message.role === "assistant" &&
      Boolean(message.text.trim()) &&
      !representedLocalAssistantIds.has(message.id)
    ) {
      pendingAssistantIds.push(message.id);
    }
  }
  return preserved;
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

function createLocalAssistantMessageMatcher(currentMessages: AgentMessage[]) {
  const candidates = currentMessages.filter((message) =>
    message.role === "assistant" && Boolean(message.text.trim())
  );
  return (loadedAssistantMessage: AgentMessage) => {
    const matchIndex = findRepresentedLocalAssistantIndex(candidates, loadedAssistantMessage);
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

function findRepresentedLocalAssistantIndex(
  candidates: AgentMessage[],
  loadedAssistantMessage: AgentMessage,
) {
  const idMatchIndex = candidates.findIndex((message) => message.id === loadedAssistantMessage.id);
  if (idMatchIndex !== -1) {
    return idMatchIndex;
  }

  const loadedText = normalizeComparableReplayText(loadedAssistantMessage.text);
  const loadedTime = Date.parse(loadedAssistantMessage.timestamp);
  let nearestIndex = -1;
  let nearestDelta = Number.POSITIVE_INFINITY;
  for (const [index, message] of candidates.entries()) {
    const normalizedCandidateText = normalizeComparableReplayText(message.text);
    if (
      !normalizedCandidateText ||
      (
        normalizedCandidateText !== loadedText &&
        !normalizedCandidateText.includes(loadedText) &&
        !loadedText.includes(normalizedCandidateText)
      )
    ) {
      continue;
    }
    if (
      typeof loadedAssistantMessage.sequence === "number" &&
      typeof message.sequence === "number" &&
      loadedAssistantMessage.sequence === message.sequence
    ) {
      return index;
    }
    const localTime = Date.parse(message.timestamp);
    const delta = Math.abs(localTime - loadedTime);
    if (Number.isFinite(delta) && delta <= 10_000 && delta < nearestDelta) {
      nearestDelta = delta;
      nearestIndex = index;
    }
  }

  return nearestIndex;
}
