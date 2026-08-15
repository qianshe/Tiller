import {
  createSqliteSessionArtifactStore,
  createSqliteSessionLegacyEvidenceStore,
  createSqliteSessionAttachmentStore,
  createSqliteSessionDiffBodyStore,
  createSqliteSessionMessageStore,
  createSqliteNotificationStore,
  createSqliteSessionOutputBodyStore,
  createSqliteSessionPlanStore,
  createSqliteSessionRuntimeStore,
  createSqliteSessionStore,
  createSqliteSessionStateStore,
  createSqliteSessionApprovalStore,
  createSqliteSessionUpdateStore,
  createSqliteSessionSubagentDetailStore,
  createSqliteConversationPreparationStore,
  migrateJsonSessionDataToSqlite,
  type HelmSessionStores,
  type JsonSessionStorePaths,
  type SessionArtifactStore,
  type SessionLegacyEvidenceStore,
  type SessionAttachmentStore,
  type SessionDiffBodyStore,
  type SessionMessageStore,
  type SessionOutputBodyStore,
  type SessionPlanStore,
  type SessionRuntimeStore,
  type SessionStateStore,
  type SessionApprovalStore,
  type SessionSummaryStore,
  type SessionTimelineStore,
  type SessionUpdateStore,
  type StoredSessionArtifacts,
  type ConversationPreparationStore,
  type NotificationStore,
} from "@tiller/persistence";
import { createModeAwareSessionTimelineStore } from "./timeline-store-mode";

export type {
  HelmSessionStores,
  SessionArtifactStore,
  SessionLegacyEvidenceStore,
  SessionAttachmentStore,
  SessionDiffBodyStore,
  SessionMessageStore,
  SessionOutputBodyStore,
  SessionPlanStore,
  SessionRuntimeStore,
  SessionStateStore,
  SessionApprovalStore,
  SessionSummaryStore,
  SessionTimelineStore,
  SessionUpdateStore,
  StoredSessionArtifacts,
  ConversationPreparationStore,
  NotificationStore,
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
    notificationStore: createSqliteNotificationStore(options.sqlitePath),
    sessionStore: createSqliteSessionStore(options.sqlitePath),
    sessionMessageStore: createSqliteSessionMessageStore(options.sqlitePath),
    sessionArtifactStore: createSqliteSessionArtifactStore(options.sqlitePath),
    sessionLegacyEvidenceStore: createSqliteSessionLegacyEvidenceStore(options.sqlitePath),
    sessionAttachmentStore: createSqliteSessionAttachmentStore({
      dbPath: options.sqlitePath,
      rootPath: options.attachmentRootPath,
    }),
    sessionDiffBodyStore: createSqliteSessionDiffBodyStore({
      dbPath: options.sqlitePath,
      rootPath: `${options.outputBodyRootPath}.diffs`,
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
    sessionStateStore: createSqliteSessionStateStore(options.sqlitePath),
    sessionApprovalStore: createSqliteSessionApprovalStore(options.sqlitePath),
    sessionSubagentDetailStore: createSqliteSessionSubagentDetailStore(options.sqlitePath),
    conversationPreparationStore: createSqliteConversationPreparationStore(options.sqlitePath),
  };
}
