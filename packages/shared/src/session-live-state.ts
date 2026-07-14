import type {
  AcpModelOption,
  AgentPlan,
  AvailableCommand,
  FileDiffSummary,
  SessionConfigOption,
  SessionPromptQueueSnapshot,
  SessionReasoningEffort,
  SessionStatus,
} from "./types";

export type CanonicalSessionConfigState = {
  agentMode?: string;
  model?: string;
  reasoningEffort?: SessionReasoningEffort;
  configOptions: SessionConfigOption[];
  modelOptions: AcpModelOption[];
};

export type CanonicalSessionStatusState = {
  runtimeStatus: SessionStatus;
  effectiveStatus: SessionStatus;
  pendingApprovalCount: number;
};

export type CanonicalSessionUsage = {
  used: number;
  size: number;
  cost?: { amount: number; currency: string } | null;
};

export type CanonicalSessionInfoState = {
  title?: string | null;
  updatedAt?: string | null;
};

export type CanonicalSessionState = {
  sequence: number;
  status: CanonicalSessionStatusState;
  config: CanonicalSessionConfigState;
  plan?: AgentPlan;
  availableCommands: AvailableCommand[];
  usage?: CanonicalSessionUsage;
  sessionInfo: CanonicalSessionInfoState;
  diffs: FileDiffSummary[];
  promptQueue?: SessionPromptQueueSnapshot;
};

/**
 * Runtime notifications publish complete canonical state. Older persisted
 * views may still provide a partial snapshot while they are being displayed.
 */
export type SessionLiveStateSnapshot = Partial<CanonicalSessionState>;
