import type { SessionTimelineBatch } from "@tiller/shared";
import {
  isLaterReplayDuplicate,
  normalizeComparableReplayText,
  sortAssistantTimelineChunks,
  type SessionTimelineEntry,
} from "@tiller/shared";
import { normalizePageLimit } from "./pagination";

export type SessionTimelinePageOptions = {
  limit?: number;
  entryLimit?: number;
  before?: string;
  window?: "entry" | "message";
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
  const normalizedEntries = entries.map((entry) => entry.kind === "assistant_message"
    ? { ...entry, chunks: sortAssistantTimelineChunks(entry.chunks) }
    : entry,
  );
  const duplicateIds = collectEquivalentReplayDuplicateTimelineEntryIds(normalizedEntries);
  return duplicateIds.size
    ? normalizedEntries.filter((entry) => !duplicateIds.has(entry.id))
    : normalizedEntries;
}

function resolvePageStartIndex(
  entries: SessionTimelineEntry[],
  limit: number,
  options: SessionTimelinePageOptions,
) {
  if (options.window !== "message") {
    return Math.max(entries.length - limit, 0);
  }

  const messageIndexes = resolveMessageWindowAnchorIndexes(entries);
  const messageStartIndex = messageIndexes.length
    ? messageIndexes.length <= limit
      ? 0
      : messageIndexes[messageIndexes.length - limit] ?? 0
    : Math.max(entries.length - limit, 0);
  const entryLimit = normalizePageLimit(
    options.entryLimit,
    MAX_TIMELINE_PAGE_LIMIT,
    MAX_TIMELINE_PAGE_LIMIT,
  );
  return Math.max(messageStartIndex, entries.length - entryLimit, 0);
}

type ReplayDuplicateTimelineObservation = {
  id: string;
  index: number;
  role: "user" | "assistant";
  text: string;
  timestamp: string;
  sequence: number;
};

function collectEquivalentReplayDuplicateTimelineEntryIds(entries: SessionTimelineEntry[]) {
  const duplicateIds = new Set<string>();
  const observations = entries
    .map((entry, index) => toReplayDuplicateTimelineObservation(entry, index))
    .filter((entry): entry is ReplayDuplicateTimelineObservation => Boolean(entry))
    .sort((left, right) => {
      const timestampDelta = Date.parse(left.timestamp) - Date.parse(right.timestamp);
      return timestampDelta === 0 ? left.index - right.index : timestampDelta;
    });
  const seenBySignature = new Map<string, ReplayDuplicateTimelineObservation[]>();
  for (const observation of observations) {
    const signature = `${observation.role}\u001f${observation.text}`;
    const seen = seenBySignature.get(signature) ?? [];
    if (seen.some((candidate) => isLaterReplayDuplicate(candidate, observation))) {
      duplicateIds.add(observation.id);
      continue;
    }
    seen.push(observation);
    seenBySignature.set(signature, seen);
  }
  return duplicateIds;
}

function toReplayDuplicateTimelineObservation(
  entry: SessionTimelineEntry,
  index: number,
): ReplayDuplicateTimelineObservation | null {
  if (entry.kind === "user_message") {
    return typeof entry.message.sequence === "number" && entry.message.text.trim()
      ? {
          id: entry.id,
          index,
          role: "user",
          text: normalizeComparableReplayText(entry.message.text),
          timestamp: entry.message.timestamp,
          sequence: entry.message.sequence,
        }
      : null;
  }
  if (entry.kind !== "assistant_message") {
    return null;
  }
  const text = entry.chunks
    .filter((chunk) => chunk.kind === "content")
    .map((chunk) => chunk.text)
    .join("")
    .trim();
  const sequence = entry.sequence ?? entry.chunks.find((chunk) => typeof chunk.sequence === "number")?.sequence;
  const timestamp = entry.chunks.find((chunk) => chunk.kind === "content" && chunk.text.trim())?.timestamp ?? entry.timestamp;
  return typeof sequence === "number" && text
    ? {
        id: entry.id,
        index,
        role: "assistant",
        text: normalizeComparableReplayText(text),
        timestamp,
        sequence: sequence,
      }
    : null;
}

function resolveMessageWindowAnchorIndexes(entries: SessionTimelineEntry[]) {
  const indexes: number[] = [];
  const seenGroupIds = new Set<string>();
  entries.forEach((entry, index) => {
    const groupId = resolveSessionTimelineMessageGroupId(entry);
    if (!groupId || seenGroupIds.has(groupId)) {
      return;
    }
    seenGroupIds.add(groupId);
    indexes.push(index);
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
): SessionTimelineMessageGroupAnchor[] {
  const anchors: SessionTimelineMessageGroupAnchor[] = [];
  const seenGroupIds = new Set<string>();
  let pendingTranscriptStart: number | undefined;

  for (const { position, entry } of positionedEntries) {
    if (isTranscriptPrefixEntry(entry)) {
      pendingTranscriptStart ??= position;
      continue;
    }

    const group = resolveSessionTimelineMessageGroup(entry);
    if (!group) {
      pendingTranscriptStart = undefined;
      continue;
    }
    if (seenGroupIds.has(group.groupId)) {
      pendingTranscriptStart = undefined;
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
    entry.kind === "session_resumed" ||
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
