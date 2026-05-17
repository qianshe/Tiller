import type { AgentMessage } from "@tiller/shared";
import type { StoredProviderHistoryState } from "./runtime-store.js";

export type ProviderHistorySyncDecision =
  | { action: "skip"; nextState: StoredProviderHistoryState }
  | { action: "append"; messages: AgentMessage[]; nextState: StoredProviderHistoryState }
  | { action: "replace"; messages: AgentMessage[]; nextState: StoredProviderHistoryState };

export type ProviderHistorySyncOptions = {
  currentState?: StoredProviderHistoryState;
  providerMessages: AgentMessage[];
  syncedAt?: string;
};

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

export function shouldRepairProviderHistorySnapshot(
  localMessages: AgentMessage[],
  providerMessages: AgentMessage[],
): boolean {
  const authoritativeMessages = toParagraphMessages(providerMessages);
  if (localMessages.length !== authoritativeMessages.length) {
    return true;
  }

  return authoritativeMessages.some((message, index) => {
    const localMessage = localMessages[index];
    return !localMessage || !isSameStoredMessage(localMessage, message);
  });
}

function isSameStoredMessage(left: AgentMessage, right: AgentMessage) {
  return (
    left.id === right.id &&
    left.role === right.role &&
    left.timestamp === right.timestamp &&
    left.text === right.text
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
    `${message.id}\u001f${message.role}\u001f${message.timestamp}\u001f${message.text}`,
  ).toString(16);
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
