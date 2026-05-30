import type { SessionTimelineEntry } from "@tiller/shared";
import { sortSessionTimelineEntries } from "@tiller/shared";
import { normalizePageLimit } from "./pagination";

export type SessionTimelinePageOptions = {
  limit?: number;
  before?: string;
  window?: "entry" | "message";
};

export type SessionTimelinePage = {
  entries: SessionTimelineEntry[];
  nextCursor?: string;
  hasMore: boolean;
};

const DEFAULT_TIMELINE_PAGE_LIMIT = 50;
const MAX_TIMELINE_PAGE_LIMIT = 200;
const ORDER_CURSOR_PREFIX = "order";

export function pageSessionTimeline(
  entries: SessionTimelineEntry[],
  options: SessionTimelinePageOptions = {},
): SessionTimelinePage {
  const normalized = sortSessionTimelineEntries(entries);
  const limit = normalizePageLimit(
    options.limit,
    DEFAULT_TIMELINE_PAGE_LIMIT,
    MAX_TIMELINE_PAGE_LIMIT,
  );
  const endIndex = resolvePageEndIndex(normalized, options.before);
  const eligible = normalized.slice(0, endIndex);
  const startIndex = resolvePageStartIndex(eligible, limit, options.window);
  const page = eligible.slice(startIndex);
  const hasMore = startIndex > 0;
  return {
    entries: page,
    nextCursor: hasMore ? encodeOrderCursor(startIndex, page[0]?.id) : undefined,
    hasMore,
  };
}

function resolvePageStartIndex(
  entries: SessionTimelineEntry[],
  limit: number,
  window: SessionTimelinePageOptions["window"] = "entry",
) {
  if (window !== "message") {
    return Math.max(entries.length - limit, 0);
  }

  const messageIndexes = resolveMessageWindowAnchorIndexes(entries);
  if (!messageIndexes.length) {
    return Math.max(entries.length - limit, 0);
  }
  return messageIndexes[Math.max(messageIndexes.length - limit, 0)] ?? 0;
}

function resolveMessageWindowAnchorIndexes(entries: SessionTimelineEntry[]) {
  const indexes: number[] = [];
  let previousAssistantGroupKey: string | undefined;
  entries.forEach((entry, index) => {
    if (entry.kind === "user_message" || entry.kind === "system_message") {
      indexes.push(index);
      previousAssistantGroupKey = undefined;
      return;
    }
    if (isAssistantContentWindowAnchor(entry)) {
      const groupKey = assistantMessageWindowGroupKey(entry);
      if (groupKey !== previousAssistantGroupKey) {
        indexes.push(index);
      }
      previousAssistantGroupKey = groupKey;
      return;
    }
    previousAssistantGroupKey = undefined;
  });
  return indexes;
}

function isAssistantContentWindowAnchor(
  entry: SessionTimelineEntry,
): entry is Extract<SessionTimelineEntry, { kind: "assistant_message" }> {
  return entry.kind === "assistant_message" &&
    entry.chunks.some((chunk) => chunk.kind === "content" && chunk.text.trim());
}

function assistantMessageWindowGroupKey(
  entry: Extract<SessionTimelineEntry, { kind: "assistant_message" }>,
) {
  return providerParagraphMessageBase(entry.id) ?? entry.id;
}

function providerParagraphMessageBase(id: string) {
  return /^(?<base>.+)#p\d+$/u.exec(id)?.groups?.base;
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

function resolvePageEndIndex(entries: SessionTimelineEntry[], cursor: string | undefined) {
  const orderCursor = decodeOrderCursor(cursor);
  if (!orderCursor) {
    return entries.length;
  }
  return Math.max(0, Math.min(orderCursor.position, entries.length));
}
