import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");
export type DatabaseSync = import("node:sqlite").DatabaseSync;

const activeTransactions = new WeakSet<DatabaseSync>();

export function openSessionDatabase(dbPath: string) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations(
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_summaries(
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      helm_id TEXT NOT NULL,
      worktree_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_messages(
      session_id TEXT NOT NULL,
      id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY(session_id, id)
    );

    CREATE TABLE IF NOT EXISTS session_outputs(
      session_id TEXT NOT NULL,
      id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY(session_id, id)
    );

    CREATE TABLE IF NOT EXISTS session_tool_calls(
      session_id TEXT NOT NULL,
      id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY(session_id, id)
    );

    CREATE TABLE IF NOT EXISTS session_timeline_entries(
      session_id TEXT NOT NULL,
      id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      timeline_sequence INTEGER,
      payload_json TEXT NOT NULL,
      PRIMARY KEY(session_id, id)
    );

    CREATE TABLE IF NOT EXISTS session_attachments(
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT,
      mime_type TEXT NOT NULL,
      name TEXT,
      sha256 TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      storage_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_diffs(
      session_id TEXT NOT NULL,
      path TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY(session_id, path)
    );

    CREATE TABLE IF NOT EXISTS session_runtimes(
      session_id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      runtime_session_id TEXT,
      last_seen_at TEXT NOT NULL,
      state TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_session_summaries_updated_at ON session_summaries(updated_at);
    CREATE INDEX IF NOT EXISTS idx_session_outputs_page ON session_outputs(session_id, timestamp, id);
    CREATE INDEX IF NOT EXISTS idx_session_tool_calls_page ON session_tool_calls(session_id, updated_at, id);
    CREATE INDEX IF NOT EXISTS idx_session_timeline_entries_page ON session_timeline_entries(session_id, position, id);
    CREATE INDEX IF NOT EXISTS idx_session_attachments_session_message ON session_attachments(session_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_session_attachments_sha256 ON session_attachments(sha256);
    CREATE INDEX IF NOT EXISTS idx_session_diffs_session ON session_diffs(session_id);
  `);
  ensureSessionMessagePositions(db);
  db.exec("DROP INDEX IF EXISTS idx_session_messages_page");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_session_messages_page ON session_messages(session_id, position, id)",
  );
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, ?)").run(
    new Date().toISOString(),
  );
  return db;
}

export function hasMigrationVersion(db: DatabaseSync, version: number) {
  const row = db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(version);
  return Boolean(row);
}

export function recordMigrationVersion(db: DatabaseSync, version: number) {
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(?, ?)").run(
    version,
    new Date().toISOString(),
  );
}

export function runTransaction(db: DatabaseSync, action: () => void) {
  if (activeTransactions.has(db)) {
    action();
    return;
  }

  activeTransactions.add(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    action();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    activeTransactions.delete(db);
  }
}

function ensureSessionMessagePositions(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(session_messages)").all() as Array<{
    name: string;
  }>;
  if (columns.some((column) => column.name === "position")) {
    return;
  }

  runTransaction(db, () => {
    db.exec("ALTER TABLE session_messages ADD COLUMN position INTEGER NOT NULL DEFAULT 0");
    const rows = db
      .prepare(
        `
      SELECT session_id, id
      FROM session_messages
      ORDER BY session_id ASC, timestamp ASC, id ASC
    `,
      )
      .all() as Array<{ session_id: string; id: string }>;
    const update = db.prepare(
      "UPDATE session_messages SET position = ? WHERE session_id = ? AND id = ?",
    );
    let currentSessionId = "";
    let position = 0;
    for (const row of rows) {
      if (row.session_id !== currentSessionId) {
        currentSessionId = row.session_id;
        position = 0;
      }
      update.run(position, row.session_id, row.id);
      position += 1;
    }
  });
  recordMigrationVersion(db, 3);
}
