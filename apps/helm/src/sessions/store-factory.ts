import type {
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionSummary,
} from "@tiller/shared";
import type { SessionArtifactPageOptions } from "./artifact-store.js";
import type { SessionMessagePageOptions } from "./message-store.js";
import type { StoredSessionRuntimeDescriptor } from "./runtime-store.js";
import {
  createSqliteSessionArtifactStore,
  createSqliteSessionMessageStore,
  createSqliteSessionRuntimeStore,
  createSqliteSessionStore,
  migrateJsonSessionDataToSqlite,
  type JsonSessionStorePaths,
} from "./sqlite/store.js";

export type StoredSessionArtifacts = {
  outputs: CommandChunk[];
  diffs: FileDiffSummary[];
  toolCalls: AgentToolCall[];
};

export type SessionSummaryStore = {
  list: () => SessionSummary[];
  upsert: (summary: SessionSummary) => SessionSummary[];
  remove: (sessionId: string) => SessionSummary[];
};

export type SessionMessageStore = {
  append: (sessionId: string, message: AgentMessage) => AgentMessage[];
  replace: (sessionId: string, messages: AgentMessage[]) => AgentMessage[];
  list: (sessionId: string) => AgentMessage[];
  listPage: (
    sessionId: string,
    options?: SessionMessagePageOptions,
  ) => { messages: AgentMessage[]; nextCursor?: string; hasMore: boolean };
  remove: (sessionId: string) => void;
};

export type SessionArtifactStore = {
  appendOutput: (sessionId: string, chunk: CommandChunk) => StoredSessionArtifacts;
  replaceDiffs: (sessionId: string, diffs: FileDiffSummary[]) => StoredSessionArtifacts;
  appendToolCall: (sessionId: string, toolCall: AgentToolCall) => StoredSessionArtifacts;
  replaceToolCalls: (sessionId: string, toolCalls: AgentToolCall[]) => StoredSessionArtifacts;
  get: (sessionId: string) => StoredSessionArtifacts;
  getPage: (
    sessionId: string,
    options?: SessionArtifactPageOptions,
  ) => StoredSessionArtifacts & { nextCursor?: string; hasMore: boolean };
  remove: (sessionId: string) => void;
};

export type SessionRuntimeStore = {
  list: () => StoredSessionRuntimeDescriptor[];
  get: (sessionId: string) => StoredSessionRuntimeDescriptor | null;
  upsert: (descriptor: StoredSessionRuntimeDescriptor) => StoredSessionRuntimeDescriptor;
  remove: (sessionId: string) => void;
};

export type HelmSessionStores = {
  sessionStore: SessionSummaryStore;
  sessionMessageStore: SessionMessageStore;
  sessionArtifactStore: SessionArtifactStore;
  sessionRuntimeStore: SessionRuntimeStore;
};

type StoreFactoryLogger = (message: string) => void;

export type HelmSessionStoreFactoryOptions = {
  sqlitePath: string;
  /**
   * Legacy JSON paths used only for the one-shot SQLite migration. Once the
   * migration version is recorded (`hasMigrationVersion(db, 2)`), these paths
   * are no longer read on subsequent boots.
   */
  jsonPaths: JsonSessionStorePaths;
  logInfo?: StoreFactoryLogger;
  logError?: StoreFactoryLogger;
};

export function createHelmSessionStores(
  options: HelmSessionStoreFactoryOptions,
): HelmSessionStores {
  migrateJsonSessionDataToSqlite({
    sqlitePath: options.sqlitePath,
    jsonPaths: options.jsonPaths,
  });
  options.logInfo?.(`[tiller] session.store backend=sqlite path=${options.sqlitePath}`);
  return {
    sessionStore: createSqliteSessionStore(options.sqlitePath),
    sessionMessageStore: createSqliteSessionMessageStore(options.sqlitePath),
    sessionArtifactStore: createSqliteSessionArtifactStore(options.sqlitePath),
    sessionRuntimeStore: createSqliteSessionRuntimeStore(options.sqlitePath),
  };
}
