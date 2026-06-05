import type { AgentMessage } from "@tiller/shared";
import type { StoredProviderHistoryState } from "@tiller/persistence";

export type ProviderHistorySyncDecision =
  | { action: "skip"; nextState: StoredProviderHistoryState }
  | { action: "append"; messages: AgentMessage[]; nextState: StoredProviderHistoryState }
  | { action: "replace"; messages: AgentMessage[]; nextState: StoredProviderHistoryState };

export type ProviderHistorySyncOptions = {
  currentState?: StoredProviderHistoryState;
  providerMessages: AgentMessage[];
  syncedAt?: string;
};

export type AuthoritativeProviderHistoryImportOptions = {
  currentState?: StoredProviderHistoryState;
  localMessages: AgentMessage[];
};

export function shouldImportAuthoritativeProviderHistory({
  currentState,
  localMessages,
}: AuthoritativeProviderHistoryImportOptions): boolean {
  return Boolean(currentState) ||
    localMessages.length === 0 ||
    !localMessages.some((message) => message.role === "user");
}

export function planProviderHistorySync({
  currentState,
  providerMessages,
  syncedAt = new Date().toISOString(),
}: ProviderHistorySyncOptions): ProviderHistorySyncDecision {
  const nextState = buildProviderHistoryState(providerMessages, syncedAt);
  if (isSameProviderHistory(currentState, nextState)) {
    return { action: "skip", nextState };
  }

  if (!currentState?.latestMessageId) {
    return { action: "replace", messages: toParagraphMessages(providerMessages), nextState };
  }

  const latestIndex = providerMessages.findIndex(
    (message) => message.id === currentState.latestMessageId,
  );
  if (latestIndex === -1) {
    return { action: "replace", messages: toParagraphMessages(providerMessages), nextState };
  }

  const knownMessage = providerMessages[latestIndex];
  if (!knownMessage || hashProviderMessage(knownMessage) !== currentState.latestMessageHash) {
    return { action: "replace", messages: toParagraphMessages(providerMessages), nextState };
  }

  const tail = providerMessages.slice(latestIndex + 1);
  return { action: "append", messages: toParagraphMessages(tail), nextState };
}

export function buildProviderHistoryState(
  providerMessages: AgentMessage[],
  syncedAt = new Date().toISOString(),
): StoredProviderHistoryState {
  const latestMessage = providerMessages.at(-1);
  return {
    latestMessageId: latestMessage?.id,
    latestMessageHash: latestMessage ? hashProviderMessage(latestMessage) : undefined,
    latestMessageTimestamp: latestMessage?.timestamp,
    messageCount: providerMessages.length,
    syncedAt,
  };
}

export function toParagraphMessages(providerMessages: AgentMessage[]): AgentMessage[] {
  return providerMessages.flatMap((message) => splitMessageIntoParagraphs(message));
}

export function filterNewProviderHistoryMessages(
  localMessages: AgentMessage[],
  incomingMessages: AgentMessage[],
): AgentMessage[] {
  const existingIds = new Set(localMessages.map((message) => message.id));
  return incomingMessages.filter((message) => !existingIds.has(message.id));
}

export function mergeAuthoritativeMessagesWithLocalUserPrompts(
  localMessages: AgentMessage[],
  authoritativeMessages: AgentMessage[],
): AgentMessage[] {
  const mergedAuthoritativeMessages = authoritativeMessages.map((message) => {
    if (message.role !== "user") {
      return message;
    }
    const localUser = findRepresentedLocalUserWithAttachments(localMessages, message);
    return localUser ? mergeRepresentedUserMessage(localUser, message) : message;
  });
  const missingLocalUsers = localMessages.filter(
    (message) =>
      message.role === "user" && !hasRepresentedUserPrompt(mergedAuthoritativeMessages, message),
  );
  if (!missingLocalUsers.length) {
    return mergedAuthoritativeMessages;
  }
  return [...mergedAuthoritativeMessages, ...missingLocalUsers]
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const timeDelta = Date.parse(left.message.timestamp) - Date.parse(right.message.timestamp);
      return timeDelta === 0 ? left.index - right.index : timeDelta;
    })
    .map((entry) => entry.message);
}

export function shouldRepairProviderHistorySnapshot(
  localMessages: AgentMessage[],
  providerMessages: AgentMessage[],
): boolean {
  const authoritativeMessages = mergeAuthoritativeMessagesWithLocalUserPrompts(
    localMessages,
    toParagraphMessages(providerMessages),
  );
  if (localMessages.length !== authoritativeMessages.length) {
    return true;
  }

  return authoritativeMessages.some((message, index) => {
    const localMessage = localMessages[index];
    return !localMessage || !isSameStoredMessage(localMessage, message);
  });
}

function findRepresentedLocalUserWithAttachments(
  localMessages: AgentMessage[],
  providerUserMessage: AgentMessage,
) {
  const providerText = providerUserMessage.text.trim();
  return localMessages.find(
    (message) =>
      message.role === "user" &&
      Boolean(message.attachments?.length) &&
      (message.id === providerUserMessage.id || message.text.trim() === providerText),
  );
}

function mergeRepresentedUserMessage(local: AgentMessage, provider: AgentMessage): AgentMessage {
  return {
    ...provider,
    id: local.id,
    timestamp: local.timestamp,
    timelineSequence: local.timelineSequence ?? provider.timelineSequence,
    ...(local.attachments?.length ? { attachments: local.attachments } : {}),
  };
}

function hasRepresentedUserPrompt(
  authoritativeMessages: AgentMessage[],
  localUserMessage: AgentMessage,
) {
  const localText = localUserMessage.text.trim();
  return authoritativeMessages.some(
    (message) =>
      message.role === "user" &&
      (message.id === localUserMessage.id || message.text.trim() === localText),
  );
}

function isSameStoredMessage(left: AgentMessage, right: AgentMessage) {
  return (
    left.id === right.id &&
    left.role === right.role &&
    left.timestamp === right.timestamp &&
    left.text === right.text &&
    left.timelineSequence === right.timelineSequence &&
    attachmentSignature(left) === attachmentSignature(right)
  );
}

function splitMessageIntoParagraphs(message: AgentMessage): AgentMessage[] {
  if (message.role !== "assistant") {
    return [message];
  }

  const paragraphs = message.text
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const parts = paragraphs.length ? paragraphs : [message.text];
  return parts.map((text, index) => ({
    ...message,
    id: `${message.id}#p${index}`,
    text,
    ...(typeof message.timelineSequence === "number"
      ? { timelineSequence: message.timelineSequence }
      : {}),
  }));
}

function isSameProviderHistory(
  currentState: StoredProviderHistoryState | undefined,
  nextState: StoredProviderHistoryState,
) {
  if (!currentState) {
    return false;
  }

  return (
    currentState.latestMessageId === nextState.latestMessageId &&
    currentState.latestMessageHash === nextState.latestMessageHash &&
    currentState.messageCount === nextState.messageCount
  );
}

function hashProviderMessage(message: AgentMessage) {
  return stableHash(
    [
      message.id,
      message.role,
      message.timestamp,
      message.text,
      message.timelineSequence ?? "",
      attachmentSignature(message),
    ].join("\u001f"),
  ).toString(16);
}

function attachmentSignature(message: AgentMessage) {
  return (message.attachments ?? [])
    .map((attachment) => [
      attachment.type,
      attachment.mimeType,
      attachment.data,
      attachment.uri ?? "",
      attachment.name ?? "",
    ].join("\u001e"))
    .join("\u001d");
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
