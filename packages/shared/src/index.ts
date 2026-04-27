export type AgentTransport = "stdio";
export type AcpProviderKind = "native-acp" | "adapter-acp" | "custom";
export type SessionStatus = "starting" | "running" | "waiting_for_permission" | "idle" | "error" | "cancelled";
export type RuntimeResumeMode = "none" | "same-process" | "reconnect";
export type SessionResumeState = "history-only" | "resume-available" | "resume-unavailable";

export type SessionCleanupResult = {
  sessionId: string;
  localDeleted: boolean;
  remoteDeleted: boolean;
  remoteDeletionAttempted: boolean;
  providerId?: string;
  message: string;
};

export type AgentCapabilities = {
  streaming?: boolean;
  permissionRequests?: boolean;
  fileDiffs?: boolean;
  commandOutput?: boolean;
  sessionConfig?: Partial<SessionConfigSupport>;
  /** ACP session/load support: restores context and replays history via session/update. */
  sessionLoad?: boolean;
  /** ACP session/resume support: restores context without replaying old messages. */
  sessionResume?: boolean;
  /** ACP session/list support: discovers agent-side sessions. */
  sessionList?: boolean;
  /** @deprecated Use sessionLoad/sessionResume/sessionList. */
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

export type HelmSummary = {
  id: string;
  name: string;
  host: string;
  port: number;
};

export type ProjectSummary = {
  id: string;
  name: string;
  helmId: string;
  workspaceIds?: string[];
  allowedAgentIds?: string[];
  defaultWorkspaceId?: string;
  defaultAgentId?: string;
};

export type SessionRestoreMethod = "client-reconnect" | "session/load" | "session/resume" | "ui-history";

export type SessionResumeInfo = {
  mode: RuntimeResumeMode;
  state: SessionResumeState;
  reason: string;
  checkedAt: string;
  providerId?: string;
  runtimeSessionId?: string;
  restoreMethod?: SessionRestoreMethod;
  lastSeenAt?: string;
};

export type SessionReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type SessionConfigApplyMode = "none" | "startup" | "runtime";
export type SessionConfigModelFormat = "model" | "provider/model";

export type SessionConfigSupport = {
  model: SessionConfigApplyMode;
  reasoningEffort: SessionConfigApplyMode;
  modelFormat?: SessionConfigModelFormat;
};

export function resolveSessionConfigSupport(provider?: Pick<AcpAgentProvider, "command" | "capabilities"> | null): SessionConfigSupport {
  const declared = provider?.capabilities?.sessionConfig;
  if (declared?.model || declared?.reasoningEffort || declared?.modelFormat) {
    return {
      model: declared.model ?? "none",
      reasoningEffort: declared.reasoningEffort ?? "none",
      modelFormat: declared.modelFormat,
    };
  }

  if (provider?.command === "codex-acp") {
    return { model: "startup", reasoningEffort: "startup", modelFormat: "model" };
  }

  if (provider?.command === "opencode") {
    return { model: "startup", reasoningEffort: "none", modelFormat: "provider/model" };
  }

  return { model: "none", reasoningEffort: "none" };
}

export type SessionSummary = {
  id: string;
  projectId: string;
  projectName: string;
  helmId: string;
  workspaceId: string;
  workspaceName: string;
  agentId: string;
  agentName: string;
  model?: string;
  reasoningEffort?: SessionReasoningEffort;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  runtimeSessionId?: string;
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
