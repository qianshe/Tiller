import type { SessionTimelineBatch } from "@tiller/shared";
import {
  sortAssistantTimelineChunks,
  type SessionTimelineEntry,
} from "@tiller/shared";
import { normalizePageLimit } from "./pagination";

export type SessionTimelinePageOptions = {
  limit?: number;
  entryLimit?: number;
  before?: string;
  window?: "entry" | "message" | "turn";
};

export type SessionTimelinePage = {
  entries: SessionTimelineEntry[];
  nextCursor?: string;
  hasMore: boolean;
};

export type SessionTimelinePositionedEntry = {
  position: number;
  entry: SessionTimelineEntry;
};

export type SessionTimelineMessageGroupAnchor = {
  groupId: string;
  groupKind: "user" | "assistant";
  anchorPosition: number;
  startPosition: number;
  anchorTimestamp: string;
};

const DEFAULT_TIMELINE_PAGE_LIMIT = 50;
const MAX_TIMELINE_PAGE_LIMIT = 200;
const ORDER_CURSOR_PREFIX = "order";

export function pageSessionTimeline(
  entries: SessionTimelineEntry[],
  options: SessionTimelinePageOptions = {},
): SessionTimelinePage {
  const normalized = normalizeTimelineEntriesForPage(entries);
  const limit = normalizePageLimit(
    options.limit,
    DEFAULT_TIMELINE_PAGE_LIMIT,
    MAX_TIMELINE_PAGE_LIMIT,
  );
  const endIndex = resolvePageEndIndex(normalized, options.before);
  const eligible = normalized.slice(0, endIndex);
  const startIndex = resolvePageStartIndex(eligible, limit, options);
  const page = eligible.slice(startIndex);
  const hasMore = startIndex > 0;
  return {
    entries: page,
    nextCursor: hasMore ? encodeOrderCursor(startIndex, page[0]?.id) : undefined,
    hasMore,
  };
}

function normalizeTimelineEntriesForPage(entries: SessionTimelineEntry[]) {
  return entries.map((entry) => entry.kind === "assistant_message"
    ? { ...entry, chunks: sortAssistantTimelineChunks(entry.chunks) }
    : entry,
  );
}

function resolvePageStartIndex(
  entries: SessionTimelineEntry[],
  limit: number,
  options: SessionTimelinePageOptions,
) {
  if (options.window === "turn") {
    const turnAnchors = buildSessionTimelineMessageGroupAnchors(
      entries.map((entry, position) => ({ position, entry })),
    ).filter((anchor) => anchor.groupKind === "user");
    if (turnAnchors.length) {
      return turnAnchors.length <= limit
        ? 0
        : turnAnchors[turnAnchors.length - limit]?.startPosition ?? 0;
    }
  }

  if (options.window !== "message" && options.window !== "turn") {
    return Math.max(entries.length - limit, 0);
  }

  const anchors = buildSessionTimelineMessageGroupAnchors(
    entries.map((entry, position) => ({ position, entry })),
  );
  const messageStartIndex = anchors.length
    ? anchors.length <= limit
      ? 0
      : anchors[anchors.length - limit]?.startPosition ?? 0
    : Math.max(entries.length - limit, 0);
  const entryLimit = normalizePageLimit(
    options.entryLimit,
    MAX_TIMELINE_PAGE_LIMIT,
    MAX_TIMELINE_PAGE_LIMIT,
  );
  return Math.max(messageStartIndex, entries.length - entryLimit, 0);
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

export function encodeSessionTimelineOrderCursor(
  position: number | undefined,
  id: string | undefined,
) {
  return Number.isInteger(position) && id
    ? `${ORDER_CURSOR_PREFIX}\t${position}\t${id}`
    : undefined;
}

export function decodeSessionTimelineOrderCursor(cursor: string | undefined) {
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

export function resolveSessionTimelineMessageGroupId(entry: SessionTimelineEntry) {
  return resolveSessionTimelineMessageGroup(entry)?.groupId;
}

export function buildSessionTimelineMessageGroupAnchors(
  positionedEntries: SessionTimelinePositionedEntry[],
  options: { seenGroupIds?: Iterable<string> } = {},
): SessionTimelineMessageGroupAnchor[] {
  const anchors: SessionTimelineMessageGroupAnchor[] = [];
  const seenGroupIds = new Set<string>(options.seenGroupIds);
  let pendingTranscriptStart: number | undefined;

  for (const { position, entry } of positionedEntries) {
    if (isTranscriptPrefixEntry(entry)) {
      pendingTranscriptStart ??= position;
      continue;
    }

    const group = resolveSessionTimelineMessageGroup(entry);
    if (!group) {
      continue;
    }

    // Transcript boundaries split message-window groups even when the next
    // visible assistant segment reuses the same provider paragraph base id.
    if (seenGroupIds.has(group.groupId) && pendingTranscriptStart === undefined) {
      continue;
    }

    seenGroupIds.add(group.groupId);
    anchors.push({
      groupId: group.groupId,
      groupKind: group.groupKind,
      anchorPosition: position,
      startPosition: pendingTranscriptStart ?? position,
      anchorTimestamp: group.anchorTimestamp,
    });
    pendingTranscriptStart = undefined;
  }

  return anchors;
}

function resolveSessionTimelineMessageGroup(entry: SessionTimelineEntry) {
  if (entry.kind === "user_message") {
    return {
      groupId: entry.id,
      groupKind: "user" as const,
      anchorTimestamp: entry.message.timestamp,
    };
  }
  if (!isAssistantContentWindowAnchor(entry)) {
    return undefined;
  }
  return {
    groupId: assistantMessageWindowGroupKey(entry),
    groupKind: "assistant" as const,
    anchorTimestamp:
      entry.chunks.find((chunk) => chunk.kind === "content" && chunk.text.trim())?.timestamp ??
      entry.timestamp,
  };
}

function isTranscriptPrefixEntry(entry: SessionTimelineEntry) {
  return entry.kind === "context_compaction" ||
    entry.kind === "history_gap";
}

function resolvePageEndIndex(entries: SessionTimelineEntry[], cursor: string | undefined) {
  const orderCursor = decodeSessionTimelineOrderCursor(cursor);
  if (!orderCursor) {
    return entries.length;
  }
  return Math.max(0, Math.min(orderCursor.position, entries.length));
}

function encodeOrderCursor(position: number | undefined, id: string | undefined) {
  return encodeSessionTimelineOrderCursor(position, id);
}
