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

export type AcpAgentSessionInfo = {
  sessionId: string;
  cwd?: string;
  title?: string;
  updatedAt?: string;
  meta?: unknown;
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
  /** ACP session/close support: closes a live agent session and releases runtime resources. */
  sessionClose?: boolean;
  /** ACP session/delete support: removes an agent-side session from history/list storage. */
  sessionDelete?: boolean;
  /** @deprecated Use sessionLoad/sessionResume/sessionList/sessionClose/sessionDelete. */
  resumeMode?: RuntimeResumeMode;
  cancellation?: boolean;
  imageInput?: boolean;
};

export type AcpMcpServer = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type AcpAgentProvider = {
  id: string;
  name: string;
  description?: string;
  kind?: AcpProviderKind;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  mcpServers?: AcpMcpServer[];
  cwd?: string;
  initializeTimeoutMs?: number;
  promptTimeoutMs?: number;
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
  /** Helm-generated lightweight summary for prompt enhancement context. */
  summary?: string;
};

export type HelmModelConfig = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
};

export type HelmSummary = {
  id: string;
  name: string;
  host: string;
  port: number;
  /** Helm-level model endpoint used by backend-owned capabilities such as summaries. */
  modelConfig?: HelmModelConfig;
};

export type ProjectFileSummary = {
  path: string;
  kind: "file" | "directory";
};

export function sortProjectFileSummaries(left: ProjectFileSummary, right: ProjectFileSummary) {
  const leftParts = left.path.split("/");
  const rightParts = right.path.split("/");
  const maxDepth = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxDepth; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === rightPart) {
      continue;
    }
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }

    const leftSegmentIsDirectory = index < leftParts.length - 1 || left.kind === "directory";
    const rightSegmentIsDirectory = index < rightParts.length - 1 || right.kind === "directory";
    if (leftSegmentIsDirectory !== rightSegmentIsDirectory) {
      return leftSegmentIsDirectory ? -1 : 1;
    }

    const compare = leftPart.localeCompare(rightPart, undefined, { numeric: true, sensitivity: "base" });
    if (compare !== 0) {
      return compare;
    }
  }

  return left.kind === right.kind ? 0 : left.kind === "directory" ? -1 : 1;
}

export type ProjectSummary = {
  id: string;
  name: string;
  helmId: string;
  /** Project root path owned by project config; Helm may expose it as a runtime workspace without writing workspaces config. */
  path?: string;
  /** Helm-generated lightweight summary for prompt enhancement context. */
  summary?: string;
  workspaceIds?: string[];
  /** Last Git branches discovered by Helm for this project root. */
  gitBranches?: string[];
  /** Current Git branch discovered by Helm for this project root. */
  gitCurrentBranch?: string;
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
export type TrustedClientKind = "web" | "app";

export type TrustedDeviceAuthPayload = {
  deviceId: string;
  deviceName?: string;
  clientKind?: TrustedClientKind;
};

export type TrustedDeviceResult = {
  trustedUntil?: string;
  requiresPairing?: boolean;
};

export type TrustedDeviceSummary = {
  deviceId: string;
  deviceName: string;
  clientKind: TrustedClientKind;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};
export type SessionConfigApplyMode = "none" | "startup" | "runtime";
export type SessionConfigModelFormat = "model" | "provider/model";

export type SessionConfigOptionValue = string | boolean;

export type SessionConfigOption = {
  id: string;
  name?: string;
  category?: string;
  currentValue?: SessionConfigOptionValue;
  selectedValue?: SessionConfigOptionValue;
  value?: SessionConfigOptionValue;
  options?: Array<{ value: SessionConfigOptionValue; label?: string; name?: string }>;
};

export type AcpModelOption = {
  id: string;
  name: string;
  description?: string;
};

export type AcpModelState = {
  currentModelId?: string;
  options: AcpModelOption[];
};

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
  /** Provider-exposed ACP mode/agent, e.g. OpenCode's primary agents. */
  agentMode?: string;
  model?: string;
  modelOptions?: AcpModelOption[];
  reasoningEffort?: SessionReasoningEffort;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  runtimeSessionId?: string;
  title?: string;
  lastMessagePreview?: string;
  resume?: SessionResumeInfo;
};

export type AgentMessage = {
  id: string;
  role: "assistant" | "system" | "user";
  text: string;
  timestamp: string;
  attachments?: AgentPromptImageContent[];
};

export type AgentPromptTextContent = {
  type: "text";
  text: string;
};

export type AgentPromptImageContent = {
  type: "image";
  data: string;
  mimeType: string;
  uri?: string;
  name?: string;
};

export type AgentPromptContent = AgentPromptTextContent | AgentPromptImageContent;

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

export type AgentToolCallStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "waiting_for_permission";

export type AgentToolCall = {
  id: string;
  kind: "terminal" | "edit" | "subagent" | "tool" | "unknown";
  title: string;
  status: AgentToolCallStatus;
  commandId?: string;
  input?: string;
  output?: string;
  stream?: "stdout" | "stderr";
  timestamp: string;
  updatedAt: string;
};

export type FileDiffSummary = {
  path: string;
  status: "modified" | "added" | "deleted";
  additions: number;
  deletions: number;
  /** Unified patch/hunk text when the ACP provider includes file-level diff content. */
  patch?: string;
};

