import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@tiller/shared";

export type SessionMessagePageOptions = {
  limit?: number;
  before?: string;
};

export type SessionMessagePage = {
  messages: AgentMessage[];
  nextCursor?: string;
  hasMore: boolean;
};

const DEFAULT_MESSAGE_PAGE_LIMIT = 50;
const MAX_MESSAGE_PAGE_LIMIT = 200;

export function createSessionMessageStore(rootDir: string) {
  return {
    append(sessionId: string, message: AgentMessage) {
      const current = listSessionMessages(rootDir, sessionId);
      const next = mergeSessionMessage(current, message);
      persistSessionMessages(rootDir, sessionId, next);
      return next;
    },
    replace(sessionId: string, messages: AgentMessage[]) {
      const next = sortAgentMessages(messages);
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

export function pageSessionMessages(messages: AgentMessage[], options: SessionMessagePageOptions = {}): SessionMessagePage {
  const sorted = sortAgentMessages(messages);
  const limit = normalizePageLimit(options.limit, DEFAULT_MESSAGE_PAGE_LIMIT, MAX_MESSAGE_PAGE_LIMIT);
  const before = decodeHistoryCursor(options.before);
  const eligible = before
    ? sorted.filter((message) => compareHistoryPosition(message.timestamp, message.id, before.timestamp, before.id) < 0)
    : sorted;
  const page = eligible.slice(Math.max(eligible.length - limit, 0));
  const hasMore = eligible.length > page.length;
  return {
    messages: page,
    nextCursor: hasMore ? encodeHistoryCursor(page[0]?.timestamp, page[0]?.id) : undefined,
    hasMore,
  };
}

function normalizePageLimit(limit: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(limit) || !limit || limit < 1) {
    return fallback;
  }
  return Math.min(Math.floor(limit), max);
}

function encodeHistoryCursor(timestamp: string | undefined, id: string | undefined) {
  return timestamp && id ? `${timestamp}\t${id}` : undefined;
}

function decodeHistoryCursor(cursor: string | undefined) {
  if (!cursor) {
    return null;
  }
  const [timestamp, id] = cursor.split("\t");
  if (!timestamp || !id) {
    return null;
  }
  return { timestamp, id };
}

function compareHistoryPosition(leftTimestamp: string, leftId: string, rightTimestamp: string, rightId: string) {
  const timestampDelta = Date.parse(leftTimestamp) - Date.parse(rightTimestamp);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return leftId.localeCompare(rightId);
}

function sortAgentMessages(messages: AgentMessage[]) {
  return [...messages].sort((left, right) => {
    const timestampDelta = Date.parse(left.timestamp) - Date.parse(right.timestamp);
    return timestampDelta === 0 ? left.id.localeCompare(right.id) : timestampDelta;
  });
}

function listSessionMessages(rootDir: string, sessionId: string) {
  try {
    const raw = readFileSync(getSessionMessageFilePath(rootDir, sessionId), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? sortAgentMessages(parsed.filter(isAgentMessage)) : [];
  } catch {
    return [];
  }
}

function mergeSessionMessage(messages: AgentMessage[], message: AgentMessage) {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index === -1) {
    return sortAgentMessages([...messages, message]);
  }

  return sortAgentMessages(messages.map((item, itemIndex) => {
    if (itemIndex !== index) {
      return item;
    }

    const isDuplicateText = item.text === message.text || item.text.endsWith(message.text);
    return {
      ...item,
      ...message,
      text: isDuplicateText ? item.text : `${item.text}${message.text}`,
      timestamp: isDuplicateText && Date.parse(message.timestamp) > Date.parse(item.timestamp) ? message.timestamp : item.timestamp,
    };
  }));
}

function persistSessionMessages(rootDir: string, sessionId: string, messages: AgentMessage[]) {
  mkdirSync(rootDir, { recursive: true });
  writeFileSync(getSessionMessageFilePath(rootDir, sessionId), JSON.stringify(messages, null, 2), "utf8");
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
