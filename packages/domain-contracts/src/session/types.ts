export type SessionStatus = "starting" | "running" | "waiting_for_permission" | "idle" | "error" | "cancelled";

export type RuntimeResumeMode = "none" | "same-process" | "reconnect";

export type SessionResumeState = "history-only" | "resume-available" | "resume-unavailable";

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

export type SessionSummary = {
  id: string;
  projectId: string;
  projectName: string;
  helmId: string;
  cwd: string;
  worktreeName: string;
  agentId: string;
  agentName: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  title?: string;
  runtimeSessionId?: string;
  agentMode?: string;
  model?: string;
  resume?: SessionResumeInfo;
};

export type SessionStatusUpdate = {
  kind: "status_change";
  status: SessionStatus;
  message?: string;
};

export type SessionUserMessageUpdate<Message = unknown> = {
  kind: "user_message";
  message: Message;
};

export type SessionAgentMessageUpdate<Message = unknown> = {
  kind: "agent_message";
  message: Message;
  streaming: boolean;
};

export type SessionToolCallUpdate<ToolCall = unknown> = {
  kind: "tool_call";
  toolCall: ToolCall;
};

export type SessionPlanUpdate<Plan = unknown> = {
  kind: "plan_update";
  plan: Plan;
};

export type SessionCommandOutputUpdate<CommandOutput = unknown> = {
  kind: "command_output";
  commandId: string;
  chunk: CommandOutput;
};

export type SessionDiffUpdate<Diff = unknown> = {
  kind: "diff_update";
  files: Diff[];
};

export type SessionConfigOptionsUpdate<ConfigState = unknown, ConfigOption = unknown> = {
  kind: "config_options";
  state: ConfigState;
  options: ConfigOption[];
};

export type SessionModelOptionsUpdate<ModelOption = unknown> = {
  kind: "model_options";
  currentModelId?: string;
  options: ModelOption[];
};

export type SessionCommandsAvailableUpdate<Command = unknown> = {
  kind: "commands_available";
  commands: Command[];
};

export type SessionUpdatedUpdate<Summary = SessionSummary> = {
  kind: "session_updated";
  session: Summary;
};

export type SessionPromptQueueUpdate<Queue = unknown> = {
  kind: "prompt_queue";
  queue: Queue;
};

export type SessionTranscriptEventUpdate<Entry = unknown> = {
  kind: "transcript_event";
  entry: Entry;
};

export type SessionTimelineBatchUpdate<TimelineEntry = unknown> = {
  kind: "timeline_batch";
  batch: {
    replace: boolean;
    deliverySequence: number;
    lastSequence: number;
    entries: TimelineEntry[];
  };
};

export type SessionLiveStateUpdate<Snapshot = unknown> = {
  kind: "live_state";
  snapshot: Snapshot;
};

export const CANONICAL_CONVERSATION_UPDATE_KINDS = ["timeline_batch"] as const;

export const COMPATIBILITY_CONVERSATION_UPDATE_KINDS = [
  "user_message",
  "agent_message",
  "tool_call",
  "command_output",
  "transcript_event",
] as const;

export type CanonicalConversationUpdateKind =
  (typeof CANONICAL_CONVERSATION_UPDATE_KINDS)[number];

export type CompatibilityConversationUpdateKind =
  (typeof COMPATIBILITY_CONVERSATION_UPDATE_KINDS)[number];

export function isCanonicalConversationUpdateKind(
  kind: string,
): kind is CanonicalConversationUpdateKind {
  return CANONICAL_CONVERSATION_UPDATE_KINDS.includes(
    kind as CanonicalConversationUpdateKind,
  );
}

export function isCompatibilityConversationUpdateKind(
  kind: string,
): kind is CompatibilityConversationUpdateKind {
  return COMPATIBILITY_CONVERSATION_UPDATE_KINDS.includes(
    kind as CompatibilityConversationUpdateKind,
  );
}

export type SessionRealtimeUpdate<
  Message = unknown,
  ToolCall = unknown,
  CommandOutput = unknown,
  Diff = unknown,
  ConfigState = unknown,
  ConfigOption = unknown,
  ModelOption = unknown,
  Command = unknown,
  Summary = SessionSummary,
  Queue = unknown,
  Plan = unknown,
  TranscriptEvent = unknown,
  TimelineEntry = unknown,
  LiveStateSnapshot = unknown,
> =
  | SessionStatusUpdate
  | SessionUserMessageUpdate<Message>
  | SessionAgentMessageUpdate<Message>
  | SessionToolCallUpdate<ToolCall>
  | SessionPlanUpdate<Plan>
  | SessionCommandOutputUpdate<CommandOutput>
  | SessionDiffUpdate<Diff>
  | SessionConfigOptionsUpdate<ConfigState, ConfigOption>
  | SessionModelOptionsUpdate<ModelOption>
  | SessionCommandsAvailableUpdate<Command>
  | SessionUpdatedUpdate<Summary>
  | SessionPromptQueueUpdate<Queue>
  | SessionTranscriptEventUpdate<TranscriptEvent>
  | SessionTimelineBatchUpdate<TimelineEntry>
  | SessionLiveStateUpdate<LiveStateSnapshot>;
