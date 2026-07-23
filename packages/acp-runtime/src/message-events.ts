import type { SessionRuntimeEvent } from "./runtime-types";
import {
  extractTextContent,
  resolveSessionUpdateType,
  serializableStringFrom,
  type UnknownRecord,
} from "./session-update";

export function projectMessageEvent(
  sessionId: string,
  updateType: string | undefined,
  update: UnknownRecord,
  text: string | null,
): Extract<SessionRuntimeEvent, { type: "message" }> | null {
  if (!text) {
    return null;
  }
  return {
    type: "message",
    message: {
      id: resolveMessageId(sessionId, update),
      role: updateType === "user_message_chunk" ? "user" : "assistant",
      text,
      timestamp: nowTimestamp(),
      streamMode: "delta",
    },
  };
}

export function resolveMessageId(sessionId: string, update: UnknownRecord): string {
  const message = update.message && typeof update.message === "object"
    ? update.message as UnknownRecord
    : {};
  return serializableStringFrom(update.messageId ?? update.message_id ?? message.id ?? update.id) ??
    `${sessionId}-msg-${hashStableMessageSeed(sessionId, update)}`;
}

export function resolveEventTimestamp(update: UnknownRecord): string {
  const message = update.message && typeof update.message === "object"
    ? update.message as UnknownRecord
    : {};
  return serializableStringFrom(update.timestamp ?? message.timestamp) ?? nowTimestamp();
}

function hashStableMessageSeed(sessionId: string, update: UnknownRecord): string {
  const updateType = resolveSessionUpdateType(update) ?? "message";
  const text = extractTextContent(update.content) ??
    extractTextContent(update.delta) ??
    extractTextContent(update.message) ??
    "";
  return stableHash(`${sessionId}\u001f${updateType}\u001f${text}`).toString(10);
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function nowTimestamp(): string {
  return new Date().toISOString();
}
