import type { AgentMessage } from "@tiller/shared";
import { normalizeSessionMessages } from "./normalize.js";
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
const PROVIDER_PARAGRAPH_MESSAGE_ID_PATTERN = /^(?<base>.+)#p\d+$/u;

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
  const pageStartIndex = expandPageStartForProviderParagraphGroup(
    normalized,
    startIndex,
    endIndex,
  );
  const page = eligible.slice(pageStartIndex);
  const hasMore = pageStartIndex > 0;
  return {
    messages: page,
    nextCursor: hasMore ? encodeOrderCursor(pageStartIndex, page[0]?.id) : undefined,
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

function expandPageStartForProviderParagraphGroup(
  messages: AgentMessage[],
  startIndex: number,
  endIndex: number,
) {
  if (startIndex <= 0 || startIndex >= endIndex) {
    return startIndex;
  }

  const base = providerParagraphMessageBase(messages[startIndex]?.id);
  if (!base) {
    return startIndex;
  }

  let expandedStart = startIndex;
  while (
    expandedStart > 0 &&
    providerParagraphMessageBase(messages[expandedStart - 1]?.id) === base
  ) {
    expandedStart -= 1;
  }
  return expandedStart;
}

function providerParagraphMessageBase(id: string | undefined) {
  return id ? PROVIDER_PARAGRAPH_MESSAGE_ID_PATTERN.exec(id)?.groups?.base : undefined;
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
