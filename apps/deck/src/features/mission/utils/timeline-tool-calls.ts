import type { AgentToolCall, SessionTimelineEntry } from "@tiller/shared";

export function deriveToolCallsFromTimeline(
  timeline: SessionTimelineEntry[] | undefined,
): AgentToolCall[] {
  if (!timeline?.length) {
    return [];
  }

  const toolCalls: AgentToolCall[] = [];
  for (const entry of timeline) {
    if (entry.kind === "tool_call") {
      toolCalls.push(entry.toolCall);
      continue;
    }
    if (entry.kind !== "assistant_message") {
      continue;
    }
    for (const chunk of entry.chunks) {
      if (chunk.kind !== "thinking") {
        continue;
      }
      toolCalls.push({
        id: chunk.id,
        commandId: chunk.id,
        kind: "think",
        title: chunk.title,
        status: chunk.status,
        output: chunk.text,
        timestamp: chunk.timestamp,
        updatedAt: chunk.updatedAt,
        sequence: chunk.sequence,
      });
    }
  }

  return toolCalls;
}
