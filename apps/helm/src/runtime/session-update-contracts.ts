import type {
  AcpModelOption,
  AgentMessage,
  AgentToolCall,
  AvailableCommand,
  CommandChunk,
  FileDiffSummary,
  SessionConfigOption,
  SessionPromptQueueSnapshot,
  SessionStatus,
  SessionSummary,
} from "@tiller/shared";

export type SessionStatusUpdate = {
  kind: "status_change";
  status: SessionStatus;
  message?: string;
};

export type SessionUserMessageUpdate = {
  kind: "user_message";
  message: AgentMessage;
};

export type SessionAgentMessageUpdate = {
  kind: "agent_message";
  message: AgentMessage;
  streaming: boolean;
};

export type SessionToolCallUpdate = {
  kind: "tool_call";
  toolCall: AgentToolCall;
};

export type SessionCommandOutputUpdate = {
  kind: "command_output";
  commandId: string;
  chunk: CommandChunk;
};

export type SessionDiffUpdate = {
  kind: "diff_update";
  files: FileDiffSummary[];
};

export type SessionConfigOptionsUpdate = {
  kind: "config_options";
  state: {
    agentMode?: string;
    model?: string;
    reasoningEffort?: string;
  };
  options: SessionConfigOption[];
};

export type SessionModelOptionsUpdate = {
  kind: "model_options";
  currentModelId?: string;
  options: AcpModelOption[];
};

export type SessionCommandsAvailableUpdate = {
  kind: "commands_available";
  commands: AvailableCommand[];
};

export type SessionUpdatedUpdate = {
  kind: "session_updated";
  session: SessionSummary;
};

export type SessionPromptQueueUpdate = {
  kind: "prompt_queue";
  queue: SessionPromptQueueSnapshot;
};

export type SessionRealtimeUpdate =
  | SessionStatusUpdate
  | SessionUserMessageUpdate
  | SessionAgentMessageUpdate
  | SessionToolCallUpdate
  | SessionCommandOutputUpdate
  | SessionDiffUpdate
  | SessionConfigOptionsUpdate
  | SessionModelOptionsUpdate
  | SessionCommandsAvailableUpdate
  | SessionUpdatedUpdate
  | SessionPromptQueueUpdate;
