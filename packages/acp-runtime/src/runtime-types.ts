import type {
  AcpAgentProvider,
  AcpAgentSessionInfo,
  AcpModelState,
  AgentPlan,
  AgentMessage,
  AgentPromptContent,
  AgentToolCall,
  AvailableCommand,
  CommandChunk,
  FileDiffSummary,
  PermissionDecision,
  PermissionRequest,
  SessionCompactionPhase,
  SessionCompactionSource,
  SessionReasoningEffort,
  SessionStatus,
  WorktreeSummary,
} from "@tiller/shared";
import type { AcpConnectionLifecycleEvent } from "./connection/manager";
import type { AcpProtocolLoggingOptions } from "./protocol-logging";

export type ProviderCleanupResult =
  | { kind: "unsupported"; providerId: string; message: string }
  | { kind: "remote-deleted"; providerId: string; message: string }
  | { kind: "remote-delete-failed"; providerId: string; message: string }
  | { kind: "remote-closed"; providerId: string; message: string }
  | { kind: "remote-close-failed"; providerId: string; message: string };

export type RuntimeEventOrigin = {
  scope: "subagent";
  parentToolCallId: string;
};

export type SessionRuntimeEvent =
  | {
      type: "status";
      status: SessionStatus;
      message?: string;
    }
  | {
      type: "message";
      message: AgentMessage;
      origin?: RuntimeEventOrigin;
    }
  | {
      type: "compaction";
      phase: SessionCompactionPhase;
      source: SessionCompactionSource;
      timestamp: string;
      summaryText?: string;
      messageId?: string;
    }
  | {
      type: "permission-request";
      request: PermissionRequest;
    }
  | {
      type: "permission-response";
      requestId: string;
      decision: PermissionDecision;
    }
  | {
      type: "tool-call";
      toolCall: AgentToolCall;
      origin?: RuntimeEventOrigin;
    }
  | {
      type: "plan-update";
      plan: AgentPlan;
    }
  | {
      type: "command-output";
      chunk: CommandChunk;
      toolCall?: AgentToolCall;
    }
  | {
      type: "diff-update";
      files: FileDiffSummary[];
    }
  | {
      type: "config-options";
      state: AcpSessionConfigState;
      options: AcpSessionConfigOption[];
    }
  | {
      type: "model-options";
      state: AcpModelState;
    }
  | {
      type: "available-commands";
      commands: AvailableCommand[];
    }
  | {
      type: "mode-update";
      agentMode: string;
    }
  | {
      type: "session-info";
      title?: string | null;
      updatedAt?: string | null;
    }
  | {
      type: "usage-update";
      usage: {
        used: number;
        size: number;
        cost?: { amount: number; currency: string } | null;
      };
    }
  | {
      type: "error";
      message: string;
      code?: string;
    };

export type MappedSessionRuntimeEvents = {
  sessionId: string;
  events: readonly SessionRuntimeEvent[];
};

export type AcpSessionRestoreStrategy = "load" | "resume";

export type AcpRuntimeOptions = {
  sessionId: string;
  worktree: WorktreeSummary;
  agent: AcpAgentProvider;
  sessionConfig?: {
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  };
  restore?: {
    runtimeSessionId: string;
    strategy: AcpSessionRestoreStrategy;
    replayBaselineMessages?: AgentMessage[];
  };
  onEvent: (event: SessionRuntimeEvent) => void;
  onRestoreReplayEvent?: (event: SessionRuntimeEvent) => void;
  onConnectionLifecycleEvent?: (event: AcpConnectionLifecycleEvent) => void;
  protocolLogging?: AcpProtocolLoggingOptions;
};

export type AcpAgentSessionListResult = {
  sessions: AcpAgentSessionInfo[];
  nextCursor?: string;
  meta?: unknown;
};

export type AcpSessionConfigOptionValue = string | boolean;

export type AcpSessionConfigOption = {
  id: string;
  name?: string;
  category?: string;
  currentValue?: AcpSessionConfigOptionValue;
  selectedValue?: AcpSessionConfigOptionValue;
  value?: AcpSessionConfigOptionValue;
  options?: Array<{ value: AcpSessionConfigOptionValue; label?: string; name?: string }>;
};

export type AcpSessionConfigState = {
  agentMode?: string;
  model?: string;
  reasoningEffort?: SessionReasoningEffort;
};

export type AcpRuntimePrompt = (text: string, content?: AgentPromptContent[]) => void;
