export type PromptTracePhase =
  | "deck.prompt.submit"
  | "helm.prompt.ack"
  | "helm.prompt.queued"
  | "helm.prompt.send_start"
  | "helm.prompt.runtime_accepted"
  | "helm.runtime.first_status"
  | "helm.runtime.first_message"
  | "helm.runtime.first_tool_call"
  | "helm.runtime.first_command_output"
  | "helm.session_update.broadcast"
  | "deck.session_update.received"
  | "deck.session_update.applied";

export type PromptTraceEvent = {
  traceId: string;
  sessionId: string;
  phase: PromptTracePhase;
  timestamp: string;
  source: "deck" | "helm";
  meta?: Record<string, string | number | boolean | null>;
};
