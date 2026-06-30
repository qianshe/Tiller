import type {
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  SessionTimelineEntry,
} from "@tiller/shared";

export type ProjectedLegacySessionHistory = {
  messages: AgentMessage[];
  outputs: CommandChunk[];
  toolCalls: AgentToolCall[];
};

export function projectLegacySessionHistoryFromTimeline(
  entries: SessionTimelineEntry[],
): ProjectedLegacySessionHistory {
  const messages: AgentMessage[] = [];
  const outputs: CommandChunk[] = [];
  const toolCalls: AgentToolCall[] = [];

  for (const entry of entries) {
    if (entry.kind === "user_message" || entry.kind === "system_message") {
      messages.push(entry.message);
      continue;
    }
    if (entry.kind === "assistant_message") {
      const contentText = entry.chunks
        .filter((chunk): chunk is Extract<typeof chunk, { kind: "content" }> => chunk.kind === "content")
        .map((chunk) => chunk.text)
        .join("");
      if (contentText) {
        messages.push({
          id: entry.id,
          role: "assistant",
          text: contentText,
          timestamp: entry.timestamp,
          sequence: entry.sequence,
          streaming: entry.streaming,
        });
      }
      for (const chunk of entry.chunks) {
        if (chunk.kind !== "thinking") {
          continue;
        }
        toolCalls.push({
          id: chunk.id,
          commandId: entry.id,
          kind: "think",
          title: chunk.title,
          status: chunk.status,
          output: chunk.text,
          timestamp: chunk.timestamp,
          updatedAt: chunk.updatedAt,
          sequence: chunk.sequence,
        });
      }
      continue;
    }
    if (entry.kind !== "tool_call") {
      continue;
    }
    toolCalls.push(entry.toolCall);
    if (entry.toolCall.kind !== "shell" || !entry.toolCall.output) {
      continue;
    }
    const commandId = entry.toolCall.commandId ?? entry.toolCall.id;
    outputs.push({
      id: `timeline-output:${entry.toolCall.id}`,
      commandId,
      text: entry.toolCall.output,
      stream: entry.toolCall.stream ?? "stdout",
      timestamp: entry.toolCall.updatedAt,
      sequence: entry.toolCall.sequence,
    });
  }

  return { messages, outputs, toolCalls };
}
