export type AgentTransport = "stdio";
export type AcpProviderKind = "native-acp" | "adapter-acp" | "custom";
export type SessionStatus = "starting" | "running" | "waiting_for_permission" | "idle" | "error" | "cancelled";
export type RuntimeResumeMode = "none" | "same-process" | "reconnect";
export type SessionResumeState = "history-only" | "resume-available" | "resume-unavailable";

export type AgentCapabilities = {
  streaming?: boolean;
  permissionRequests?: boolean;
  fileDiffs?: boolean;
  commandOutput?: boolean;
  sessionResume?: boolean;
  resumeMode?: RuntimeResumeMode;
  cancellation?: boolean;
  imageInput?: boolean;
};

export type AcpAgentProvider = {
  id: string;
  name: string;
  description?: string;
  kind?: AcpProviderKind;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  initializeTimeoutMs?: number;
  defaultAgent?: string;
  transport: AgentTransport;
  protocol: "acp";
  installHint?: string;
  capabilities?: Partial<AgentCapabilities>;
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  path: string;
};

export type SessionResumeInfo = {
  mode: RuntimeResumeMode;
  state: SessionResumeState;
  reason: string;
  checkedAt: string;
  providerId?: string;
  runtimeSessionId?: string;
  lastSeenAt?: string;
};

export type SessionSummary = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  agentId: string;
  agentName: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview?: string;
  resume?: SessionResumeInfo;
};

export type AgentMessage = {
  id: string;
  role: "assistant" | "system" | "user";
  text: string;
  timestamp: string;
};

export type PermissionRequest = {
  id: string;
  command: string;
  reason: string;
  workspacePath: string;
};

export type PermissionDecision = "allow" | "deny";

export type CommandChunk = {
  id: string;
  commandId: string;
  text: string;
  stream: "stdout" | "stderr";
  timestamp: string;
};

export type FileDiffSummary = {
  path: string;
  status: "modified" | "added" | "deleted";
  additions: number;
  deletions: number;
};
