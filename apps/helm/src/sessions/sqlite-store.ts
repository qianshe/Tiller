import { DatabaseSync } from "node:sqlite";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { AgentMessage, AgentToolCall, CommandChunk, FileDiffSummary, SessionSummary } from "@tiller/shared";
import { createSessionArtifactStore, pageSessionArtifacts, type SessionArtifactPageOptions } from "./artifact-store.js";
import { createSessionMessageStore, pageSessionMessages, type SessionMessagePageOptions } from "./message-store.js";
import { createSessionRuntimeStore, type StoredSessionRuntimeDescriptor } from "./runtime-store.js";
import { createSessionStore } from "./summary-store.js";

type SessionArtifacts = {
  outputs: CommandChunk[];
  diffs: FileDiffSummary[];
  toolCalls: AgentToolCall[];
};

export type JsonSessionStorePaths = {
  sessionHistoryPath: string;
  sessionMessagesPath: string;
  sessionArtifactsPath: string;
  sessionRuntimesPath: string;
};

export type JsonToSqliteMigrationOptions = {
  sqlitePath: string;
  jsonPaths: JsonSessionStorePaths;
};

const activeTransactions = new WeakSet<DatabaseSync>();

export function createSqliteSessionStore(dbPath: string) {
  const db = openSessionDatabase(dbPath);

  return {
    list() {
      return listSessionSummaries(db);
    },
    upsert(summary: SessionSummary) {
      upsertSessionSummary(db, summary);
      return listSessionSummaries(db);
    },
    remove(sessionId: string) {
      db.prepare("DELETE FROM session_summaries WHERE id = ?").run(sessionId);
      return listSessionSummaries(db);
    },
    close() {
      db.close();
    },
  };
}

export function createSqliteSessionMessageStore(dbPath: string) {
  const db = openSessionDatabase(dbPath);

  return {
    append(sessionId: string, message: AgentMessage) {
      const next = mergeSessionMessage(listSessionMessages(db, sessionId), message);
      replaceSessionMessages(db, sessionId, next);
      return next;
    },
    replace(sessionId: string, messages: AgentMessage[]) {
      const next = sortAgentMessages(messages);
      replaceSessionMessages(db, sessionId, next);
      return next;
    },
    list(sessionId: string) {
      return listSessionMessages(db, sessionId);
    },
    listPage(sessionId: string, options: SessionMessagePageOptions = {}) {
      return pageSessionMessages(listSessionMessages(db, sessionId), options);
    },
    remove(sessionId: string) {
      db.prepare("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);
    },
    close() {
      db.close();
    },
  };
}

export function createSqliteSessionArtifactStore(dbPath: string) {
  const db = openSessionDatabase(dbPath);

  return {
    appendOutput(sessionId: string, chunk: CommandChunk) {
      upsertCommandChunk(db, sessionId, chunk);
      return getSessionArtifacts(db, sessionId);
    },
    replaceDiffs(sessionId: string, diffs: FileDiffSummary[]) {
      replaceSessionDiffs(db, sessionId, diffs);
      return getSessionArtifacts(db, sessionId);
    },
    appendToolCall(sessionId: string, toolCall: AgentToolCall) {
      const existing = getToolCall(db, sessionId, toolCall.id);
      const next = existing ? mergeToolCall(existing, toolCall) : toolCall;
      upsertToolCall(db, sessionId, next);
      return getSessionArtifacts(db, sessionId);
    },
    replaceToolCalls(sessionId: string, toolCalls: AgentToolCall[]) {
      replaceSessionToolCalls(db, sessionId, sortToolCalls(toolCalls));
      return getSessionArtifacts(db, sessionId);
    },
    get(sessionId: string) {
      return getSessionArtifacts(db, sessionId);
    },
    getPage(sessionId: string, options: SessionArtifactPageOptions = {}) {
      return pageSessionArtifacts(getSessionArtifacts(db, sessionId), options);
    },
    remove(sessionId: string) {
      runTransaction(db, () => {
        db.prepare("DELETE FROM session_outputs WHERE session_id = ?").run(sessionId);
        db.prepare("DELETE FROM session_tool_calls WHERE session_id = ?").run(sessionId);
        db.prepare("DELETE FROM session_diffs WHERE session_id = ?").run(sessionId);
      });
    },
    close() {
      db.close();
    },
  };
}

export function createSqliteSessionRuntimeStore(dbPath: string) {
  const db = openSessionDatabase(dbPath);

  return {
    list() {
      return listRuntimeDescriptors(db);
    },
    get(sessionId: string) {
      return getRuntimeDescriptor(db, sessionId);
    },
    upsert(descriptor: StoredSessionRuntimeDescriptor) {
      upsertRuntimeDescriptor(db, descriptor);
      return descriptor;
    },
    remove(sessionId: string) {
      db.prepare("DELETE FROM session_runtimes WHERE session_id = ?").run(sessionId);
    },
    close() {
      db.close();
    },
  };
}

export function initializeSqliteSessionStore(dbPath: string) {
  const db = openSessionDatabase(dbPath);
  db.close();
}

export function migrateJsonSessionDataToSqlite(options: JsonToSqliteMigrationOptions) {
  const db = openSessionDatabase(options.sqlitePath);
  try {
    if (hasMigrationVersion(db, 2)) {
      return;
    }

    backupJsonSessionData(options.jsonPaths);

    const summaryStore = createSessionStore(options.jsonPaths.sessionHistoryPath);
    const messageStore = createSessionMessageStore(options.jsonPaths.sessionMessagesPath);
    const artifactStore = createSessionArtifactStore(options.jsonPaths.sessionArtifactsPath);
    const runtimeStore = createSessionRuntimeStore(options.jsonPaths.sessionRuntimesPath);

    runTransaction(db, () => {
      for (const summary of summaryStore.list()) {
        upsertSessionSummary(db, summary);
      }

      for (const sessionId of listJsonSessionIds(options.jsonPaths.sessionMessagesPath)) {
        replaceSessionMessages(db, sessionId, messageStore.list(sessionId));
      }

      for (const sessionId of listJsonSessionIds(options.jsonPaths.sessionArtifactsPath)) {
        const artifacts = artifactStore.get(sessionId);
        replaceSessionOutputs(db, sessionId, artifacts.outputs);
        replaceSessionDiffs(db, sessionId, artifacts.diffs);
        replaceSessionToolCalls(db, sessionId, artifacts.toolCalls);
      }

      for (const descriptor of runtimeStore.list()) {
        upsertRuntimeDescriptor(db, descriptor);
      }
      recordMigrationVersion(db, 2);
    });
  } finally {
    db.close();
  }
}

function openSessionDatabase(dbPath: string) {
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
      workspace_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_messages(
      session_id TEXT NOT NULL,
      id TEXT NOT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_session_messages_page ON session_messages(session_id, timestamp, id);
    CREATE INDEX IF NOT EXISTS idx_session_outputs_page ON session_outputs(session_id, timestamp, id);
    CREATE INDEX IF NOT EXISTS idx_session_tool_calls_page ON session_tool_calls(session_id, updated_at, id);
    CREATE INDEX IF NOT EXISTS idx_session_diffs_session ON session_diffs(session_id);
  `);
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, ?)").run(new Date().toISOString());
  return db;
}

function hasMigrationVersion(db: DatabaseSync, version: number) {
  const row = db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(version);
  return Boolean(row);
}

function recordMigrationVersion(db: DatabaseSync, version: number) {
  db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(?, ?)").run(version, new Date().toISOString());
}

function listSessionSummaries(db: DatabaseSync) {
  const rows = db.prepare(`
    SELECT payload_json
    FROM session_summaries
    ORDER BY updated_at DESC, created_at DESC
  `).all() as Array<{ payload_json: string }>;
  return rows.map((row) => parseJson<SessionSummary>(row.payload_json)).filter(isNotNull);
}

function upsertSessionSummary(db: DatabaseSync, summary: SessionSummary) {
  db.prepare(`
    INSERT OR REPLACE INTO session_summaries(
      id, project_id, helm_id, workspace_id, agent_id, status, created_at, updated_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    summary.id,
    summary.projectId,
    summary.helmId,
    summary.workspaceId,
    summary.agentId,
    summary.status,
    summary.createdAt,
    summary.updatedAt,
    JSON.stringify(summary),
  );
}

function listSessionMessages(db: DatabaseSync, sessionId: string) {
  const rows = db.prepare(`
    SELECT payload_json
    FROM session_messages
    WHERE session_id = ?
    ORDER BY timestamp ASC, id ASC
  `).all(sessionId) as Array<{ payload_json: string }>;
  return normalizeSessionMessages(rows.map((row) => parseJson<AgentMessage>(row.payload_json)).filter(isNotNull));
}

function replaceSessionMessages(db: DatabaseSync, sessionId: string, messages: AgentMessage[]) {
  runTransaction(db, () => {
    db.prepare("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);
    const insert = db.prepare(`
      INSERT OR REPLACE INTO session_messages(session_id, id, role, timestamp, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const message of sortAgentMessages(messages)) {
      insert.run(sessionId, message.id, message.role, message.timestamp, JSON.stringify(message));
    }
  });
}

function upsertCommandChunk(db: DatabaseSync, sessionId: string, chunk: CommandChunk) {
  db.prepare(`
    INSERT OR REPLACE INTO session_outputs(session_id, id, command_id, timestamp, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, chunk.id, chunk.commandId, chunk.timestamp, JSON.stringify(chunk));
}

function replaceSessionOutputs(db: DatabaseSync, sessionId: string, outputs: CommandChunk[]) {
  runTransaction(db, () => {
    db.prepare("DELETE FROM session_outputs WHERE session_id = ?").run(sessionId);
    for (const chunk of sortCommandChunks(outputs)) {
      upsertCommandChunk(db, sessionId, chunk);
    }
  });
}

function replaceSessionDiffs(db: DatabaseSync, sessionId: string, diffs: FileDiffSummary[]) {
  runTransaction(db, () => {
    db.prepare("DELETE FROM session_diffs WHERE session_id = ?").run(sessionId);
    const insert = db.prepare(`
      INSERT OR REPLACE INTO session_diffs(session_id, path, updated_at, payload_json)
      VALUES (?, ?, ?, ?)
    `);
    const updatedAt = new Date().toISOString();
    for (const diff of diffs) {
      insert.run(sessionId, diff.path, updatedAt, JSON.stringify(diff));
    }
  });
}

function getToolCall(db: DatabaseSync, sessionId: string, id: string) {
  const row = db.prepare(`
    SELECT payload_json
    FROM session_tool_calls
    WHERE session_id = ? AND id = ?
  `).get(sessionId, id) as { payload_json: string } | undefined;
  return row ? parseJson<AgentToolCall>(row.payload_json) : null;
}

function upsertToolCall(db: DatabaseSync, sessionId: string, toolCall: AgentToolCall) {
  db.prepare(`
    INSERT OR REPLACE INTO session_tool_calls(session_id, id, timestamp, updated_at, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, toolCall.id, toolCall.timestamp, toolCall.updatedAt, JSON.stringify(toolCall));
}

function replaceSessionToolCalls(db: DatabaseSync, sessionId: string, toolCalls: AgentToolCall[]) {
  runTransaction(db, () => {
    db.prepare("DELETE FROM session_tool_calls WHERE session_id = ?").run(sessionId);
    for (const toolCall of sortToolCalls(toolCalls)) {
      upsertToolCall(db, sessionId, toolCall);
    }
  });
}

function getSessionArtifacts(db: DatabaseSync, sessionId: string): SessionArtifacts {
  const outputRows = db.prepare(`
    SELECT payload_json
    FROM session_outputs
    WHERE session_id = ?
    ORDER BY timestamp ASC, id ASC
  `).all(sessionId) as Array<{ payload_json: string }>;
  const diffRows = db.prepare(`
    SELECT payload_json
    FROM session_diffs
    WHERE session_id = ?
    ORDER BY path ASC
  `).all(sessionId) as Array<{ payload_json: string }>;
  const toolCallRows = db.prepare(`
    SELECT payload_json
    FROM session_tool_calls
    WHERE session_id = ?
    ORDER BY updated_at ASC, id ASC
  `).all(sessionId) as Array<{ payload_json: string }>;

  return {
    outputs: sortCommandChunks(outputRows.map((row) => parseJson<CommandChunk>(row.payload_json)).filter(isNotNull)),
    diffs: diffRows.map((row) => parseJson<FileDiffSummary>(row.payload_json)).filter(isNotNull),
    toolCalls: sortToolCalls(toolCallRows.map((row) => parseJson<AgentToolCall>(row.payload_json)).filter(isNotNull)),
  };
}

function listRuntimeDescriptors(db: DatabaseSync) {
  const rows = db.prepare(`
    SELECT payload_json
    FROM session_runtimes
    ORDER BY last_seen_at DESC, session_id ASC
  `).all() as Array<{ payload_json: string }>;
  return rows.map((row) => parseJson<StoredSessionRuntimeDescriptor>(row.payload_json)).filter(isNotNull);
}

function getRuntimeDescriptor(db: DatabaseSync, sessionId: string) {
  const row = db.prepare(`
    SELECT payload_json
    FROM session_runtimes
    WHERE session_id = ?
  `).get(sessionId) as { payload_json: string } | undefined;
  return row ? parseJson<StoredSessionRuntimeDescriptor>(row.payload_json) : null;
}

function upsertRuntimeDescriptor(db: DatabaseSync, descriptor: StoredSessionRuntimeDescriptor) {
  db.prepare(`
    INSERT OR REPLACE INTO session_runtimes(
      session_id, provider_id, runtime_session_id, last_seen_at, state, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    descriptor.sessionId,
    descriptor.providerId,
    descriptor.runtimeSessionId ?? null,
    descriptor.lastSeenAt,
    descriptor.state,
    JSON.stringify(descriptor),
  );
}

function mergeSessionMessage(messages: AgentMessage[], message: AgentMessage) {
  return normalizeSessionMessages([...messages, message]);
}

function normalizeSessionMessages(messages: AgentMessage[]) {
  return sortAgentMessages(messages).reduce<AgentMessage[]>((merged, message) => {
    const last = merged.at(-1);
    if (!last || (last.id !== message.id && !shouldMergeAssistantStreamChunk(last, message))) {
      return [...merged, message];
    }

    return [
      ...merged.slice(0, -1),
      mergeAgentMessageChunk(last, message),
    ];
  }, []);
}

function shouldMergeAssistantStreamChunk(current: AgentMessage, incoming: AgentMessage) {
  return current.role === "assistant" && incoming.role === "assistant" && isRuntimeGeneratedMessageId(current.id) && isRuntimeGeneratedMessageId(incoming.id);
}

function isRuntimeGeneratedMessageId(id: string) {
  return /-msg-\d+$/u.test(id);
}

function mergeAgentMessageChunk(current: AgentMessage, incoming: AgentMessage): AgentMessage {
  const isDuplicateText = current.text === incoming.text || current.text.endsWith(incoming.text);
  const isCumulativeSnapshot = incoming.text.startsWith(current.text);
  const nextText = isDuplicateText ? current.text : isCumulativeSnapshot ? incoming.text : `${current.text}${incoming.text}`;
  return {
    ...current,
    ...incoming,
    id: current.id,
    text: collapseRepeatedAssistantText(nextText),
    timestamp: isDuplicateText && Date.parse(incoming.timestamp) > Date.parse(current.timestamp) ? incoming.timestamp : current.timestamp,
  };
}

function collapseRepeatedAssistantText(text: string) {
  const firstLine = text.split(/\r?\n/u)[0]?.trim();
  if (!firstLine || firstLine.length < 8) {
    return text;
  }

  const repeatIndex = text.indexOf(firstLine, firstLine.length);
  if (repeatIndex === -1) {
    return text;
  }

  const bridgeIndex = text.lastIndexOf("我会按 `superpowers`", repeatIndex);
  const cutIndex = bridgeIndex !== -1 && repeatIndex - bridgeIndex < 240 ? bridgeIndex : repeatIndex;
  return text.slice(0, cutIndex).trimEnd();
}

function mergeToolCall(current: AgentToolCall, incoming: AgentToolCall): AgentToolCall {
  return {
    ...current,
    ...incoming,
    title: resolveToolCallTitle(current.title, incoming.title, incoming.id),
    output: `${current.output ?? ""}${incoming.output ?? ""}`,
    input: incoming.input ?? current.input,
    timestamp: current.timestamp,
    updatedAt: incoming.updatedAt,
  };
}

function resolveToolCallTitle(currentTitle: string, incomingTitle: string, id: string) {
  if (isInformativeToolCallTitle(incomingTitle, id)) {
    return incomingTitle;
  }
  return currentTitle || incomingTitle || id;
}

function isInformativeToolCallTitle(title: string | undefined, id: string) {
  const normalized = title?.trim();
  return Boolean(normalized && normalized !== id && !/^call_[A-Za-z0-9]+$/u.test(normalized));
}

function sortAgentMessages(messages: AgentMessage[]) {
  return [...messages].sort((left, right) => compareHistoryPosition(left.timestamp, left.id, right.timestamp, right.id));
}

function sortCommandChunks(items: CommandChunk[]) {
  return [...items].sort((left, right) => compareHistoryPosition(left.timestamp, left.id, right.timestamp, right.id));
}

function sortToolCalls(items: AgentToolCall[]) {
  return [...items].sort((left, right) => compareHistoryPosition(left.updatedAt || left.timestamp, left.id, right.updatedAt || right.timestamp, right.id));
}

function compareHistoryPosition(leftTimestamp: string, leftId: string, rightTimestamp: string, rightId: string) {
  const timestampDelta = Date.parse(leftTimestamp) - Date.parse(rightTimestamp);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return leftId.localeCompare(rightId);
}

function runTransaction(db: DatabaseSync, action: () => void) {
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

function parseJson<T>(raw: string) {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isNotNull<T>(value: T | null): value is T {
  return value !== null;
}

function backupJsonSessionData(paths: JsonSessionStorePaths) {
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  backupPath(paths.sessionHistoryPath, stamp);
  backupPath(paths.sessionRuntimesPath, stamp);
  backupPath(paths.sessionMessagesPath, stamp);
  backupPath(paths.sessionArtifactsPath, stamp);
}

function backupPath(path: string, stamp: string) {
  if (!existsSync(path)) {
    return;
  }
  const backup = `${path}.bak-${stamp}`;
  if (statSync(path).isDirectory()) {
    cpSync(path, backup, { recursive: true, force: false, errorOnExist: true });
    return;
  }
  copyFileSync(path, backup);
}

function listJsonSessionIds(rootDir: string) {
  try {
    return readdirSync(rootDir)
      .filter((entry) => extname(entry) === ".json")
      .map((entry) => basename(entry, ".json"));
  } catch {
    return [];
  }
}
