import type { AgentToolCall, SessionSummary } from "@tiller/shared";

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
