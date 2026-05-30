import type { SessionTimelineEntry } from "@tiller/shared";
import { sortSessionTimelineEntries } from "@tiller/shared";
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
      const current = listSessionTimelineEntries(db, sessionId);
      const next = sortSessionTimelineEntries([
        ...current.filter((candidate) => candidate.id !== entry.id),
        entry,
      ]);
      replaceSessionTimelineEntries(db, sessionId, next);
      return next;
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
      return pageSessionTimeline(listSessionTimelineEntries(db, sessionId), options);
    },
    remove(sessionId: string) {
      db.prepare("DELETE FROM session_timeline_entries WHERE session_id = ?").run(sessionId);
    },
    close() {
      db.close();
    },
  };
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
  return sortSessionTimelineEntries(
    rows.map((row) => parseJson<SessionTimelineEntry>(row.payload_json)).filter(isNotNull),
  );
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
