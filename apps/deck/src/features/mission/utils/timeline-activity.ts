import type {
  AgentToolCall,
  CommandChunk,
  SessionTimelineEntry,
} from "@tiller/shared";
import { resolveMergedAgentToolCallKind } from "@tiller/shared";

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
  const merged = [...historical];
  const positions = new Map(merged.map((toolCall, index) => [toolCall.id, index]));
  for (const toolCall of live) {
    const index = positions.get(toolCall.id);
    if (index === undefined) {
      positions.set(toolCall.id, merged.length);
      merged.push(toolCall);
      continue;
    }
    const historicalToolCall = merged[index]!;
    if (
      isTerminalToolCallStatus(historicalToolCall.status) &&
      !isTerminalToolCallStatus(toolCall.status)
    ) {
      continue;
    }
    merged[index] = mergeHistoricalAndLiveToolCall(historicalToolCall, toolCall);
  }
  return merged;
}

function mergeHistoricalAndLiveToolCall(
  historical: AgentToolCall,
  live: AgentToolCall,
): AgentToolCall {
  if (historical.kind !== "subagent" && live.kind !== "subagent") {
    return live;
  }
  return {
    ...historical,
    ...live,
    kind: resolveMergedAgentToolCallKind(historical, live),
    title: resolveSubagentTitle(historical.title, live.title),
    commandId: live.commandId ?? historical.commandId,
    input: live.input ?? historical.input,
    output: live.output ?? historical.output,
    timestamp: historical.timestamp,
    sequence: historical.sequence ?? live.sequence,
  };
}

function resolveSubagentTitle(historical: string, live: string) {
  return isWeakSubagentTitle(live) ? historical : live;
}

function isWeakSubagentTitle(title: string) {
  const normalized = title.trim();
  return !normalized || /^(?:task|subagent|tool|unknown)$/iu.test(normalized);
}

function isTerminalToolCallStatus(status: AgentToolCall["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
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
