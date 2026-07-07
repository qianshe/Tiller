import type { SessionTimelineEntry } from "./session-timeline";

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
  capabilities?: Partial<AgentCapabilities>;
};

/**
 * Explicit name for the provider projection needed to launch ACP runtimes.
 * Kept as an alias while config persistence and UI inventory still use AcpAgentProvider.
 */
export type AcpRuntimeProviderConfig = AcpAgentProvider;

export type WorktreeSummary = {
  name: string;
  path: string;
  branch?: string;
  kind?: "root" | "git-worktree";
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
  /** Project root path owned by project config. */
  path?: string;
  /** User-authored fallback summary for prompt enhancement context. */
  summary?: string;
  /** Project-relative document path used as the runtime summary source. */
  summaryFile?: string;
  /** Git worktrees discovered or created for this project. */
  worktrees?: WorktreeSummary[];
  /** Last Git branches discovered by Helm for this project root. */
  gitBranches?: string[];
  /** Current Git branch discovered by Helm for this project root. */
  gitCurrentBranch?: string;
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

export type AvailableCommandKind =
  | "command"
  | "skill"
  | "builtin"
  | "prompt"
  | "workflow"
  | "unknown";

export type AvailableCommand = {
  name: string;
  description?: string;
  input?: { hint?: string };
  kind?: AvailableCommandKind;
  rawKind?: string;
  source?: string;
  scope?: string;
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

  return { model: "none", reasoningEffort: "none" };
}

export type SessionSummaryCore = {
  id: string;
  projectId: string;
  projectName: string;
  helmId: string;
  /** Absolute cwd used by the ACP session. */
  cwd: string;
  /** Display label for the cwd's Git worktree. */
  worktreeName?: string;
  agentId: string;
  agentName: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  runtimeSessionId?: string;
  title?: string;
  lastMessagePreview?: string;
  resume?: SessionResumeInfo;
};

export type RuntimeSessionSummaryExtensions = {
  /** Provider-exposed ACP mode/agent, e.g. OpenCode's primary agents. */
  agentMode?: string;
  model?: string;
  modelOptions?: AcpModelOption[];
  /** Latest ACP session config options exposed by the active/restored runtime. */
  configOptions?: SessionConfigOption[];
  reasoningEffort?: SessionReasoningEffort;
  /** Whether the underlying ACP agent supports image content in prompts. */
  imageInput?: boolean;
  /** Last ACP slash commands reported for this session, persisted for later Deck sync. */
  availableCommands?: AvailableCommand[];
};

export type RuntimeSessionSummary = SessionSummaryCore & RuntimeSessionSummaryExtensions;

/**
 * Compatibility alias for the current Deck/Helm session summary payload.
 * New cross-package boundaries should prefer `SessionSummaryCore` or
 * `RuntimeSessionSummary` to make the chosen projection explicit.
 */
export type SessionSummary = RuntimeSessionSummary;

export type AgentMessage = {
  id: string;
  role: "assistant" | "system" | "user";
  text: string;
  timestamp: string;
  sequence?: number;
  attachments?: AgentPromptImageContent[];
  streaming?: boolean;
};

export type AgentPromptTextContent = {
  type: "text";
  text: string;
};

export type AgentPromptImageContent = {
  type: "image";
  data?: string;
  mimeType: string;
  uri?: string;
  name?: string;
  attachmentId?: string;
  sha256?: string;
  byteSize?: number;
};

export type AgentPromptContent = AgentPromptTextContent | AgentPromptImageContent;

export type SessionQueuedPromptStatus = "queued" | "sending" | "failed";

export type SessionQueuedPrompt = {
  id: string;
  sessionId: string;
  text: string;
  content?: AgentPromptContent[];
  clientMessageId: string;
  createdAt: string;
  updatedAt: string;
  status: SessionQueuedPromptStatus;
  error?: string;
};

export type SessionPromptQueueSnapshot = {
  sessionId: string;
  inFlight?: SessionQueuedPrompt;
  queued: SessionQueuedPrompt[];
};

export type PermissionDecision =
  | "allow"
  | "allow_session"
  | "allow_always"
  | "deny"
  | "deny_always";

export type PermissionRequestOption = {
  decision: PermissionDecision;
  label: string;
};

export type PermissionRequest = {
  id: string;
  command: string;
  reason: string;
  cwd: string;
  options?: PermissionRequestOption[];
};

export type ApprovalPolicyAction = "allow" | "deny" | "confirm";

export type ApprovalPolicyRule = {
  id: string;
  action: ApprovalPolicyAction;
  label: string;
  providerId?: string;
  projectId?: string;
  worktreePath?: string;
  commandPattern?: string;
  reasonPattern?: string;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalPolicy = {
  rules: ApprovalPolicyRule[];
};

export type CommandChunk = {
  id: string;
  commandId: string;
  text: string;
  stream: "stdout" | "stderr";
  timestamp: string;
  sequence?: number;
};

export type AgentToolCallStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "waiting_for_permission";

export type AgentToolCallKind =
  | "mcp"
  | "skill"
  | "read"
  | "write"
  | "search"
  | "shell"
  | "fetch"
  | "think"
  | "todo"
  | "subagent"
  | "tool"
  | "unknown";

export type AgentToolCallMcpSource =
  | "structured-input"
  | "structured-tool-name"
  | "qualified-title"
  | "provider-title";

export type AgentToolCallMcp = {
  serverName?: string;
  toolName: string;
  source: AgentToolCallMcpSource;
  rawTitle?: string;
};

export type AgentToolCall = {
  id: string;
  kind: AgentToolCallKind;
  title: string;
  status: AgentToolCallStatus;
  mcp?: AgentToolCallMcp;
  commandId?: string;
  input?: string;
  output?: string;
  stream?: "stdout" | "stderr";
  timestamp: string;
  updatedAt: string;
  sequence?: number;
};

export type AgentPlanEntryStatus = "pending" | "in_progress" | "completed";

export type AgentPlanEntryPriority = "high" | "medium" | "low";

export type AgentPlanEntry = {
  content: string;
  priority: AgentPlanEntryPriority;
  status: AgentPlanEntryStatus;
};

export type AgentPlan = {
  entries: AgentPlanEntry[];
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

export type SessionHistoryReimportResult = {
  sessionId: string;
  messages: AgentMessage[];
  timeline?: SessionTimelineEntry[];
  outputs: CommandChunk[];
  diffs: FileDiffSummary[];
  toolCalls: AgentToolCall[];
  plan?: AgentPlan;
  nextCursor?: string;
  hasMore: boolean;
  activityNextCursor?: string;
  activityHasMore: boolean;
  message: string;
};

export function isWildcardHost(host: string) {
  const normalized = host.trim().toLowerCase();
  return normalized === "0.0.0.0" || normalized === "::" || normalized === "[::]";
}

export const ACP_IMAGE_INPUT_UNSUPPORTED_CODE = "ACP_IMAGE_INPUT_UNSUPPORTED";
export const ACP_IMAGE_INPUT_UNSUPPORTED_MESSAGE = "当前 ACP Agent 未声明图片输入能力，无法发送图片喵~";
