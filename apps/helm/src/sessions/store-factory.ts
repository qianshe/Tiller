import type {
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionSummary,
} from "@tiller/shared";
import { createSessionArtifactStore, type SessionArtifactPageOptions } from "./artifact-store.js";
import { createSessionMessageStore, type SessionMessagePageOptions } from "./message-store.js";
import { createSessionRuntimeStore, type StoredSessionRuntimeDescriptor } from "./runtime-store.js";
import { createSessionStore } from "./summary-store.js";
import {
  createSqliteSessionArtifactStore,
  createSqliteSessionMessageStore,
  createSqliteSessionRuntimeStore,
  createSqliteSessionStore,
  migrateJsonSessionDataToSqlite,
  type JsonSessionStorePaths,
} from "./sqlite-store.js";

export type SessionStoreBackend = "sqlite" | "json";

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
  backend: SessionStoreBackend;
  sessionStore: SessionSummaryStore;
  sessionMessageStore: SessionMessageStore;
  sessionArtifactStore: SessionArtifactStore;
  sessionRuntimeStore: SessionRuntimeStore;
};

type StoreFactoryLogger = (message: string) => void;

export type HelmSessionStoreFactoryOptions = {
  backend?: SessionStoreBackend;
  sqlitePath: string;
  jsonPaths: JsonSessionStorePaths;
  logInfo?: StoreFactoryLogger;
  logError?: StoreFactoryLogger;
};

export function resolveSessionStoreBackend(
  env: NodeJS.ProcessEnv = process.env,
): SessionStoreBackend {
  return env.TILLER_SESSION_STORE?.toLowerCase() === "json" ? "json" : "sqlite";
}

export function createHelmSessionStores(
  options: HelmSessionStoreFactoryOptions,
): HelmSessionStores {
  const requestedBackend = options.backend ?? resolveSessionStoreBackend();
  if (requestedBackend === "json") {
    options.logInfo?.("[tiller] session.store backend=json reason=env");
    return createJsonHelmSessionStores(options.jsonPaths);
  }

  try {
    migrateJsonSessionDataToSqlite({
      sqlitePath: options.sqlitePath,
      jsonPaths: options.jsonPaths,
    });
    options.logInfo?.(`[tiller] session.store backend=sqlite path=${options.sqlitePath}`);
    return {
      backend: "sqlite",
      sessionStore: createSqliteSessionStore(options.sqlitePath),
      sessionMessageStore: createSqliteSessionMessageStore(options.sqlitePath),
      sessionArtifactStore: createSqliteSessionArtifactStore(options.sqlitePath),
      sessionRuntimeStore: createSqliteSessionRuntimeStore(options.sqlitePath),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    options.logError?.(
      `[tiller] session.store backend=json reason=sqlite-fallback detail=${reason}`,
    );
    return createJsonHelmSessionStores(options.jsonPaths);
  }
}

function createJsonHelmSessionStores(jsonPaths: JsonSessionStorePaths): HelmSessionStores {
  return {
    backend: "json",
    sessionStore: createSessionStore(jsonPaths.sessionHistoryPath),
    sessionMessageStore: createSessionMessageStore(jsonPaths.sessionMessagesPath),
    sessionArtifactStore: createSessionArtifactStore(jsonPaths.sessionArtifactsPath),
    sessionRuntimeStore: createSessionRuntimeStore(jsonPaths.sessionRuntimesPath),
  };
}
