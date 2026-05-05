import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@tiller/shared";
import { normalizePageLimit } from "./pagination";

export type SessionMessagePageOptions = {
  limit?: number;
  before?: string;
};

export type SessionMessagePage = {
  messages: AgentMessage[];
  nextCursor?: string;
  hasMore: boolean;
};

const DEFAULT_MESSAGE_PAGE_LIMIT = 20;
const MAX_MESSAGE_PAGE_LIMIT = 200;
const ORDER_CURSOR_PREFIX = "order";

export function createSessionMessageStore(rootDir: string) {
  return {
    append(sessionId: string, message: AgentMessage) {
      const current = listSessionMessages(rootDir, sessionId);
      const next = mergeSessionMessage(current, message);
      persistSessionMessages(rootDir, sessionId, next);
      return next;
    },
    replace(sessionId: string, messages: AgentMessage[]) {
      const next = normalizeSessionMessages(messages);
      persistSessionMessages(rootDir, sessionId, next);
      return next;
    },
    list(sessionId: string) {
      return listSessionMessages(rootDir, sessionId);
    },
    listPage(sessionId: string, options: SessionMessagePageOptions = {}) {
      return pageSessionMessages(listSessionMessages(rootDir, sessionId), options);
    },
    remove(sessionId: string) {
      try {
        unlinkSync(getSessionMessageFilePath(rootDir, sessionId));
      } catch {
        // ignore missing file
      }
    },
  };
}

export function pageSessionMessages(
  messages: AgentMessage[],
  options: SessionMessagePageOptions = {},
): SessionMessagePage {
  const normalized = normalizeSessionMessages(messages);
  const limit = normalizePageLimit(
    options.limit,
    DEFAULT_MESSAGE_PAGE_LIMIT,
    MAX_MESSAGE_PAGE_LIMIT,
  );
  const endIndex = resolvePageEndIndex(normalized, options.before);
  const eligible = normalized.slice(0, endIndex);
  const startIndex = Math.max(eligible.length - limit, 0);
  const page = eligible.slice(startIndex);
  const hasMore = startIndex > 0;
  return {
    messages: page,
    nextCursor: hasMore ? encodeOrderCursor(startIndex, page[0]?.id) : undefined,
    hasMore,
  };
}

function encodeOrderCursor(position: number | undefined, id: string | undefined) {
  return Number.isInteger(position) && id
    ? `${ORDER_CURSOR_PREFIX}\t${position}\t${id}`
    : undefined;
}

function decodeOrderCursor(cursor: string | undefined) {
  if (!cursor) {
    return null;
  }
  const [prefix, position, id] = cursor.split("\t");
  if (prefix !== ORDER_CURSOR_PREFIX || !position || !id) {
    return null;
  }
  const parsedPosition = Number.parseInt(position, 10);
  return Number.isFinite(parsedPosition) && parsedPosition >= 0
    ? { position: parsedPosition, id }
    : null;
}

function decodeLegacyHistoryCursor(cursor: string | undefined) {
  if (!cursor) {
    return null;
  }
  const [timestamp, id] = cursor.split("\t");
  if (!timestamp || !id || timestamp === ORDER_CURSOR_PREFIX) {
    return null;
  }
  return { timestamp, id };
}

function resolvePageEndIndex(messages: AgentMessage[], cursor: string | undefined) {
  const orderCursor = decodeOrderCursor(cursor);
  if (orderCursor) {
    return Math.max(0, Math.min(orderCursor.position, messages.length));
  }

  const legacyCursor = decodeLegacyHistoryCursor(cursor);
  if (!legacyCursor) {
    return messages.length;
  }

  const exactIndex = messages.findIndex(
    (message) => message.timestamp === legacyCursor.timestamp && message.id === legacyCursor.id,
  );
  if (exactIndex !== -1) {
    return exactIndex;
  }

  const compatibleIndex = messages.findIndex(
    (message) =>
      compareHistoryPosition(
        message.timestamp,
        message.id,
        legacyCursor.timestamp,
        legacyCursor.id,
      ) >= 0,
  );
  return compatibleIndex === -1 ? messages.length : compatibleIndex;
}

function compareHistoryPosition(
  leftTimestamp: string,
  leftId: string,
  rightTimestamp: string,
  rightId: string,
) {
  const timestampDelta = Date.parse(leftTimestamp) - Date.parse(rightTimestamp);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return leftId.localeCompare(rightId);
}

function listSessionMessages(rootDir: string, sessionId: string) {
  try {
    const raw = readFileSync(getSessionMessageFilePath(rootDir, sessionId), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeSessionMessages(parsed.filter(isAgentMessage)) : [];
  } catch {
    return [];
  }
}

function mergeSessionMessage(messages: AgentMessage[], message: AgentMessage) {
  return normalizeSessionMessages([...messages, message]);
}

function normalizeSessionMessages(messages: AgentMessage[]) {
  return messages.reduce<AgentMessage[]>((merged, message) => {
    const existingIndex = merged.findIndex((item) => item.id === message.id);
    if (existingIndex !== -1) {
      merged[existingIndex] = mergeAgentMessageChunk(merged[existingIndex]!, message);
      return merged;
    }

    const last = merged.at(-1);
    if (!last || !shouldMergeAssistantStreamChunk(last, message)) {
      return [...merged, message];
    }

    merged[merged.length - 1] = mergeAgentMessageChunk(last, message);
    return merged;
  }, []);
}

function shouldMergeAssistantStreamChunk(current: AgentMessage, incoming: AgentMessage) {
  return (
    current.role === "assistant" &&
    incoming.role === "assistant" &&
    isRuntimeGeneratedMessageId(current.id) &&
    isRuntimeGeneratedMessageId(incoming.id)
  );
}

function isRuntimeGeneratedMessageId(id: string) {
  return /-msg-\d+$/u.test(id);
}

function mergeAgentMessageChunk(current: AgentMessage, incoming: AgentMessage): AgentMessage {
  const isDuplicateText = current.text === incoming.text || current.text.endsWith(incoming.text);
  const isCumulativeSnapshot = incoming.text.startsWith(current.text);
  const nextText = isDuplicateText
    ? current.text
    : isCumulativeSnapshot
      ? incoming.text
      : `${current.text}${incoming.text}`;
  return {
    ...current,
    ...incoming,
    id: current.id,
    text: collapseRepeatedAssistantText(nextText),
    timestamp:
      isDuplicateText && Date.parse(incoming.timestamp) > Date.parse(current.timestamp)
        ? incoming.timestamp
        : current.timestamp,
  };
}

function collapseRepeatedAssistantText(text: string) {
  const firstLine = text.split(/\r?\n/u)[0]?.trim();
  if (!firstLine || firstLine.length < 8) {
    return text;
  }

  const repeatIndex = text.indexOf(firstLine, firstLine.length);
  if (repeatIndex === -1) {
    return text;
  }

  const bridgeIndex = text.lastIndexOf("我会按 `superpowers`", repeatIndex);
  const cutIndex =
    bridgeIndex !== -1 && repeatIndex - bridgeIndex < 240 ? bridgeIndex : repeatIndex;
  return text.slice(0, cutIndex).trimEnd();
}

function persistSessionMessages(rootDir: string, sessionId: string, messages: AgentMessage[]) {
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(
    getSessionMessageFilePath(rootDir, sessionId),
    JSON.stringify(messages, null, 2),
    "utf8",
  );
}

function getSessionMessageFilePath(rootDir: string, sessionId: string) {
  return join(rootDir, `${sessionId}.json`);
}

function isAgentMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.text === "string" &&
    typeof candidate.timestamp === "string"
  );
}
