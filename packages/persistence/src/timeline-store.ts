import type { SessionTimelineEntry } from "@tiller/shared";
import { sortSessionTimelineEntries } from "@tiller/shared";
import { normalizePageLimit } from "./pagination";

export type SessionTimelinePageOptions = {
  limit?: number;
  before?: string;
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
  const startIndex = Math.max(eligible.length - limit, 0);
  const page = eligible.slice(startIndex);
  const hasMore = startIndex > 0;
  return {
    entries: page,
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

function resolvePageEndIndex(entries: SessionTimelineEntry[], cursor: string | undefined) {
  const orderCursor = decodeOrderCursor(cursor);
  if (!orderCursor) {
    return entries.length;
  }
  return Math.max(0, Math.min(orderCursor.position, entries.length));
}
