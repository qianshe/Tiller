import { copyFileSync, cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type {
  AgentMessage,
  AgentToolCall,
  AgentToolCallKind,
  CommandChunk,
  FileDiffSummary,
  SessionSummary,
} from "@tiller/shared";
import {
  pageSessionArtifacts,
  type SessionArtifactPageOptions,
} from "../artifact-store.js";
import {
  pageSessionMessages,
  type SessionMessagePageOptions,
} from "../message-store.js";
import {
  listLegacyJsonSessionIds,
  loadLegacyJsonRuntimeDescriptors,
  loadLegacyJsonSessionArtifacts,
  loadLegacyJsonSessionMessages,
  loadLegacyJsonSessionSummaries,
} from "../legacy-json-loader.js";
import type { StoredSessionRuntimeDescriptor } from "../runtime-store.js";
import {
  hasMigrationVersion,
  openSessionDatabase,
  recordMigrationVersion,
  runTransaction,
  type DatabaseSync,
} from "./core.js";
import {
  mergeSessionMessage,
  mergeToolCall,
  normalizeSessionMessages,
  sortCommandChunks,
  sortToolCalls,
} from "./merge.js";
import { normalizeSessionSummary } from "../summary/store.js";


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
      const next = normalizeSessionMessages(messages);
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
    replaceOutputs(sessionId: string, outputs: CommandChunk[]) {
      replaceSessionOutputs(db, sessionId, outputs);
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

    runTransaction(db, () => {
      for (const summary of loadLegacyJsonSessionSummaries(options.jsonPaths.sessionHistoryPath)) {
        upsertSessionSummary(db, summary);
      }

      for (const sessionId of listLegacyJsonSessionIds(options.jsonPaths.sessionMessagesPath)) {
        replaceSessionMessages(
          db,
          sessionId,
          loadLegacyJsonSessionMessages(options.jsonPaths.sessionMessagesPath, sessionId),
        );
      }

      for (const sessionId of listLegacyJsonSessionIds(options.jsonPaths.sessionArtifactsPath)) {
        const artifacts = loadLegacyJsonSessionArtifacts(
          options.jsonPaths.sessionArtifactsPath,
          sessionId,
        );
        replaceSessionOutputs(db, sessionId, artifacts.outputs);
        replaceSessionDiffs(db, sessionId, artifacts.diffs);
        replaceSessionToolCalls(db, sessionId, artifacts.toolCalls);
      }

      for (const descriptor of loadLegacyJsonRuntimeDescriptors(options.jsonPaths.sessionRuntimesPath)) {
        upsertRuntimeDescriptor(db, descriptor);
      }
      recordMigrationVersion(db, 2);
    });
  } finally {
    db.close();
  }
}

function listSessionSummaries(db: DatabaseSync) {
  const rows = db
    .prepare(
      `
    SELECT payload_json
    FROM session_summaries
    ORDER BY updated_at DESC, created_at DESC
  `,
    )
    .all() as Array<{ payload_json: string }>;
  return rows
    .map((row) => normalizeSessionSummary(parseJson<SessionSummary>(row.payload_json)))
    .filter(isNotNull);
}

function upsertSessionSummary(db: DatabaseSync, summary: SessionSummary) {
  db.prepare(
    `
    INSERT OR REPLACE INTO session_summaries(
      id, project_id, helm_id, worktree_id, agent_id, status, created_at, updated_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    summary.id,
    summary.projectId,
    summary.helmId,
    summary.cwd ?? "",
    summary.agentId,
    summary.status,
    summary.createdAt,
    summary.updatedAt,
    JSON.stringify(summary),
  );
}

function listSessionMessages(db: DatabaseSync, sessionId: string) {
  const rows = db
    .prepare(
      `
    SELECT payload_json
    FROM session_messages
    WHERE session_id = ?
    ORDER BY position ASC, id ASC
  `,
    )
    .all(sessionId) as Array<{ payload_json: string }>;
  return normalizeSessionMessages(
    rows.map((row) => parseJson<AgentMessage>(row.payload_json)).filter(isNotNull),
  );
}

function replaceSessionMessages(db: DatabaseSync, sessionId: string, messages: AgentMessage[]) {
  runTransaction(db, () => {
    db.prepare("DELETE FROM session_messages WHERE session_id = ?").run(sessionId);
    const insert = db.prepare(`
      INSERT OR REPLACE INTO session_messages(session_id, id, position, role, timestamp, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const normalizedMessages = normalizeSessionMessages(messages);
    for (const [position, message] of normalizedMessages.entries()) {
      insert.run(
        sessionId,
        message.id,
        position,
        message.role,
        message.timestamp,
        JSON.stringify(message),
      );
    }
  });
}

function upsertCommandChunk(db: DatabaseSync, sessionId: string, chunk: CommandChunk) {
  db.prepare(
    `
    INSERT OR REPLACE INTO session_outputs(session_id, id, command_id, timestamp, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `,
  ).run(sessionId, chunk.id, chunk.commandId, chunk.timestamp, JSON.stringify(chunk));
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
  const row = db
    .prepare(
      `
    SELECT payload_json
    FROM session_tool_calls
    WHERE session_id = ? AND id = ?
  `,
    )
    .get(sessionId, id) as { payload_json: string } | undefined;
  return row ? normalizeAgentToolCall(parseJson<AgentToolCall>(row.payload_json)) : null;
}

function upsertToolCall(db: DatabaseSync, sessionId: string, toolCall: AgentToolCall) {
  const normalizedToolCall = normalizeAgentToolCall(toolCall)!;
  db.prepare(
    `
    INSERT OR REPLACE INTO session_tool_calls(session_id, id, timestamp, updated_at, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `,
  ).run(
    sessionId,
    normalizedToolCall.id,
    normalizedToolCall.timestamp,
    normalizedToolCall.updatedAt,
    JSON.stringify(normalizedToolCall),
  );
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
  const outputRows = db
    .prepare(
      `
    SELECT payload_json
    FROM session_outputs
    WHERE session_id = ?
    ORDER BY timestamp ASC, id ASC
  `,
    )
    .all(sessionId) as Array<{ payload_json: string }>;
  const diffRows = db
    .prepare(
      `
    SELECT payload_json
    FROM session_diffs
    WHERE session_id = ?
    ORDER BY path ASC
  `,
    )
    .all(sessionId) as Array<{ payload_json: string }>;
  const toolCallRows = db
    .prepare(
      `
    SELECT payload_json
    FROM session_tool_calls
    WHERE session_id = ?
    ORDER BY updated_at ASC, id ASC
  `,
    )
    .all(sessionId) as Array<{ payload_json: string }>;

  return {
    outputs: sortCommandChunks(
      outputRows.map((row) => parseJson<CommandChunk>(row.payload_json)).filter(isNotNull),
    ),
    diffs: diffRows.map((row) => parseJson<FileDiffSummary>(row.payload_json)).filter(isNotNull),
    toolCalls: sortToolCalls(
      toolCallRows
        .map((row) => normalizeAgentToolCall(parseJson<AgentToolCall>(row.payload_json)))
        .filter(isNotNull),
    ),
  };
}

const VALID_TOOL_CALL_KINDS = new Set<AgentToolCallKind>([
  "mcp",
  "skill",
  "read",
  "write",
  "search",
  "shell",
  "fetch",
  "think",
  "todo",
  "subagent",
  "tool",
  "unknown",
]);

function normalizeAgentToolCall(toolCall: AgentToolCall | null): AgentToolCall | null {
  if (!toolCall) return null;

  const normalizedKind = normalizeAgentToolCallKind(toolCall.kind);
  const inputToolName = toolNameFromInput(toolCall.input);
  if (!inputToolName || (normalizedKind !== "mcp" && !isHigherConfidenceToolKind("mcp", normalizedKind))) {
    return { ...toolCall, kind: normalizedKind };
  }

  return {
    ...toolCall,
    kind: "mcp",
    title: resolveMcpToolCallTitle(toolCall.title, toolCall.id, inputToolName),
  };
}

function resolveMcpToolCallTitle(title: string, id: string, inputToolName: string) {
  if (!isInformativeToolCallTitle(title, id) || isFallbackToolCallTitle(title)) {
    return `Tool: ${inputToolName}`;
  }

  const unqualifiedInputToolName = inputToolName.split("/").at(-1);
  return unqualifiedInputToolName && title.trim() === unqualifiedInputToolName
    ? `Tool: ${inputToolName}`
    : title;
}

function normalizeAgentToolCallKind(value: unknown): AgentToolCallKind {
  if (value === "terminal") return "shell";
  if (value === "edit") return "write";
  return typeof value === "string" && VALID_TOOL_CALL_KINDS.has(value as AgentToolCallKind)
    ? (value as AgentToolCallKind)
    : "unknown";
}

function isHigherConfidenceToolKind(
  incomingKind: AgentToolCallKind,
  currentKind: AgentToolCallKind,
) {
  const rank: Record<AgentToolCallKind, number> = {
    unknown: 0,
    tool: 1,
    think: 2,
    todo: 2,
    fetch: 2,
    search: 2,
    read: 3,
    write: 3,
    shell: 3,
    skill: 3,
    subagent: 3,
    mcp: 4,
  };
  return rank[incomingKind] > rank[currentKind];
}

function toolNameFromInput(input: string | undefined) {
  if (!input) return undefined;
  try {
    const parsed = JSON.parse(input) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const record = parsed as Record<string, unknown>;
    const request = record.request && typeof record.request === "object"
      ? record.request as Record<string, unknown>
      : undefined;
    const server = primitiveStringFrom(record.server ?? record.server_name ?? record.serverName);
    const tool = primitiveStringFrom(
      record.tool ??
        record.name ??
        record.toolName ??
        record.tool_name ??
        request?.name ??
        request?.tool ??
        request?.toolName ??
        request?.tool_name,
    );
    return server && tool ? `${server}/${tool}` : tool ?? server ?? inferToolNameFromStructuredPayload(record);
  } catch {
    return undefined;
  }
}

function inferToolNameFromStructuredPayload(record: Record<string, unknown>) {
  if (typeof record.code === "string" && ("timeout_ms" in record || "timeoutMs" in record)) {
    return "node_repl/js";
  }
  if (
    typeof record.project_root_path === "string" &&
    typeof record.message === "string" &&
    Array.isArray(record.predefined_options)
  ) {
    return "sanshu/zhi";
  }
  if (typeof record.project_path === "string" && typeof record.action === "string") {
    return "sanshu/ji";
  }
  return undefined;
}

function primitiveStringFrom(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function isFallbackToolCallTitle(title: string | undefined) {
  return /^Tool call\b/u.test(title?.trim() ?? "");
}

function isInformativeToolCallTitle(title: string | undefined, id: string) {
  const normalized = title?.trim();
  return Boolean(normalized && normalized !== id && !/^call_[A-Za-z0-9]+$/u.test(normalized));
}

function listRuntimeDescriptors(db: DatabaseSync) {
  const rows = db
    .prepare(
      `
    SELECT payload_json
    FROM session_runtimes
    ORDER BY last_seen_at DESC, session_id ASC
  `,
    )
    .all() as Array<{ payload_json: string }>;
  return rows
    .map((row) => parseJson<StoredSessionRuntimeDescriptor>(row.payload_json))
    .filter(isNotNull);
}

function getRuntimeDescriptor(db: DatabaseSync, sessionId: string) {
  const row = db
    .prepare(
      `
    SELECT payload_json
    FROM session_runtimes
    WHERE session_id = ?
  `,
    )
    .get(sessionId) as { payload_json: string } | undefined;
  return row ? parseJson<StoredSessionRuntimeDescriptor>(row.payload_json) : null;
}

function upsertRuntimeDescriptor(db: DatabaseSync, descriptor: StoredSessionRuntimeDescriptor) {
  db.prepare(
    `
    INSERT OR REPLACE INTO session_runtimes(
      session_id, provider_id, runtime_session_id, last_seen_at, state, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    descriptor.sessionId,
    descriptor.providerId,
    descriptor.runtimeSessionId ?? null,
    descriptor.lastSeenAt,
    descriptor.state,
    JSON.stringify(descriptor),
  );
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
