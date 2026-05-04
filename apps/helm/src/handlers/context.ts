import type { WebSocket } from "ws";
import type { createAcpRuntime } from "@tiller/acp-runtime";
import type { ClientToHelm, HelmToClient } from "@tiller/sync-protocol";
import type {
  AcpAgentProvider,
  AcpModelState,
  AgentMessage,
  FileDiffSummary,
  HelmSummary,
  PermissionRequest,
  ProjectSummary,
  SessionReasoningEffort,
  SessionSummary,
  TrustedDeviceSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import type { StoredSessionRuntimeDescriptor } from "../sessions/runtime-store";

export type SessionRecord = {
  summary: SessionSummary;
  agent: AcpAgentProvider;
  workspace: WorkspaceSummary;
  runtime: Awaited<ReturnType<typeof createAcpRuntime>>;
};

export type PermissionRecord = { sessionId: string; request: PermissionRequest };

export type ModelOptionsProbeResult = {
  ok: boolean;
  message: string;
  currentModelId?: string;
  modelOptions: AcpModelState["options"];
  configOptions: Extract<
    import("@tiller/acp-runtime").SessionRuntimeEvent,
    { type: "config-options" }
  >["options"];
  state: Extract<
    import("@tiller/acp-runtime").SessionRuntimeEvent,
    { type: "config-options" }
  >["state"];
};

export type HelmHandlerContext = {
  configPath: string;
  emit: (socket: WebSocket, payload: HelmToClient) => void;
  broadcastAuthenticated: (payload: HelmToClient) => void;
  logInfo: (message: string) => void;
  logDebug: (message: string) => void;
  logWarn: (message: string) => void;
  logError: (message: string) => void;

  getHelms: () => HelmSummary[];
  setHelms: (items: HelmSummary[]) => void;
  loadAvailableHelms: () => HelmSummary[];
  getWorkspaces: () => WorkspaceSummary[];
  setWorkspaces: (items: WorkspaceSummary[]) => void;
  loadAvailableWorkspaces: () => WorkspaceSummary[];
  getAgents: () => AcpAgentProvider[];
  setAgents: (items: AcpAgentProvider[]) => void;
  loadAvailableAgents: () => AcpAgentProvider[];
  getProjects: () => ProjectSummary[];
  setProjects: (items: ProjectSummary[]) => void;
  loadAvailableProjectsWithSemanticSummaries: () => Promise<ProjectSummary[]>;

  trustedDeviceStore: any;
  authenticatedSockets: any;
  toTrustedDeviceSummary: (record: any) => TrustedDeviceSummary;

  sessions: Map<string, any>;
  permissionIndex: Map<string, PermissionRecord>;
  sessionStore: any;
  sessionMessageStore: any;
  sessionArtifactStore: any;
  sessionRuntimeStore: any;

  createRuntime: typeof createAcpRuntime;
  testAcpConnection: (
    agent: AcpAgentProvider,
    cwd?: string,
  ) => Promise<{ ok: boolean; message: string }>;
  resolveHelmById: (id: string, helms: HelmSummary[]) => HelmSummary | undefined;
  resolveProjectById: (id: string, projects: ProjectSummary[]) => ProjectSummary | undefined;
  resolveProviderById: (id: string, agents: AcpAgentProvider[]) => AcpAgentProvider | undefined;

  probeAgentModelOptions: (
    agent: AcpAgentProvider,
    workspace: WorkspaceSummary,
  ) => Promise<ModelOptionsProbeResult>;
  startSessionResume: (
    sessionId: string,
  ) => Promise<{
    ok: boolean;
    resume: SessionSummary["resume"] extends infer R ? NonNullable<R> : never;
    message: string;
  }>;
  handleRuntimeEvent: (
    sessionId: string,
    event: import("@tiller/acp-runtime").SessionRuntimeEvent,
  ) => void;
  hydrateSessionSummary: (summary: SessionSummary) => SessionSummary;
  migrateStoredSessionSummary: (summary: SessionSummary) => SessionSummary;
  buildResumeInfo: (
    summary: SessionSummary,
    agent: AcpAgentProvider | undefined,
  ) => NonNullable<SessionSummary["resume"]>;
  persistRuntimeDescriptor: (
    summary: SessionSummary,
    agent: AcpAgentProvider | undefined,
    capabilities?: StoredSessionRuntimeDescriptor["capabilities"],
  ) => void;
  refreshAuthoritativeSessionHistory: (sessionId: string) => Promise<void>;
  updateSessionSummary: (
    sessionId: string,
    mutate: (summary: SessionSummary) => SessionSummary,
  ) => SessionSummary | undefined;
  persistSessionMessage: (sessionId: string, message: AgentMessage) => void;
  publishDiffUpdate: (sessionId: string, files: FileDiffSummary[]) => Promise<void>;
  hydrateDiffsFromWorkspaceGit: (
    sessionId: string,
    files: FileDiffSummary[],
  ) => Promise<FileDiffSummary[]>;
  clearPermissionRequestsForSession: (sessionId: string) => void;
  deleteLocalSessionData: (sessionId: string) => void;
};

export type HelmMessageHandler = (
  socket: WebSocket,
  payload: ClientToHelm,
  context: HelmHandlerContext,
) => boolean | Promise<boolean>;
