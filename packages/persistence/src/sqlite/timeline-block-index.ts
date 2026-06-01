import { runTransaction, type DatabaseSync } from "./core";

export type TimelineBlockState = "open" | "sealed";

export type TimelineBlockRecord = {
  id: string;
  sessionId: string;
  firstPosition: number;
  lastPosition: number;
  entryCount: number;
  byteSize: number;
  storageKey: string;
  sha256?: string;
  state: TimelineBlockState;
  createdAt: string;
  sealedAt?: string;
  payload?: Record<string, unknown>;
};

export type TimelineBlockEntryRecord = {
  sessionId: string;
  entryId: string;
  blockId: string;
  position: number;
};

type TimelineBlockRow = {
  id: string;
  session_id: string;
  first_position: number;
  last_position: number;
  entry_count: number;
  byte_size: number;
  storage_key: string;
  sha256: string | null;
  state: TimelineBlockState;
  created_at: string;
  sealed_at: string | null;
  payload_json: string;
};

type TimelineBlockEntryRow = {
  session_id: string;
  entry_id: string;
  block_id: string;
  position: number;
};

export function createSqliteTimelineBlockIndex(db: DatabaseSync) {
  return {
    listNewestBlocks(sessionId: string, beforePosition?: number, limit?: number) {
      const params: Array<string | number> = beforePosition === undefined
        ? [sessionId, normalizeBlockLimit(limit)]
        : [sessionId, beforePosition, normalizeBlockLimit(limit)];
      const sql = beforePosition === undefined
        ? `
          SELECT *
          FROM session_timeline_blocks
          WHERE session_id = ?
          ORDER BY last_position DESC, id DESC
          LIMIT ?
        `
        : `
          SELECT *
          FROM session_timeline_blocks
          WHERE session_id = ? AND first_position < ?
          ORDER BY last_position DESC, id DESC
          LIMIT ?
        `;
      return (db.prepare(sql).all(...params) as TimelineBlockRow[]).map(rowToBlockRecord);
    },

    getOpenBlock(sessionId: string) {
      const row = db
        .prepare(`
          SELECT *
          FROM session_timeline_blocks
          WHERE session_id = ? AND state = 'open'
          ORDER BY last_position DESC, id DESC
          LIMIT 1
        `)
        .get(sessionId) as TimelineBlockRow | undefined;
      return row ? rowToBlockRecord(row) : undefined;
    },

    getBlock(blockId: string) {
      const row = db
        .prepare("SELECT * FROM session_timeline_blocks WHERE id = ?")
        .get(blockId) as TimelineBlockRow | undefined;
      return row ? rowToBlockRecord(row) : undefined;
    },

    getEntryLocation(sessionId: string, entryId: string) {
      const row = db
        .prepare(`
          SELECT session_id, entry_id, block_id, position
          FROM session_timeline_block_entries
          WHERE session_id = ? AND entry_id = ?
        `)
        .get(sessionId, entryId) as TimelineBlockEntryRow | undefined;
      return row ? rowToBlockEntryRecord(row) : undefined;
    },

    upsertBlock(record: TimelineBlockRecord) {
      upsertBlockRecord(db, record);
    },

    replaceBlockEntries(blockId: string, entries: TimelineBlockEntryRecord[]) {
      runTransaction(db, () => {
        db.prepare("DELETE FROM session_timeline_block_entries WHERE block_id = ?").run(blockId);
        insertBlockEntryRecords(db, entries);
      });
    },

    replaceBlocks(
      sessionId: string,
      records: TimelineBlockRecord[],
      entries: TimelineBlockEntryRecord[],
    ) {
      runTransaction(db, () => {
        db.prepare("DELETE FROM session_timeline_block_entries WHERE session_id = ?").run(sessionId);
        db.prepare("DELETE FROM session_timeline_blocks WHERE session_id = ?").run(sessionId);
        for (const record of records) {
          upsertBlockRecord(db, record);
        }
        insertBlockEntryRecords(db, entries);
      });
    },

    removeSession(sessionId: string) {
      runTransaction(db, () => {
        db.prepare("DELETE FROM session_timeline_block_entries WHERE session_id = ?").run(sessionId);
        db.prepare("DELETE FROM session_timeline_blocks WHERE session_id = ?").run(sessionId);
      });
    },
  };
}

function normalizeBlockLimit(limit: number | undefined) {
  if (!Number.isInteger(limit) || !limit || limit < 1) {
    return 50;
  }
  return Math.min(limit, 500);
}

function upsertBlockRecord(db: DatabaseSync, record: TimelineBlockRecord) {
  db.prepare(`
    INSERT OR REPLACE INTO session_timeline_blocks(
      id,
      session_id,
      first_position,
      last_position,
      entry_count,
      byte_size,
      storage_key,
      sha256,
      state,
      created_at,
      sealed_at,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.sessionId,
    record.firstPosition,
    record.lastPosition,
    record.entryCount,
    record.byteSize,
    record.storageKey,
    record.sha256 ?? null,
    record.state,
    record.createdAt,
    record.sealedAt ?? null,
    JSON.stringify(record.payload ?? {}),
  );
}

function insertBlockEntryRecords(db: DatabaseSync, entries: TimelineBlockEntryRecord[]) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO session_timeline_block_entries(
      session_id,
      entry_id,
      block_id,
      position
    )
    VALUES (?, ?, ?, ?)
  `);
  for (const entry of entries) {
    insert.run(entry.sessionId, entry.entryId, entry.blockId, entry.position);
  }
}

function rowToBlockRecord(row: TimelineBlockRow): TimelineBlockRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    firstPosition: row.first_position,
    lastPosition: row.last_position,
    entryCount: row.entry_count,
    byteSize: row.byte_size,
    storageKey: row.storage_key,
    sha256: row.sha256 ?? undefined,
    state: row.state,
    createdAt: row.created_at,
    sealedAt: row.sealed_at ?? undefined,
    payload: parseJsonRecord(row.payload_json),
  };
}

function rowToBlockEntryRecord(row: TimelineBlockEntryRow): TimelineBlockEntryRecord {
  return {
    sessionId: row.session_id,
    entryId: row.entry_id,
    blockId: row.block_id,
    position: row.position,
  };
}

function parseJsonRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
