import type { SessionUpdateRecord, SessionUpdateRecordPage } from "@tiller/shared";
import { normalizePageLimit } from "../pagination";
import { openSessionDatabase, runTransaction, type DatabaseSync } from "./core";

const DEFAULT_SESSION_UPDATE_PAGE_LIMIT = 50;
const MAX_SESSION_UPDATE_PAGE_LIMIT = 200;
const CURSOR_PREFIX = "sequence";

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

  return {
    append(update: SessionUpdateRecord) {
      insertSessionUpdate(db, update);
    },
    replaceSession(sessionId: string, updates: SessionUpdateRecord[]) {
      replaceSessionUpdates(db, sessionId, updates);
    },
    listPage(sessionId: string, options: { limit?: number; before?: string } = {}): SessionUpdateRecordPage {
      return listSessionUpdatePage(db, sessionId, options);
    },
    listSinceSequence(sessionId: string, afterSequence: number, limit = MAX_SESSION_UPDATE_PAGE_LIMIT) {
      return listSessionUpdatesSinceSequence(db, sessionId, afterSequence, limit);
    },
    remove(sessionId: string) {
      db.prepare("DELETE FROM session_updates WHERE session_id = ?").run(sessionId);
    },
    close() {
      db.close();
    },
  };
}

function replaceSessionUpdates(
  db: DatabaseSync,
  sessionId: string,
  updates: SessionUpdateRecord[],
) {
  runTransaction(db, () => {
    db.prepare("DELETE FROM session_updates WHERE session_id = ?").run(sessionId);
    for (const update of updates) {
      insertSessionUpdate(db, update);
    }
  });
}

function insertSessionUpdate(db: DatabaseSync, update: SessionUpdateRecord) {
  db.prepare(`
    INSERT OR REPLACE INTO session_updates(
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
  `).run(
    update.sessionId,
    update.sequence,
    update.runtimeSessionId,
    update.providerId,
    update.source,
    update.updateType,
    update.receivedAt,
    update.payloadJson,
  );
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

function listSessionUpdatesSinceSequence(
  db: DatabaseSync,
  sessionId: string,
  afterSequence: number,
  limit: number,
) {
  const normalizedLimit = normalizePageLimit(
    limit,
    DEFAULT_SESSION_UPDATE_PAGE_LIMIT,
    MAX_SESSION_UPDATE_PAGE_LIMIT,
  );
  const rows = db.prepare(`
      SELECT session_id, sequence, runtime_session_id, provider_id, source, update_type, received_at, payload_json
      FROM session_updates
      WHERE session_id = ? AND sequence > ?
      ORDER BY sequence ASC
      LIMIT ?
    `).all(sessionId, afterSequence, normalizedLimit) as SessionUpdateRow[];
  return rows.map(rowToSessionUpdate);
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
