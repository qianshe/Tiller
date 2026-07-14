import type {
  AgentToolCall,
  CommandChunk,
  SessionTimelineEntry,
} from "@tiller/shared";

type HistoricalTimelineActivity = {
  outputs: CommandChunk[];
  toolCalls: AgentToolCall[];
};

export function deriveHistoricalActivityFromTimeline(
  timeline: SessionTimelineEntry[] | undefined,
): HistoricalTimelineActivity {
  if (!timeline?.length) {
    return {
      outputs: [],
      toolCalls: [],
    };
  }

  const outputs: CommandChunk[] = [];
  const toolCalls: AgentToolCall[] = [];

  for (const entry of timeline) {
    if (entry.kind === "tool_call") {
      toolCalls.push(entry.toolCall);
      continue;
    }
    if (entry.kind === "command_output") {
      outputs.push(entry.output);
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

  return { outputs, toolCalls };
}

export function deriveToolCallsFromTimeline(
  timeline: SessionTimelineEntry[] | undefined,
): AgentToolCall[] {
  return deriveHistoricalActivityFromTimeline(timeline).toolCalls;
}

export function mergeHistoricalAndLiveToolCalls(
  historical: AgentToolCall[],
  live: AgentToolCall[],
): AgentToolCall[] {
  return mergeActivityById(historical, live);
}

export function mergeHistoricalAndLiveOutputs(
  historical: CommandChunk[],
  live: CommandChunk[],
): CommandChunk[] {
  return mergeActivityById(historical, live);
}

function mergeActivityById<T extends { id: string }>(
  historical: T[],
  live: T[],
): T[] {
  if (historical.length === 0) {
    return [...live];
  }
  if (live.length === 0) {
    return [...historical];
  }

  const merged = [...historical];
  const positions = new Map(merged.map((item, index) => [item.id, index]));

  for (const item of live) {
    const index = positions.get(item.id);
    if (index === undefined) {
      positions.set(item.id, merged.length);
      merged.push(item);
      continue;
    }
    merged[index] = item;
  }

  return merged;
}
