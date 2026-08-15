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

    CREATE TABLE IF NOT EXISTS conversation_preparations(
      id TEXT PRIMARY KEY,
      project_id TEXT,
      cwd TEXT,
      agent_id TEXT,
      revision INTEGER NOT NULL,
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

    CREATE TABLE IF NOT EXISTS session_timeline_message_anchors(
      session_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      group_kind TEXT NOT NULL,
      anchor_position INTEGER NOT NULL,
      start_position INTEGER NOT NULL,
      anchor_timestamp TEXT NOT NULL,
      PRIMARY KEY(session_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS session_timeline_anchor_states(
      session_id TEXT PRIMARY KEY,
      initialized_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_updates(
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      runtime_session_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      source TEXT NOT NULL,
      update_type TEXT NOT NULL,
      received_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY(session_id, sequence)
    );

    CREATE TABLE IF NOT EXISTS session_timeline_blocks(
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      first_position INTEGER NOT NULL,
      last_position INTEGER NOT NULL,
      entry_count INTEGER NOT NULL,
      byte_size INTEGER NOT NULL,
      storage_key TEXT NOT NULL,
      sha256 TEXT,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      sealed_at TEXT,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_timeline_block_entries(
      session_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      block_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY(session_id, entry_id)
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

    CREATE TABLE IF NOT EXISTS session_output_bodies(
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      output_id TEXT NOT NULL,
      mime_type TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS session_plans(
      session_id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_diff_bodies(
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      storage_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      UNIQUE(session_id, path)
    );

    CREATE TABLE IF NOT EXISTS session_states(
      session_id TEXT PRIMARY KEY,
      applied_sequence INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_approval_states(
      session_id TEXT PRIMARY KEY,
      applied_sequence INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_approval_history(
      record_key TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      runtime_instance_id TEXT NOT NULL,
      approval_request_id TEXT NOT NULL,
      status TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      UNIQUE(session_id, runtime_instance_id, approval_request_id)
    );

    CREATE TABLE IF NOT EXISTS session_subagent_details(
      session_id TEXT NOT NULL,
      parent_tool_call_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      through_sequence INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(session_id, parent_tool_call_id)
    );

    CREATE TABLE IF NOT EXISTS session_subagent_entries(
      session_id TEXT NOT NULL,
      parent_tool_call_id TEXT NOT NULL,
      entry_kind TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      first_sequence INTEGER NOT NULL,
      updated_sequence INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY(session_id, parent_tool_call_id, entry_kind, entry_id)
    );

    CREATE TABLE IF NOT EXISTS helm_notifications(
      id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS helm_notification_state(
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cleared_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_session_summaries_updated_at ON session_summaries(updated_at);
    CREATE INDEX IF NOT EXISTS idx_conversation_preparations_updated_at ON conversation_preparations(updated_at);
    CREATE INDEX IF NOT EXISTS idx_session_outputs_page ON session_outputs(session_id, timestamp, id);
    CREATE INDEX IF NOT EXISTS idx_session_tool_calls_page ON session_tool_calls(session_id, updated_at, id);
    CREATE INDEX IF NOT EXISTS idx_session_timeline_entries_page ON session_timeline_entries(session_id, position, id);
    CREATE INDEX IF NOT EXISTS idx_session_timeline_message_anchors_page ON session_timeline_message_anchors(session_id, anchor_position DESC, group_id DESC);
    CREATE INDEX IF NOT EXISTS idx_session_updates_page ON session_updates(session_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_session_timeline_blocks_latest ON session_timeline_blocks(session_id, last_position DESC);
    CREATE INDEX IF NOT EXISTS idx_session_timeline_block_entries_block ON session_timeline_block_entries(block_id);
    CREATE INDEX IF NOT EXISTS idx_session_attachments_session_message ON session_attachments(session_id, message_id);
    CREATE INDEX IF NOT EXISTS idx_session_attachments_sha256 ON session_attachments(sha256);
    CREATE INDEX IF NOT EXISTS idx_session_output_bodies_session ON session_output_bodies(session_id, output_id);
    CREATE INDEX IF NOT EXISTS idx_session_output_bodies_sha256 ON session_output_bodies(sha256);
    CREATE INDEX IF NOT EXISTS idx_session_diff_bodies_session ON session_diff_bodies(session_id, path);
    CREATE INDEX IF NOT EXISTS idx_session_diff_bodies_sha256 ON session_diff_bodies(sha256);
    CREATE INDEX IF NOT EXISTS idx_session_diffs_session ON session_diffs(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_plans_updated_at ON session_plans(updated_at);
    CREATE INDEX IF NOT EXISTS idx_session_approval_history_page ON session_approval_history(updated_at DESC, record_key DESC);
    CREATE INDEX IF NOT EXISTS idx_session_approval_history_status ON session_approval_history(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_approval_history_session ON session_approval_history(session_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_subagent_entries_order ON session_subagent_entries(session_id, parent_tool_call_id, first_sequence);
    CREATE INDEX IF NOT EXISTS idx_helm_notifications_occurred_at ON helm_notifications(occurred_at DESC, id DESC);
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

export function runTransaction<T>(db: DatabaseSync, action: () => T): T {
  if (activeTransactions.has(db)) {
    return action();
  }

  activeTransactions.add(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
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
