import type {
  AcpAgentProvider,
  AcpAgentSessionInfo,
  AcpModelState,
  AgentMessage,
  AgentPromptContent,
  AgentToolCall,
  AvailableCommand,
  CommandChunk,
  FileDiffSummary,
  PermissionRequest,
  SessionReasoningEffort,
  SessionStatus,
  WorkspaceSummary,
} from "@tiller/shared";

export type ProviderCleanupResult =
  | { kind: "unsupported"; providerId: string; message: string }
  | { kind: "remote-deleted"; providerId: string; message: string }
  | { kind: "remote-delete-failed"; providerId: string; message: string }
  | { kind: "remote-closed"; providerId: string; message: string }
  | { kind: "remote-close-failed"; providerId: string; message: string };

export type SessionRuntimeEvent =
  | {
      type: "status";
      status: SessionStatus;
      message?: string;
    }
  | {
      type: "message";
      message: AgentMessage;
    }
  | {
      type: "permission-request";
      request: PermissionRequest;
    }
  | {
      type: "tool-call";
      toolCall: AgentToolCall;
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
      type: "error";
      message: string;
      code?: string;
    };

export type AcpSessionRestoreStrategy = "load" | "resume";

export type AcpRuntimeOptions = {
  sessionId: string;
  workspace: WorkspaceSummary;
  agent: AcpAgentProvider;
  sessionConfig?: {
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  };
  restore?: {
    runtimeSessionId: string;
    strategy: AcpSessionRestoreStrategy;
  };
  onEvent: (event: SessionRuntimeEvent) => void;
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
