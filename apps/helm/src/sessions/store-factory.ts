import {
  createSqliteSessionArtifactStore,
  createSqliteSessionMessageStore,
  createSqliteSessionRuntimeStore,
  createSqliteSessionStore,
  createSqliteSessionTimelineStore,
  migrateJsonSessionDataToSqlite,
  type HelmSessionStores,
  type JsonSessionStorePaths,
  type SessionArtifactStore,
  type SessionMessageStore,
  type SessionRuntimeStore,
  type SessionSummaryStore,
  type SessionTimelineStore,
  type StoredSessionArtifacts,
} from "@tiller/persistence";

export type {
  HelmSessionStores,
  SessionArtifactStore,
  SessionMessageStore,
  SessionRuntimeStore,
  SessionSummaryStore,
  SessionTimelineStore,
  StoredSessionArtifacts,
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
    sessionTimelineStore: createSqliteSessionTimelineStore(options.sqlitePath),
  };
}
