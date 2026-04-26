export type AgentTransport = "stdio";
export type AcpProviderKind = "native-acp" | "adapter-acp" | "custom";
export type SessionStatus = "starting" | "running" | "waiting_for_permission" | "idle" | "error" | "cancelled";

export type AgentCapabilities = {
  streaming?: boolean;
  permissionRequests?: boolean;
  fileDiffs?: boolean;
  commandOutput?: boolean;
  sessionResume?: boolean;
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

export type SessionSummary = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  agentId: string;
  agentName: string;
  status: SessionStatus;
  createdAt: string;
};

export type AgentMessage = {
  id: string;
  role: "assistant" | "system";
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
