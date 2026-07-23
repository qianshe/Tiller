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

export type SessionAgentMessageUpdate<Message = unknown> = {
  kind: "agent_message";
  message: Message;
  streaming: boolean;
};

export type SessionToolCallUpdate<ToolCall = unknown> = {
  kind: "tool_call";
  toolCall: ToolCall;
};

export type SessionUpdatedUpdate<Summary = SessionSummary> = {
  kind: "session_updated";
  session: Summary;
};

export type SessionTimelineBatchUpdate<TimelineEntry = unknown> = {
  kind: "timeline_batch";
  batch: {
    replace: boolean;
    /** Per-connection, per-session send revision stamped by the outbound transport. */
    deliverySequence: number;
    lastSequence: number;
    entries: TimelineEntry[];
  };
};

export type SessionLiveStateUpdate<Snapshot = unknown> = {
  kind: "live_state";
  snapshot: Snapshot;
};

export type SessionSubagentDetailUpdate<Delta = unknown> = {
  kind: "subagent_detail";
  delta: Delta;
};

export const CANONICAL_CONVERSATION_UPDATE_KINDS = ["timeline_batch"] as const;

export const COMPATIBILITY_CONVERSATION_UPDATE_KINDS = [
  "agent_message",
  "tool_call",
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
  Summary = SessionSummary,
  TimelineEntry = unknown,
  LiveStateSnapshot = unknown,
  SubagentDetailDelta = unknown,
> =
  | SessionAgentMessageUpdate<Message>
  | SessionToolCallUpdate<ToolCall>
  | SessionUpdatedUpdate<Summary>
  | SessionTimelineBatchUpdate<TimelineEntry>
  | SessionLiveStateUpdate<LiveStateSnapshot>
  | SessionSubagentDetailUpdate<SubagentDetailDelta>;
