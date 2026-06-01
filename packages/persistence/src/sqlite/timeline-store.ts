import type { SessionTimelineEntry } from "@tiller/shared";
import { sortAssistantTimelineChunks, sortSessionTimelineEntries } from "@tiller/shared";
import { normalizePageLimit } from "../pagination";
import {
  pageSessionTimeline,
  type SessionTimelinePageOptions,
} from "../timeline-store";
import {
  openSessionDatabase,
  runTransaction,
  type DatabaseSync,
} from "./core";

export function createSqliteSessionTimelineStore(dbPath: string) {
  const db = openSessionDatabase(dbPath);

  return {
    append(sessionId: string, entry: SessionTimelineEntry) {
      upsertSessionTimelineEntry(db, sessionId, entry);
      return listSessionTimelineEntries(db, sessionId);
    },
    replace(sessionId: string, entries: SessionTimelineEntry[]) {
      const next = sortSessionTimelineEntries(entries);
      replaceSessionTimelineEntries(db, sessionId, next);
      return next;
    },
    list(sessionId: string) {
      return listSessionTimelineEntries(db, sessionId);
    },
    listPage(sessionId: string, options: SessionTimelinePageOptions = {}) {
      return listSessionTimelinePage(db, sessionId, options);
    },
    remove(sessionId: string) {
      db.prepare("DELETE FROM session_timeline_entries WHERE session_id = ?").run(sessionId);
    },
    close() {
      db.close();
    },
  };
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
  sessionId: string,
  options: SessionTimelinePageOptions,
) {
  const limit = normalizePageLimit(
    options.limit,
    DEFAULT_TIMELINE_PAGE_LIMIT,
    MAX_TIMELINE_PAGE_LIMIT,
  );
  const entryLimit = options.window === "message"
    ? normalizePageLimit(options.entryLimit, MAX_TIMELINE_PAGE_LIMIT, MAX_TIMELINE_PAGE_LIMIT)
    : limit;
  const candidateLimit = Math.max(limit, entryLimit);
  const before = decodeOrderCursor(options.before);
  const rows = queryTimelinePageRows(db, sessionId, before?.position, candidateLimit + 1);
  const hasOlderRows = rows.length > candidateLimit;
  const candidateRows = rows.slice(0, candidateLimit).reverse();
  const entries = candidateRows
    .map((row) => parseJson<SessionTimelineEntry>(row.payload_json))
    .filter(isNotNull)
    .map(normalizePersistedTimelineEntry);
  const page = pageSessionTimeline(entries, { ...options, before: undefined });
  const hasMore = hasOlderRows || page.hasMore;
  return {
    entries: page.entries,
    nextCursor: hasMore ? encodeOrderCursor(resolvePageStartRow(candidateRows, page.entries)) : undefined,
    hasMore,
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

function resolvePageStartRow(rows: TimelineRow[], entries: SessionTimelineEntry[]) {
  const firstEntry = entries[0];
  if (!firstEntry) {
    return undefined;
  }
  return rows.find((row) => row.id === firstEntry.id);
}

function encodeOrderCursor(row: TimelineRow | undefined) {
  return row ? `${ORDER_CURSOR_PREFIX}\t${row.position}\t${row.id}` : undefined;
}

function decodeOrderCursor(cursor: string | undefined) {
  if (!cursor) {
    return null;
  }
  const [prefix, position] = cursor.split("\t");
  if (prefix !== ORDER_CURSOR_PREFIX || !position) {
    return null;
  }
  const parsedPosition = Number.parseInt(position, 10);
  return Number.isFinite(parsedPosition) && parsedPosition >= 0
    ? { position: parsedPosition }
    : null;
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
    for (const [position, entry] of sortSessionTimelineEntries(entries).entries()) {
      insert.run(
        sessionId,
        entry.id,
        position,
        entry.kind,
        entry.timestamp,
        resolveEntryUpdatedAt(entry),
        entry.timelineSequence ?? null,
        JSON.stringify(entry),
      );
    }
  });
}

function insertSessionTimelineEntry(
  db: DatabaseSync,
  sessionId: string,
  entry: SessionTimelineEntry,
  position: number,
) {
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
    entry.id,
    position,
    entry.kind,
    entry.timestamp,
    resolveEntryUpdatedAt(entry),
    entry.timelineSequence ?? null,
    JSON.stringify(entry),
  );
}

function normalizePersistedTimelineEntry(entry: SessionTimelineEntry): SessionTimelineEntry {
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
