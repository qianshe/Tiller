import type { HelmHandlerContext } from "../handlers/context";

type AnyFunction = (...args: any[]) => any;

export type HandlerSessionContext = Pick<
  HelmHandlerContext,
  | "sessions"
  | "approvalIndex"
  | "permissionIndex"
  | "sessionStore"
  | "sessionMessageStore"
  | "sessionArtifactStore"
  | "sessionAttachmentStore"
  | "sessionRuntimeStore"
  | "sessionTimelineStore"
  | "liveMessageBuffer"
  | "promptQueue"
  | "drainPromptQueue"
  | "createRuntime"
  | "connectAcpConnection"
  | "reconnectAcpConnection"
  | "listAcpConnectionInventory"
  | "createRuntimeDraft"
  | "discardRuntimeDraft"
  | "discardRuntimeDraftsForDeckClient"
  | "scheduleDeckClientDraftDiscard"
  | "takeRuntimeDraft"
  | "configureRuntimeDraft"
  | "testAcpConnection"
  | "resolveHelmById"
  | "resolveProjectById"
  | "resolveProviderById"
  | "startSessionResume"
  | "handleRuntimeEvent"
  | "hydrateSessionSummary"
  | "migrateStoredSessionSummary"
  | "buildResumeInfo"
  | "persistRuntimeDescriptor"
  | "refreshAuthoritativeSessionHistory"
  | "updateSessionSummary"
  | "persistSessionMessage"
  | "publishDiffUpdate"
  | "reimportSessionHistory"
  | "hydrateDiffsFromWorktreeGit"
  | "clearPermissionRequestsForSession"
  | "deleteLocalSessionData"
>;

export type HandlerSessionContextFactoryOptions<TContext = HelmHandlerContext> = {
  sessions: HelmHandlerContext["sessions"];
  permissionIndex: HelmHandlerContext["permissionIndex"];
  sessionStore: unknown;
  sessionMessageStore: unknown;
  sessionArtifactStore: unknown;
  sessionAttachmentStore: unknown;
  sessionRuntimeStore: unknown;
  sessionTimelineStore: unknown;
  liveMessageBuffer: unknown;
  promptQueue: unknown;
  createHandlerContext: (socketId?: string) => TContext;
  drainPromptQueue: (sessionId: string, context: TContext) => Promise<void>;
  createRuntime: AnyFunction;
  connectAcpConnection: AnyFunction;
  reconnectAcpConnection: AnyFunction;
  listAcpConnectionInventory: AnyFunction;
  createRuntimeDraft: AnyFunction;
  discardRuntimeDraft: AnyFunction;
  discardRuntimeDraftsForDeckClient: AnyFunction;
  scheduleDeckClientDraftDiscard: AnyFunction;
  takeRuntimeDraft: AnyFunction;
  configureRuntimeDraft: AnyFunction;
  testAcpConnection: AnyFunction;
  resolveHelmById: AnyFunction;
  resolveProjectById: AnyFunction;
  resolveProviderById: AnyFunction;
  startSessionResume: AnyFunction;
  handleRuntimeEvent: AnyFunction;
  hydrateSessionSummary: AnyFunction;
  migrateStoredSessionSummary: AnyFunction;
  buildResumeInfo: AnyFunction;
  persistRuntimeDescriptor: AnyFunction;
  refreshAuthoritativeSessionHistory: AnyFunction;
  updateSessionSummary: AnyFunction;
  persistSessionMessage: AnyFunction;
  publishDiffUpdate: AnyFunction;
  reimportSessionHistory: AnyFunction;
  hydrateDiffsFromWorktreeGit: AnyFunction;
  clearPermissionRequestsForSession: AnyFunction;
  deleteLocalSessionData: AnyFunction;
};

export type HandlerSessionContextFactory = {
  forSocket: (socketId?: string) => HandlerSessionContext;
};

export function createHandlerSessionContextFactory<TContext = HelmHandlerContext>(
  options: HandlerSessionContextFactoryOptions<TContext>,
): HandlerSessionContextFactory {
  return {
    forSocket: (socketId) =>
      ({
        sessions: options.sessions,
        approvalIndex: options.permissionIndex,
        permissionIndex: options.permissionIndex,
        sessionStore: options.sessionStore,
        sessionMessageStore: options.sessionMessageStore,
        sessionArtifactStore: options.sessionArtifactStore,
        sessionAttachmentStore: options.sessionAttachmentStore,
        sessionRuntimeStore: options.sessionRuntimeStore,
        sessionTimelineStore: options.sessionTimelineStore,
        liveMessageBuffer: options.liveMessageBuffer,
        promptQueue: options.promptQueue,
        drainPromptQueue: (sessionId: string) =>
          options.drainPromptQueue(sessionId, options.createHandlerContext(socketId)),
        createRuntime: options.createRuntime,
        connectAcpConnection: options.connectAcpConnection,
        reconnectAcpConnection: options.reconnectAcpConnection,
        listAcpConnectionInventory: options.listAcpConnectionInventory,
        createRuntimeDraft: options.createRuntimeDraft,
        discardRuntimeDraft: options.discardRuntimeDraft,
        discardRuntimeDraftsForDeckClient: options.discardRuntimeDraftsForDeckClient,
        scheduleDeckClientDraftDiscard: options.scheduleDeckClientDraftDiscard,
        takeRuntimeDraft: options.takeRuntimeDraft,
        configureRuntimeDraft: options.configureRuntimeDraft,
        testAcpConnection: options.testAcpConnection,
        resolveHelmById: options.resolveHelmById,
        resolveProjectById: options.resolveProjectById,
        resolveProviderById: options.resolveProviderById,
        startSessionResume: options.startSessionResume,
        handleRuntimeEvent: options.handleRuntimeEvent,
        hydrateSessionSummary: options.hydrateSessionSummary,
        migrateStoredSessionSummary: options.migrateStoredSessionSummary,
        buildResumeInfo: options.buildResumeInfo,
        persistRuntimeDescriptor: options.persistRuntimeDescriptor,
        refreshAuthoritativeSessionHistory: options.refreshAuthoritativeSessionHistory,
        updateSessionSummary: options.updateSessionSummary,
        persistSessionMessage: options.persistSessionMessage,
        publishDiffUpdate: options.publishDiffUpdate,
        reimportSessionHistory: options.reimportSessionHistory,
        hydrateDiffsFromWorktreeGit: options.hydrateDiffsFromWorktreeGit,
        clearPermissionRequestsForSession: options.clearPermissionRequestsForSession,
        deleteLocalSessionData: options.deleteLocalSessionData,
      }) as HandlerSessionContext,
  };
}
