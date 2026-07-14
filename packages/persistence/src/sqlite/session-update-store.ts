import type { SessionUpdateRecord, SessionUpdateRecordPage } from "@tiller/shared";
import { normalizePageLimit } from "../pagination";
import { openSessionDatabase, type DatabaseSync } from "./core";

const DEFAULT_SESSION_UPDATE_PAGE_LIMIT = 50;
const MAX_SESSION_UPDATE_PAGE_LIMIT = 200;
const CURSOR_PREFIX = "sequence";
export const SESSION_UPDATE_JOURNAL_TAIL = 256;
export const SESSION_UPDATE_COMPACTION_INTERVAL = 512;

type SessionUpdateRow = {
  session_id: string;
  runtime_session_id: string;
  provider_id: string;
  sequence: number;
  source: SessionUpdateRecord["source"];
  update_type: string;
  received_at: string;
  payload_json: string;
};

export function createSqliteSessionUpdateStore(dbPath: string) {
  const db = openSessionDatabase(dbPath);
  const insert = createSessionUpdateInserter(db);

  return {
    append(update: SessionUpdateRecord) {
      insert(update);
      maybeCompactSessionUpdates(db, update);
    },
    getMaxSequence(sessionId: string) {
      const row = db.prepare(
        "SELECT COALESCE(MAX(sequence), 0) AS value FROM session_updates WHERE session_id = ?",
      ).get(sessionId) as { value: number };
      return row.value;
    },
    compactTail(sessionId: string, retain = SESSION_UPDATE_JOURNAL_TAIL) {
      return compactSessionUpdates(db, sessionId, retain);
    },
    listPage(sessionId: string, options: { limit?: number; before?: string } = {}): SessionUpdateRecordPage {
      return listSessionUpdatePage(db, sessionId, options);
    },
    remove(sessionId: string) {
      db.prepare("DELETE FROM session_updates WHERE session_id = ?").run(sessionId);
    },
    close() {
      db.close();
    },
  };
}

export function createSessionUpdateInserter(db: DatabaseSync) {
  const statement = db.prepare(`
    INSERT INTO session_updates(
      session_id,
      sequence,
      runtime_session_id,
      provider_id,
      source,
      update_type,
      received_at,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return (update: SessionUpdateRecord) => {
    statement.run(
      update.sessionId,
      update.sequence,
      update.runtimeSessionId,
      update.providerId,
      update.source,
      update.updateType,
      update.receivedAt,
      update.payloadJson,
    );
  };
}

export function maybeCompactSessionUpdates(
  db: DatabaseSync,
  update: SessionUpdateRecord,
) {
  if (
    update.sequence < SESSION_UPDATE_COMPACTION_INTERVAL ||
    update.sequence % SESSION_UPDATE_COMPACTION_INTERVAL !== 0
  ) {
    return 0;
  }
  return compactSessionUpdates(db, update.sessionId);
}

export function compactSessionUpdates(
  db: DatabaseSync,
  sessionId: string,
  retain = SESSION_UPDATE_JOURNAL_TAIL,
) {
  const normalizedRetain = Number.isInteger(retain) && retain > 0
    ? retain
    : SESSION_UPDATE_JOURNAL_TAIL;
  const latest = db.prepare(
    "SELECT COALESCE(MAX(sequence), 0) AS value FROM session_updates WHERE session_id = ?",
  ).get(sessionId) as { value: number };
  const firstRetainedSequence = latest.value - normalizedRetain + 1;
  if (firstRetainedSequence <= 1) {
    return 0;
  }
  const result = db.prepare(
    "DELETE FROM session_updates WHERE session_id = ? AND sequence < ?",
  ).run(sessionId, firstRetainedSequence) as { changes?: number };
  return result.changes ?? 0;
}

function listSessionUpdatePage(
  db: DatabaseSync,
  sessionId: string,
  options: { limit?: number; before?: string },
): SessionUpdateRecordPage {
  const limit = normalizePageLimit(
    options.limit,
    DEFAULT_SESSION_UPDATE_PAGE_LIMIT,
    MAX_SESSION_UPDATE_PAGE_LIMIT,
  );
  const before = decodeCursor(options.before);
  const rows = querySessionUpdateRows(db, sessionId, before?.sequence, limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit).reverse();
  return {
    updates: pageRows.map(rowToSessionUpdate),
    nextCursor: hasMore ? encodeCursor(pageRows[0]) : undefined,
    hasMore,
  };
}

function querySessionUpdateRows(
  db: DatabaseSync,
  sessionId: string,
  beforeSequence: number | undefined,
  limit: number,
) {
  const sql = beforeSequence === undefined
    ? `
      SELECT session_id, sequence, runtime_session_id, provider_id, source, update_type, received_at, payload_json
      FROM session_updates
      WHERE session_id = ?
      ORDER BY sequence DESC
      LIMIT ?
    `
    : `
      SELECT session_id, sequence, runtime_session_id, provider_id, source, update_type, received_at, payload_json
      FROM session_updates
      WHERE session_id = ? AND sequence < ?
      ORDER BY sequence DESC
      LIMIT ?
    `;
  const params = beforeSequence === undefined ? [sessionId, limit] : [sessionId, beforeSequence, limit];
  return db.prepare(sql).all(...params) as SessionUpdateRow[];
}

function rowToSessionUpdate(row: SessionUpdateRow): SessionUpdateRecord {
  return {
    sessionId: row.session_id,
    runtimeSessionId: row.runtime_session_id,
    providerId: row.provider_id,
    sequence: row.sequence,
    source: row.source,
    updateType: row.update_type,
    receivedAt: row.received_at,
    payloadJson: row.payload_json,
  };
}

function encodeCursor(row: SessionUpdateRow | undefined) {
  return row ? `${CURSOR_PREFIX}\t${row.sequence}` : undefined;
}

function decodeCursor(cursor: string | undefined) {
  if (!cursor) {
    return null;
  }
  const [prefix, sequence] = cursor.split("\t");
  if (prefix !== CURSOR_PREFIX || !sequence) {
    return null;
  }
  const parsedSequence = Number.parseInt(sequence, 10);
  return Number.isFinite(parsedSequence) && parsedSequence >= 0
    ? { sequence: parsedSequence }
    : null;
}
