import type { HelmHandlerContext } from "../../handlers/context";

type AnyFunction = (...args: any[]) => any;

export type HandlerSessionContext = Pick<
  HelmHandlerContext,
  | "sessions"
  | "approvalIndex"
  | "permissionIndex"
  | "sessionStore"
  | "sessionMessageStore"
  | "sessionArtifactStore"
  | "sessionLegacyEvidenceStore"
  | "sessionAttachmentStore"
  | "sessionDiffBodyStore"
  | "sessionOutputBodyStore"
  | "sessionRuntimeStore"
  | "sessionPlanStore"
  | "sessionTimelineStore"
  | "sessionTimelineWorkers"
  | "sessionTimelineDispatcher"
  | "sessionTimelineFlushScheduler"
  | "sessionLiveStateStore"
  | "sessionApprovalStateStore"
  | "sessionSubagentDetailService"
  | "sessionRuntimeEventState"
  | "sessionUpdateStore"
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
  | "buildResumeInfo"
  | "persistRuntimeDescriptor"
  | "readSessionLiveState"
  | "updateSessionSummary"
  | "persistSessionMessage"
  | "publishDiffUpdate"
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
  sessionLegacyEvidenceStore: unknown;
  sessionAttachmentStore: unknown;
  sessionDiffBodyStore?: unknown;
  sessionOutputBodyStore: unknown;
  sessionRuntimeStore: unknown;
  sessionPlanStore: unknown;
  sessionTimelineStore: unknown;
  sessionTimelineWorkers?: unknown;
  sessionTimelineDispatcher?: unknown;
  sessionTimelineFlushScheduler: unknown;
  sessionLiveStateStore?: unknown;
  sessionApprovalStateStore?: unknown;
  sessionSubagentDetailService?: unknown;
  sessionRuntimeEventState?: unknown;
  sessionUpdateStore: unknown;
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
  buildResumeInfo: AnyFunction;
  persistRuntimeDescriptor: AnyFunction;
  readSessionLiveState?: AnyFunction;
  updateSessionSummary: AnyFunction;
  persistSessionMessage: AnyFunction;
  publishDiffUpdate: AnyFunction;
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
        sessionLegacyEvidenceStore: options.sessionLegacyEvidenceStore,
        sessionAttachmentStore: options.sessionAttachmentStore,
        sessionDiffBodyStore: options.sessionDiffBodyStore,
        sessionOutputBodyStore: options.sessionOutputBodyStore,
        sessionRuntimeStore: options.sessionRuntimeStore,
        sessionPlanStore: options.sessionPlanStore,
        sessionTimelineStore: options.sessionTimelineStore,
        sessionTimelineWorkers: options.sessionTimelineWorkers,
        sessionTimelineDispatcher: options.sessionTimelineDispatcher,
        sessionTimelineFlushScheduler: options.sessionTimelineFlushScheduler,
        sessionLiveStateStore: options.sessionLiveStateStore,
        sessionApprovalStateStore: options.sessionApprovalStateStore,
        sessionSubagentDetailService: options.sessionSubagentDetailService,
        sessionRuntimeEventState: options.sessionRuntimeEventState,
        sessionUpdateStore: options.sessionUpdateStore,
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
        buildResumeInfo: options.buildResumeInfo,
        persistRuntimeDescriptor: options.persistRuntimeDescriptor,
        readSessionLiveState: options.readSessionLiveState,
        updateSessionSummary: options.updateSessionSummary,
        persistSessionMessage: options.persistSessionMessage,
        publishDiffUpdate: options.publishDiffUpdate,
        hydrateDiffsFromWorktreeGit: options.hydrateDiffsFromWorktreeGit,
        clearPermissionRequestsForSession: options.clearPermissionRequestsForSession,
        deleteLocalSessionData: options.deleteLocalSessionData,
      }) as HandlerSessionContext,
  };
}
