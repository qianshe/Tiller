import type {
  AgentMessage,
  AgentToolCall,
  SessionSummary,
  SessionTimelineEntry,
} from "@tiller/shared";

/**
 * Measures the total streamed character volume of a session so callers can
 * detect in-place content growth (streaming text / growing tool output) that
 * leaves entry counts unchanged.
 */
export function resolveSessionStreamContentLength(sources: {
  messages?: AgentMessage[];
  timeline?: SessionTimelineEntry[];
  toolCalls?: AgentToolCall[];
}): number {
  let length = 0;
  for (const message of sources.messages ?? []) {
    length += message.text?.length ?? 0;
  }
  for (const entry of sources.timeline ?? []) {
    if (entry.kind === "assistant_message") {
      for (const chunk of entry.chunks) {
        length += chunk.text?.length ?? 0;
      }
    } else if (entry.kind === "tool_call") {
      length += (entry.toolCall.output?.length ?? 0) + (entry.toolCall.input?.length ?? 0);
    } else {
      length += entry.message.text?.length ?? 0;
    }
  }
  for (const toolCall of sources.toolCalls ?? []) {
    length += (toolCall.output?.length ?? 0) + (toolCall.input?.length ?? 0);
  }
  return length;
}

export function splitMissionToolCalls(toolCalls: AgentToolCall[]) {
  return {
    thinkingToolCalls: toolCalls.filter((toolCall) => toolCall.kind === "think"),
    timelineToolCalls: toolCalls.filter((toolCall) => toolCall.kind !== "think"),
    boundaryTimestamps: toolCalls.map((toolCall) => toolCall.timestamp),
  };
}

export function resolveSessionStatusTone(status: SessionSummary["status"]): "active" | "idle" | "warning" | "danger" | "primary" {
  switch (status) {
    case "running":
      return "primary";
    case "waiting_for_permission":
      return "warning";
    case "error":
      return "danger";
    default:
      return "idle";
  }
}

export function formatSessionPreviewTime(value: string | undefined) {
  if (!value) {
    return "--:--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
