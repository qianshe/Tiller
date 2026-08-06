import type {
  AgentMessage,
  AgentToolCall,
  SessionTimelineBatch,
  SessionTimelineEntry,
  SessionUpdateRecord,
} from "@tiller/shared";
import {
  appendMessageToSessionTimeline,
  appendToolCallToSessionTimeline,
  resolveSessionTimelineToolCallEntryId,
  sortAssistantTimelineChunks,
  sortSessionTimelineEntries,
  isTranscriptEventEntry,
} from "@tiller/shared";
import { normalizePageLimit } from "../pagination";
import {
  buildSessionTimelineMessageGroupAnchors,
  decodeSessionTimelineOrderCursor,
  encodeSessionTimelineOrderCursor,
  pageSessionTimeline,
  type SessionTimelinePositionedEntry,
  type SessionTimelinePageOptions,
} from "../timeline-store";
import { normalizeLegacyPersistedAgentToolCall } from "../normalize.js";
import {
  openSessionDatabase,
  runTransaction,
  type DatabaseSync,
} from "./core";
import type { SessionTimelineStore } from "../session-stores";
import { createSqliteTimelineMessageAnchorIndex } from "./timeline-message-anchor-index";
import { createSessionUpdateInserter, maybeCompactSessionUpdates } from "./session-update-store";

export function createSqliteSessionTimelineStore(
  dbPath: string,
): SessionTimelineStore & { close(): void } {
  const db = openSessionDatabase(dbPath);
  const anchorIndex = createSqliteTimelineMessageAnchorIndex(db);
  const insertUpdate = createSessionUpdateInserter(db);

  const store = {
    append(sessionId: string, entry: SessionTimelineEntry) {
      upsertSessionTimelineEntry(db, sessionId, entry);
      return listSessionTimelineEntries(db, sessionId);
    },
    upsertMessage(sessionId: string, message: AgentMessage) {
      return upsertSessionTimelineMessage(db, sessionId, message);
    },
    upsertToolCall(sessionId: string, toolCall: AgentToolCall) {
      return upsertSessionTimelineToolCall(db, sessionId, toolCall);
    },
    replace(sessionId: string, entries: SessionTimelineEntry[]) {
      const next = sortSessionTimelineEntries(entries);
      replaceSessionTimelineEntries(db, sessionId, next);
      return next;
    },
    applyBatch(sessionId: string, batch: SessionTimelineBatch) {
      return applyTimelineBatch(db, sessionId, batch);
    },
    commitBatch(
      sessionId: string,
      batch: SessionTimelineBatch,
      updates: SessionUpdateRecord[],
    ) {
      return runTransaction(db, () => {
        for (const update of updates) {
          insertUpdate(update);
        }
        const committed = applyTimelineBatch(db, sessionId, batch, { materializeResult: false });
        const latestUpdate = updates.reduce<SessionUpdateRecord | undefined>(
          (latest, update) => !latest || update.sequence > latest.sequence ? update : latest,
          undefined,
        );
        if (latestUpdate) {
          maybeCompactSessionUpdates(db, latestUpdate);
        }
        return committed;
      });
    },
    list(sessionId: string) {
      return listSessionTimelineEntries(db, sessionId);
    },
    listPage(sessionId: string, options: SessionTimelinePageOptions = {}) {
      return listSessionTimelinePage(db, anchorIndex, sessionId, options);
    },
    remove(sessionId: string) {
      runTransaction(db, () => {
        db.prepare("DELETE FROM session_timeline_entries WHERE session_id = ?").run(sessionId);
        anchorIndex.removeSession(sessionId);
      });
    },
    close() {
      db.close();
    },
  };
  return store as SessionTimelineStore & { close(): void };
}

function applyTimelineBatch(
  db: DatabaseSync,
  sessionId: string,
  batch: SessionTimelineBatch,
  options: { materializeResult?: boolean } = {},
) {
  if (batch.replace) {
    replaceSessionTimelineEntries(db, sessionId, batch.entries);
    return batch.entries;
  }
  upsertSessionTimelineEntries(db, sessionId, batch.entries);
  return options.materializeResult === false
    ? batch.entries
    : listSessionTimelineEntries(db, sessionId);
}

const DEFAULT_TIMELINE_PAGE_LIMIT = 50;
const MAX_TIMELINE_PAGE_LIMIT = 200;
const ORDER_CURSOR_PREFIX = "order";

type TimelineRow = {
  id: string;
  position: number;
  payload_json: string;
};

function listSessionTimelinePage(
  db: DatabaseSync,
  anchorIndex: ReturnType<typeof createSqliteTimelineMessageAnchorIndex>,
  sessionId: string,
  options: SessionTimelinePageOptions,
) {
  if (options.window === "turn") {
    return listSessionTimelineTurnWindowPage(db, anchorIndex, sessionId, options);
  }
  if (options.window === "message") {
    return listSessionTimelineMessageWindowPage(db, anchorIndex, sessionId, options);
  }
  return listSessionTimelineEntryWindowPage(db, sessionId, options);
}

function listSessionTimelineTurnWindowPage(
  db: DatabaseSync,
  anchorIndex: ReturnType<typeof createSqliteTimelineMessageAnchorIndex>,
  sessionId: string,
  options: SessionTimelinePageOptions,
) {
  const limit = normalizePageLimit(
    options.limit,
    DEFAULT_TIMELINE_PAGE_LIMIT,
    MAX_TIMELINE_PAGE_LIMIT,
  );
  ensureSessionTimelineMessageAnchors(db, anchorIndex, sessionId);
  const before = decodeSessionTimelineOrderCursor(options.before);
  const currentAnchor = before
    ? anchorIndex.getAnchor(sessionId, before.position, before.id)
    : undefined;
  const anchors = anchorIndex.listNewestUserAnchors(
    sessionId,
    before?.position,
    limit + 1,
  );
  if (!anchors.length) {
    return listSessionTimelineMessageWindowPage(db, anchorIndex, sessionId, {
      ...options,
      window: "message",
    });
  }
  const hasMore = anchors.length > limit;
  const selected = anchors.slice(0, limit);
  const oldestAnchor = selected.at(-1);
  if (!oldestAnchor) {
    return { entries: [], hasMore: false };
  }
  const rows = queryTimelineRangeRows(
    db,
    sessionId,
    oldestAnchor.startPosition,
    currentAnchor?.startPosition,
  );
  return {
    entries: rows
      .map((row) => parseJson<SessionTimelineEntry>(row.payload_json))
      .filter(isNotNull)
      .map(normalizePersistedTimelineEntry),
    nextCursor: hasMore
      ? encodeSessionTimelineOrderCursor(oldestAnchor.anchorPosition, oldestAnchor.groupId)
      : undefined,
    hasMore,
  };
}

function listSessionTimelineEntryWindowPage(
  db: DatabaseSync,
  sessionId: string,
  options: SessionTimelinePageOptions,
) {
  const limit = normalizePageLimit(
    options.limit,
    DEFAULT_TIMELINE_PAGE_LIMIT,
    MAX_TIMELINE_PAGE_LIMIT,
  );
  const before = decodeSessionTimelineOrderCursor(options.before);
  const rows = queryTimelinePageRows(db, sessionId, before?.position, limit + 1);
  const hasOlderRows = rows.length > limit;
  const candidateRows = rows.slice(0, limit).reverse();
  const entries = candidateRows
    .map((row) => parseJson<SessionTimelineEntry>(row.payload_json))
    .filter(isNotNull)
    .map(normalizePersistedTimelineEntry);
  return {
    entries,
    nextCursor: hasOlderRows
      ? encodeSessionTimelineOrderCursor(candidateRows[0]?.position, candidateRows[0]?.id)
      : undefined,
    hasMore: hasOlderRows,
  };
}

function queryTimelinePageRows(
  db: DatabaseSync,
  sessionId: string,
  beforePosition: number | undefined,
  limit: number,
) {
  const sql = beforePosition === undefined
    ? `
      SELECT id, position, payload_json
      FROM session_timeline_entries
      WHERE session_id = ?
      ORDER BY position DESC, id DESC
      LIMIT ?
    `
    : `
      SELECT id, position, payload_json
      FROM session_timeline_entries
      WHERE session_id = ? AND position < ?
      ORDER BY position DESC, id DESC
      LIMIT ?
    `;
  const params = beforePosition === undefined
    ? [sessionId, limit]
    : [sessionId, beforePosition, limit];
  return db.prepare(sql).all(...params) as TimelineRow[];
}

function listSessionTimelineMessageWindowPage(
  db: DatabaseSync,
  anchorIndex: ReturnType<typeof createSqliteTimelineMessageAnchorIndex>,
  sessionId: string,
  options: SessionTimelinePageOptions,
) {
  const limit = normalizePageLimit(
    options.limit,
    DEFAULT_TIMELINE_PAGE_LIMIT,
    MAX_TIMELINE_PAGE_LIMIT,
  );
  ensureSessionTimelineMessageAnchors(db, anchorIndex, sessionId);
  const before = decodeSessionTimelineOrderCursor(options.before);
  const currentAnchor = before
    ? anchorIndex.getAnchor(sessionId, before.position, before.id)
    : undefined;
  const anchors = anchorIndex.listNewestAnchors(sessionId, before?.position, limit + 1);
  if (!anchors.length) {
    return listSessionTimelineEntryWindowPage(db, sessionId, {
      ...options,
      window: "entry",
      before: currentAnchor
        ? encodeSessionTimelineOrderCursor(currentAnchor.startPosition, currentAnchor.groupId)
        : options.before,
    });
  }
  const hasMore = anchors.length > limit;
  const selected = anchors.slice(0, limit);
  const oldestAnchor = selected.at(-1);
  if (!oldestAnchor) {
    return { entries: [], hasMore: false };
  }
  const rows = queryTimelineRangeRows(
    db,
    sessionId,
    oldestAnchor.startPosition,
    currentAnchor?.startPosition,
  );
  return {
    entries: rows
      .map((row) => parseJson<SessionTimelineEntry>(row.payload_json))
      .filter(isNotNull)
      .map(normalizePersistedTimelineEntry),
    nextCursor: hasMore
      ? encodeSessionTimelineOrderCursor(oldestAnchor.anchorPosition, oldestAnchor.groupId)
      : undefined,
    hasMore,
  };
}

function queryTimelineRangeRows(
  db: DatabaseSync,
  sessionId: string,
  startInclusive: number,
  beforeExclusive?: number,
) {
  const sql = beforeExclusive === undefined
    ? `
      SELECT id, position, payload_json
      FROM session_timeline_entries
      WHERE session_id = ? AND position >= ?
      ORDER BY position ASC, id ASC
    `
    : `
      SELECT id, position, payload_json
      FROM session_timeline_entries
      WHERE session_id = ? AND position >= ? AND position < ?
      ORDER BY position ASC, id ASC
    `;
  const params = beforeExclusive === undefined
    ? [sessionId, startInclusive]
    : [sessionId, startInclusive, beforeExclusive];
  return db.prepare(sql).all(...params) as TimelineRow[];
}

function ensureSessionTimelineMessageAnchors(
  db: DatabaseSync,
  anchorIndex: ReturnType<typeof createSqliteTimelineMessageAnchorIndex>,
  sessionId: string,
) {
  if (anchorIndex.isInitialized(sessionId)) {
    return;
  }
  const anchors = buildSessionTimelineMessageGroupAnchors(
    listPositionedSessionTimelineEntries(db, sessionId),
  );
  anchorIndex.replaceSessionAnchors(sessionId, anchors);
}

function listSessionTimelineEntries(db: DatabaseSync, sessionId: string) {
  const rows = db
    .prepare(
      `
    SELECT payload_json
    FROM session_timeline_entries
    WHERE session_id = ?
    ORDER BY position ASC, id ASC
  `,
    )
    .all(sessionId) as Array<{ payload_json: string }>;
  return rows
    .map((row) => parseJson<SessionTimelineEntry>(row.payload_json))
    .filter(isNotNull)
    .map(normalizePersistedTimelineEntry);
}

function listPositionedSessionTimelineEntries(
  db: DatabaseSync,
  sessionId: string,
  fromPosition = 0,
): SessionTimelinePositionedEntry[] {
  const rows = db.prepare(
    `
      SELECT position, payload_json
      FROM session_timeline_entries
      WHERE session_id = ? AND position >= ?
      ORDER BY position ASC, id ASC
    `,
  ).all(sessionId, fromPosition) as Array<{ position: number; payload_json: string }>;
  return rows
    .map((row) => ({
      position: row.position,
      entry: parseJson<SessionTimelineEntry>(row.payload_json),
    }))
    .filter((row): row is { position: number; entry: SessionTimelineEntry } => row.entry !== null)
    .map((row) => ({
      position: row.position,
      entry: normalizePersistedTimelineEntry(row.entry),
    }));
}

function upsertSessionTimelineMessage(
  db: DatabaseSync,
  sessionId: string,
  message: AgentMessage,
) {
  const entries = listSessionTimelineEntries(db, sessionId);
  const inPlaceEntry = findInPlaceMessageUpdateEntry(entries, message);
  if (inPlaceEntry) {
    const updatedEntries = appendMessageToSessionTimeline([inPlaceEntry], message);
    const updated = findMessageTimelineEntry(updatedEntries, message);
    if (updated) {
      upsertSessionTimelineEntry(db, sessionId, updated);
      return normalizePersistedTimelineEntry(updated);
    }
  }

  appendMessageToSessionTimeline(entries, message);
  const next = sortSessionTimelineEntries(entries);
  replaceSessionTimelineEntries(db, sessionId, next);
  return findMessageTimelineEntry(next, message);
}

function upsertSessionTimelineToolCall(
  db: DatabaseSync,
  sessionId: string,
  toolCall: AgentToolCall,
) {
  const entries = listSessionTimelineEntries(db, sessionId);
  appendToolCallToSessionTimeline(entries, toolCall);
  const next = sortSessionTimelineEntries(entries);
  replaceSessionTimelineEntries(db, sessionId, next);
  return findToolCallTimelineEntry(next, toolCall);
}

function findMessageTimelineEntry(entries: SessionTimelineEntry[], message: AgentMessage) {
  if (message.role !== "assistant") {
    const kind = message.role === "system" ? "system_message" : "user_message";
    return entries.find((entry) => entry.kind === kind && entry.id === message.id);
  }

  if (typeof message.sequence === "number") {
    const sequenced = entries.find((entry) =>
      entry.kind === "assistant_message" &&
      entry.chunks.some((chunk) =>
        chunk.kind === "content" && chunk.sequence === message.sequence
      )
    );
    if (sequenced) {
      return sequenced;
    }
  }

  const contentChunkId = `${message.id}:content`;
  return entries.find((entry) =>
    entry.kind === "assistant_message" &&
    entry.chunks.some((chunk) =>
      chunk.kind === "content" && matchesTimelineChunkId(chunk.id, contentChunkId)
    )
  ) ?? entries.find((entry) =>
    entry.kind === "assistant_message" &&
    (entry.id === message.id || entry.id.startsWith(`${message.id}#p`))
  );
}

function findToolCallTimelineEntry(entries: SessionTimelineEntry[], toolCall: AgentToolCall) {
  const entryId = resolveSessionTimelineToolCallEntryId(toolCall);
  return entries.find((entry) => entry.kind === "tool_call" && entry.id === entryId);
}

function matchesTimelineChunkId(chunkId: string, baseId: string) {
  return chunkId === baseId || chunkId.startsWith(`${baseId}:`);
}

function findInPlaceMessageUpdateEntry(entries: SessionTimelineEntry[], message: AgentMessage) {
  if (message.role !== "assistant") {
    const kind = message.role === "system" ? "system_message" : "user_message";
    return entries.find((entry) => entry.kind === kind && entry.id === message.id);
  }

  const existing = entries.find((entry): entry is Extract<SessionTimelineEntry, { kind: "assistant_message" }> =>
    entry.kind === "assistant_message" && entry.id === message.id
  );
  if (!existing || hasToolCallBoundaryBeforeAssistantUpdate(entries, existing, message)) {
    return undefined;
  }
  return existing;
}

function hasToolCallBoundaryBeforeAssistantUpdate(
  entries: SessionTimelineEntry[],
  existing: Extract<SessionTimelineEntry, { kind: "assistant_message" }>,
  message: AgentMessage,
) {
  if (typeof message.sequence !== "number") {
    return false;
  }
  const messageSequence = message.sequence;
  const contentChunkId = `${message.id}:content`;
  return existing.chunks.some((chunk) => {
    if (
      chunk.kind !== "content" ||
      !matchesTimelineChunkId(chunk.id, contentChunkId) ||
      typeof chunk.sequence !== "number"
    ) {
      return false;
    }
    const chunkSequence = chunk.sequence;
    return entries.some((entry) =>
      entry.kind === "tool_call" &&
      typeof entry.sequence === "number" &&
      isSequenceBetween(entry.sequence, chunkSequence, messageSequence)
    );
  });
}

function isSequenceBetween(value: number, left: number, right: number) {
  return value > Math.min(left, right) && value < Math.max(left, right);
}

function upsertSessionTimelineEntry(
  db: DatabaseSync,
  sessionId: string,
  entry: SessionTimelineEntry,
) {
  runTransaction(db, () => {
    const existing = db
      .prepare("SELECT position FROM session_timeline_entries WHERE session_id = ? AND id = ?")
      .get(sessionId, entry.id) as { position: number } | undefined;
    const maxPosition = db
      .prepare("SELECT MAX(position) AS position FROM session_timeline_entries WHERE session_id = ?")
      .get(sessionId) as { position: number | null } | undefined;
    const position = existing?.position ?? ((maxPosition?.position ?? -1) + 1);
    insertSessionTimelineEntry(db, sessionId, entry, position);
    refreshSessionTimelineMessageAnchorsFrom(db, sessionId, position);
  });
}

function replaceSessionTimelineEntries(
  db: DatabaseSync,
  sessionId: string,
  entries: SessionTimelineEntry[],
) {
  runTransaction(db, () => {
    db.prepare("DELETE FROM session_timeline_entries WHERE session_id = ?").run(sessionId);
    const insert = db.prepare(`
      INSERT OR REPLACE INTO session_timeline_entries(
        session_id,
        id,
        position,
        kind,
        timestamp,
        updated_at,
        timeline_sequence,
        payload_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [position, entry] of entries.entries()) {
      insert.run(
        sessionId,
        entry.id,
        position,
        entry.kind,
        entry.timestamp,
        resolveEntryUpdatedAt(entry),
        isTranscriptEventEntry(entry) ? null : (entry.sequence ?? null),
        JSON.stringify(entry),
      );
    }
    replaceSessionTimelineMessageAnchors(db, sessionId);
  });
}

function upsertSessionTimelineEntries(
  db: DatabaseSync,
  sessionId: string,
  entries: SessionTimelineEntry[],
) {
  if (entries.length === 0) {
    return;
  }
  const findExistingPosition = db.prepare(
    "SELECT position FROM session_timeline_entries WHERE session_id = ? AND id = ?",
  );
  const maxPosition = db.prepare(
    "SELECT MAX(position) AS position FROM session_timeline_entries WHERE session_id = ?",
  ).get(sessionId) as { position: number | null } | undefined;
  let nextPosition = (maxPosition?.position ?? -1) + 1;
  let firstAffectedPosition: number | undefined;
  for (const entry of entries) {
    const existing = findExistingPosition.get(sessionId, entry.id) as
      | { position: number }
      | undefined;
    const position = existing?.position ?? nextPosition++;
    firstAffectedPosition = firstAffectedPosition === undefined
      ? position
      : Math.min(firstAffectedPosition, position);
    insertSessionTimelineEntry(
      db,
      sessionId,
      entry,
      position,
    );
  }
  if (firstAffectedPosition !== undefined) {
    refreshSessionTimelineMessageAnchorsFrom(db, sessionId, firstAffectedPosition);
  }
}

function insertSessionTimelineEntry(
  db: DatabaseSync,
  sessionId: string,
  entry: SessionTimelineEntry,
  position: number,
) {
  const resolvedEntry = mergeExistingTimelineToolCall(db, sessionId, entry);
  db.prepare(`
    INSERT OR REPLACE INTO session_timeline_entries(
      session_id,
      id,
      position,
      kind,
      timestamp,
      updated_at,
      timeline_sequence,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sessionId,
    resolvedEntry.id,
    position,
    resolvedEntry.kind,
    resolvedEntry.timestamp,
    resolveEntryUpdatedAt(resolvedEntry),
    isTranscriptEventEntry(resolvedEntry) ? null : (resolvedEntry.sequence ?? null),
    JSON.stringify(resolvedEntry),
  );
}

function mergeExistingTimelineToolCall(
  db: DatabaseSync,
  sessionId: string,
  incoming: SessionTimelineEntry,
) {
  if (incoming.kind !== "tool_call") return incoming;
  const row = db.prepare(
    "SELECT payload_json FROM session_timeline_entries WHERE session_id = ? AND id = ?",
  ).get(sessionId, incoming.id) as { payload_json: string } | undefined;
  const current = row
    ? parseJson<SessionTimelineEntry>(row.payload_json)
    : null;
  if (current?.kind !== "tool_call") return incoming;
  const entries: SessionTimelineEntry[] = [normalizePersistedTimelineEntry(current)];
  appendToolCallToSessionTimeline(entries, incoming.toolCall);
  return entries.find((entry) => entry.kind === "tool_call" && entry.id === current.id) ?? incoming;
}

function replaceSessionTimelineMessageAnchors(db: DatabaseSync, sessionId: string) {
  const anchorIndex = createSqliteTimelineMessageAnchorIndex(db);
  anchorIndex.replaceSessionAnchors(
    sessionId,
    buildSessionTimelineMessageGroupAnchors(listPositionedSessionTimelineEntries(db, sessionId)),
  );
}

function refreshSessionTimelineMessageAnchorsFrom(
  db: DatabaseSync,
  sessionId: string,
  affectedPosition: number,
) {
  const anchorIndex = createSqliteTimelineMessageAnchorIndex(db);
  const previousAnchor = anchorIndex.getAnchorAtOrBefore(sessionId, affectedPosition);
  const startPosition = previousAnchor?.startPosition ?? 0;
  const anchors = buildSessionTimelineMessageGroupAnchors(
    listPositionedSessionTimelineEntries(db, sessionId, startPosition),
    { seenGroupIds: anchorIndex.listGroupIdsBefore(sessionId, startPosition) },
  );
  anchorIndex.replaceAnchorsFrom(sessionId, startPosition, anchors);
}

function normalizePersistedTimelineEntry(entry: SessionTimelineEntry): SessionTimelineEntry {
  if (entry.kind === "tool_call") {
    const normalizedToolCall = normalizeLegacyPersistedAgentToolCall(entry.toolCall) ?? entry.toolCall;
    return normalizedToolCall === entry.toolCall
      ? entry
      : {
        ...entry,
        toolCall: normalizedToolCall,
        updatedAt: normalizedToolCall.updatedAt,
      };
  }
  if (entry.kind !== "assistant_message") {
    return entry;
  }
  return {
    ...entry,
    chunks: sortAssistantTimelineChunks(entry.chunks),
  };
}

function resolveEntryUpdatedAt(entry: SessionTimelineEntry) {
  if (entry.kind === "tool_call") {
    return entry.toolCall.updatedAt;
  }
  return entry.updatedAt;
}

function parseJson<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function isNotNull<T>(value: T | null): value is T {
  return value !== null;
}
