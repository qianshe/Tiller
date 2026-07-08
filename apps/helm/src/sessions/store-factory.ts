import {
  createSqliteSessionArtifactStore,
  createSqliteSessionAttachmentStore,
  createSqliteSessionMessageStore,
  createSqliteSessionOutputBodyStore,
  createSqliteSessionPlanStore,
  createSqliteSessionRuntimeStore,
  createSqliteSessionStore,
  createSqliteSessionUpdateStore,
  migrateJsonSessionDataToSqlite,
  type HelmSessionStores,
  type JsonSessionStorePaths,
  type SessionArtifactStore,
  type SessionAttachmentStore,
  type SessionMessageStore,
  type SessionOutputBodyStore,
  type SessionPlanStore,
  type SessionRuntimeStore,
  type SessionSummaryStore,
  type SessionTimelineStore,
  type SessionUpdateStore,
  type StoredSessionArtifacts,
} from "@tiller/persistence";
import { createModeAwareSessionTimelineStore } from "./timeline-store-mode";

export type {
  HelmSessionStores,
  SessionArtifactStore,
  SessionAttachmentStore,
  SessionMessageStore,
  SessionOutputBodyStore,
  SessionPlanStore,
  SessionRuntimeStore,
  SessionSummaryStore,
  SessionTimelineStore,
  SessionUpdateStore,
  StoredSessionArtifacts,
};

type StoreFactoryLogger = (message: string) => void;

export type HelmSessionStoreFactoryOptions = {
  sqlitePath: string;
  attachmentRootPath: string;
  outputBodyRootPath: string;
  timelineBlockRootPath?: string;
  timelineBlockMode?: string;
  /**
   * Legacy JSON paths used only for the one-shot SQLite migration. Once the
   * migration version is recorded (`hasMigrationVersion(db, 2)`), these paths
   * are no longer read on subsequent boots.
   */
  jsonPaths: JsonSessionStorePaths;
  logDebug?: StoreFactoryLogger;
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
  options.logDebug?.(`[tiller] session.store backend=sqlite path=${options.sqlitePath}`);
  return {
    sessionStore: createSqliteSessionStore(options.sqlitePath),
    sessionMessageStore: createSqliteSessionMessageStore(options.sqlitePath),
    sessionArtifactStore: createSqliteSessionArtifactStore(options.sqlitePath),
    sessionAttachmentStore: createSqliteSessionAttachmentStore({
      dbPath: options.sqlitePath,
      rootPath: options.attachmentRootPath,
    }),
    sessionOutputBodyStore: createSqliteSessionOutputBodyStore({
      dbPath: options.sqlitePath,
      rootPath: options.outputBodyRootPath,
    }),
    sessionRuntimeStore: createSqliteSessionRuntimeStore(options.sqlitePath),
    sessionPlanStore: createSqliteSessionPlanStore(options.sqlitePath),
    sessionTimelineStore: createModeAwareSessionTimelineStore({
      sqlitePath: options.sqlitePath,
      blockRootPath: options.timelineBlockRootPath ?? `${options.sqlitePath}.timeline-blocks`,
      mode: options.timelineBlockMode,
      logDebug: options.logDebug,
    }),
    sessionUpdateStore: createSqliteSessionUpdateStore(options.sqlitePath),
  };
}
