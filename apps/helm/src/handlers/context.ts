import type { WebSocket } from "ws";
import type {
  ConversationPreparationStore,
  NotificationStore,
} from "@tiller/persistence";
import type { connectAcpConnection, createAcpRuntime, listAcpConnectionInventory, reconnectAcpConnection } from "@tiller/acp-runtime";
import type {
  AcpAgentProvider,
  AcpModelOption,
  AcpModelState,
  AgentMessage,
  AgentPlan,
  ApprovalPolicy,
  ApprovalPolicyRule,
  AgentPromptContent,
  AvailableCommand,
  FileDiffSummary,
  HelmSummary,
  PermissionRequest,
  ProjectSummary,
  PromptTraceEvent,
  SessionConfigOption,
  SessionConfigOptionValue,
  SessionLiveStateSnapshot,
  SessionReasoningEffort,
  SessionSummary,
  TrustedDeviceSummary,
  WorktreeSummary,
} from "@tiller/shared";
import type {
  SessionDiffBodyStore,
  SessionOutputBodyStore,
  SessionPlanStore,
  StoredSessionRuntimeDescriptor,
} from "../sessions/facade";
import type {
  SessionLegacyEvidenceStore,
  SessionTimelineStore,
  SessionUpdateStore,
} from "@tiller/persistence";
import type { LiveMessageBuffer } from "../runtime/live-message-buffer";
import type { SessionPromptQueueManager } from "../runtime/session/prompt-queue";
import type { SessionTimelineDispatcher } from "../runtime/session-timeline/dispatcher";
import type { SessionTimelineFlushScheduler } from "../runtime/session-timeline/flush-scheduler";
import type { SessionLiveStateStore } from "../runtime/session-timeline/live-state-store";
import type { SessionApprovalStateStore } from "../runtime/session/event/approval-store";
import type { SessionRuntimeEventState } from "../runtime/session/event/runtime-state";
import type { RuntimeMetrics } from "../logging/runtime-metrics";
import type { SessionTimelineWorkerRegistry } from "../runtime/session-timeline/worker-registry";
import type { TillerLogger } from "../logging/logger";
import type { SessionSubagentDetailService } from "../runtime/session/subagent-detail-service";
import type { UpdateService } from "../updates/service";
import type { GithubIssueClient } from "../integrations/issues/github/client";

export type SessionRecord = {
  summary: SessionSummary;
  agent: AcpAgentProvider;
  worktree: WorktreeSummary;
  runtime: Awaited<ReturnType<typeof createAcpRuntime>>;
};

export type PermissionRecord = { sessionId: string; request: PermissionRequest };
export type ApprovalRecord = PermissionRecord & {
  status?: "pending" | "resolving";
};

export type RuntimeDraftReason = "scope-change" | "tab-disconnect" | "ttl" | "shutdown" | "user" | "obsolete";

export type RuntimeDraftRecord = {
  draftId: string;
  deckClientId: string;
  scopeKey: string;
  logicalScopeKey: string;
  project: ProjectSummary;
  helm: HelmSummary;
  worktree: WorktreeSummary;
  agent: AcpAgentProvider;
  runtime: Awaited<ReturnType<typeof createAcpRuntime>>;
  attach: (sessionId: string) => void;
  modelState?: AcpModelState;
  configState: Extract<
    import("@tiller/acp-runtime").SessionRuntimeEvent,
    { type: "config-options" }
  >["state"];
  configOptions: SessionConfigOption[];
  availableCommands: AvailableCommand[];
};

export type RuntimeEventThrottleConfig = {
  assistantWindowMs?: number;
  assistantMaxChars?: number;
  commandOutputWindowMs?: number;
  commandOutputMaxChars?: number;
  toolCallWindowMs?: number;
  toolCallMaxChars?: number;
  setTimeoutFn?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
};

export type HelmHandlerContext = {
  configPath: string;
  socketId?: string;
  notify: (socket: WebSocket, method: string, params: unknown) => void;
  broadcastNotification: (method: string, params: unknown) => void;
  broadcastSessionTopic: (sessionId: string, method: string, params: unknown) => void;
  subscribeSessionTopic: (socketId: string, sessionId: string) => void;
  unsubscribeSessionTopic: (socketId: string, sessionId: string) => void;
  removeSocketSessionTopics: (socketId: string) => void;
  logInfo: (message: string) => void;
  logDebug: (message: string) => void;
  logWarn: (message: string) => void;
  logError: (message: string) => void;
  logger: TillerLogger;
  promptTrace?: {
    emit(event: PromptTraceEvent): void;
  };
  requestShutdown?: (reason: "rpc") => void;
  updateService?: UpdateService;
  /** Optional injection seam for Issue provider tests; production falls back to Helm env. */
  issueClient?: GithubIssueClient;
  isLocalConnection?: () => boolean;

  getHelms: () => HelmSummary[];
  setHelms: (items: HelmSummary[]) => void;
  loadAvailableHelms: () => HelmSummary[];
  getWorktrees: () => WorktreeSummary[];
  setWorktrees: (items: WorktreeSummary[]) => void;
  loadAvailableWorktrees: () => WorktreeSummary[];
  getAgents: () => AcpAgentProvider[];
  setAgents: (items: AcpAgentProvider[]) => void;
  loadAvailableAgents: () => AcpAgentProvider[];
  getProjects: () => ProjectSummary[];
  setProjects: (items: ProjectSummary[]) => void;
  loadAvailableProjectsWithSemanticSummaries: () => Promise<ProjectSummary[]>;
  readApprovalPolicy: () => ApprovalPolicy;
  saveApprovalPolicyRule: (rule: ApprovalPolicyRule) => void;

  trustedDeviceStore: any;
  authenticatedSockets: any;
  toTrustedDeviceSummary: (record: any) => TrustedDeviceSummary;

  sessions: Map<string, any>;
  approvalIndex: Map<string, ApprovalRecord>;
  permissionIndex: Map<string, PermissionRecord>;
  sessionStore: any;
  notificationStore: NotificationStore;
  conversationPreparationStore?: ConversationPreparationStore;
  sessionMessageStore: any;
  sessionArtifactStore: any;
  sessionLegacyEvidenceStore?: SessionLegacyEvidenceStore;
  sessionAttachmentStore: any;
  sessionDiffBodyStore?: SessionDiffBodyStore;
  sessionOutputBodyStore: SessionOutputBodyStore;
  sessionRuntimeStore: any;
  sessionPlanStore: SessionPlanStore;
  sessionTimelineStore: SessionTimelineStore;
  sessionTimelineWorkers?: SessionTimelineWorkerRegistry;
  sessionTimelineDispatcher?: SessionTimelineDispatcher;
  sessionTimelineFlushScheduler?: SessionTimelineFlushScheduler;
  sessionLiveStateStore?: SessionLiveStateStore;
  sessionApprovalStateStore?: SessionApprovalStateStore;
  sessionSubagentDetailService?: SessionSubagentDetailService;
  sessionRuntimeEventState?: SessionRuntimeEventState;
  runtimeMetrics?: RuntimeMetrics;
  sessionUpdateStore: SessionUpdateStore;
  liveMessageBuffer: LiveMessageBuffer;
  runtimeEventThrottleConfig?: RuntimeEventThrottleConfig;
  promptQueue: SessionPromptQueueManager;
  drainPromptQueue: (sessionId: string) => Promise<void>;

  createRuntime: typeof createAcpRuntime;
  connectAcpConnection: typeof connectAcpConnection;
  reconnectAcpConnection: typeof reconnectAcpConnection;
  listAcpConnectionInventory: typeof listAcpConnectionInventory;
  createRuntimeDraft: (params: {
    deckClientId: string;
    project: ProjectSummary;
    helm: HelmSummary;
    worktree: WorktreeSummary;
    agent: AcpAgentProvider;
    sessionConfig?: {
      agentMode?: string;
      model?: string;
      reasoningEffort?: SessionReasoningEffort;
    };
  }) => Promise<{
    ok: boolean;
    draftId?: string;
    deckClientId: string;
    scopeKey: string;
    logicalScopeKey: string;
    runtimeSessionId?: string;
    state?: {
      agentMode?: string;
      model?: string;
      reasoningEffort?: SessionReasoningEffort;
    };
    modelOptions?: AcpModelOption[];
    configOptions?: SessionConfigOption[];
    availableCommands?: AvailableCommand[];
    createdAt?: string;
    expiresAt?: string;
    reused?: boolean;
    message: string;
  }>;
  discardRuntimeDraft: (params: {
    deckClientId: string;
    draftId?: string;
    scopeKey?: string;
    reason: RuntimeDraftReason;
  }) => Promise<{
    ok: boolean;
    discarded: boolean;
    draftId?: string;
    cleanup?: unknown;
    message: string;
  }>;
  discardRuntimeDraftsForDeckClient: (
    deckClientId: string,
    reason: RuntimeDraftReason,
  ) => Promise<void>;
  scheduleDeckClientDraftDiscard: (deckClientId: string, delayMs?: number) => void;
  takeRuntimeDraft: (draftId: string) => RuntimeDraftRecord | undefined;
  configureRuntimeDraft: (params: {
    draftId: string;
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
    configId?: string;
    value?: SessionConfigOptionValue;
  }) => Promise<{
    draftId: string;
    ok: boolean;
    state: {
      agentMode?: string;
      model?: string;
      reasoningEffort?: SessionReasoningEffort;
    };
    options: SessionConfigOption[];
    message: string;
  }>;
  testAcpConnection: (
    agent: AcpAgentProvider,
    cwd?: string,
  ) => Promise<{ ok: boolean; message: string }>;
  resolveHelmById: (id: string, helms: HelmSummary[]) => HelmSummary | undefined;
  resolveProjectById: (id: string, projects: ProjectSummary[]) => ProjectSummary | undefined;
  resolveProviderById: (id: string, agents: AcpAgentProvider[]) => AcpAgentProvider | undefined;

  startSessionResume: (sessionId: string) => Promise<{
    ok: boolean;
    resume: SessionSummary["resume"] extends infer R ? NonNullable<R> : never;
    session?: SessionSummary;
    message: string;
  }>;
  handleRuntimeEvent: (
    sessionId: string,
    event: import("@tiller/acp-runtime").SessionRuntimeEvent,
  ) => void;
  hydrateSessionSummary: (summary: SessionSummary) => SessionSummary;
  buildResumeInfo: (
    summary: SessionSummary,
    agent: AcpAgentProvider | undefined,
  ) => NonNullable<SessionSummary["resume"]>;
  persistRuntimeDescriptor: (
    summary: SessionSummary,
    agent: AcpAgentProvider | undefined,
    capabilities?: StoredSessionRuntimeDescriptor["capabilities"],
    pendingConfig?: StoredSessionRuntimeDescriptor["pendingConfig"] | null,
  ) => void;
  readSessionLiveState?: (sessionId: string) => SessionLiveStateSnapshot | undefined;
  updateSessionSummary: (
    sessionId: string,
    mutate: (summary: SessionSummary) => SessionSummary,
  ) => SessionSummary | undefined;
  persistSessionMessage: (sessionId: string, message: AgentMessage) => void;
  publishDiffUpdate: (sessionId: string, files: FileDiffSummary[]) => Promise<void>;
  hydrateDiffsFromWorktreeGit: (
    sessionId: string,
    files: FileDiffSummary[],
  ) => Promise<FileDiffSummary[]>;
  clearPermissionRequestsForSession: (sessionId: string) => void;
  deleteLocalSessionData: (sessionId: string) => void;
};
