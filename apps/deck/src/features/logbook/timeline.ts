import type { AgentMessage, AgentToolCall, CommandChunk } from "@tiller/shared";

import { coalesceDisplayMessages } from "./message-history";
import { resolveDisplayToolTitle, resolveMergedToolTitle } from "./tool-title";

export function sortAgentMessagesByTimeline(items: AgentMessage[]) {
  return items
    .map((message, index) => ({ message, index }))
    .sort((left, right) => {
      const timestampDelta =
        Date.parse(left.message.timestamp) -
        Date.parse(right.message.timestamp);
      return timestampDelta === 0 ? left.index - right.index : timestampDelta;
    })
    .map((entry) => entry.message);
}

export type ConversationTimelineItem =
  | { kind: "message"; timestamp: string; timelineSequence?: number; message: AgentMessage }
  | ConversationToolCallItem;

export type ConversationToolCallItem = {
  kind: "tool";
  id: string;
  commandId: string;
  title: string;
  status: AgentToolCall["status"];
  toolKind: AgentToolCall["kind"];
  timestamp: string;
  timelineSequence?: number;
  text: string;
  input: string;
  streams: Array<"stdout" | "stderr">;
};

export function buildConversationTimeline(
  messages: AgentMessage[],
  commandChunks: CommandChunk[],
  toolCalls: AgentToolCall[],
): ConversationTimelineItem[] {
  const sourceToolCalls = toolCalls.length
    ? toolCalls
    : commandChunks.map(commandChunkToToolCall);
  const toolItems = groupToolCalls(sourceToolCalls);
  const messageItems: ConversationTimelineItem[] = coalesceDisplayMessages(
    messages,
    toolItems.map((item) => item.timestamp),
  ).map((message) => ({
    kind: "message",
    timestamp: message.timestamp,
    timelineSequence: message.timelineSequence,
    message,
  }));
  return [...messageItems, ...toolItems].sort(compareTimelineItems);
}

export function resolvePendingToolActivity(calls: AgentToolCall[]) {
  const pending = calls
    .filter(
      (call) =>
        call.status === "pending" ||
        call.status === "running" ||
        call.status === "waiting_for_permission",
    )
    .sort(
      (left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt),
    )
    .at(-1);
  if (!pending) {
    return null;
  }

  return {
    title: resolveDisplayToolTitle(pending, pending.commandId ?? pending.id),
    status: pending.status,
  };
}

export function groupToolCalls(
  calls: AgentToolCall[],
): ConversationToolCallItem[] {
  const groups = new Map<string, ConversationToolCallItem>();
  for (const call of calls) {
    const key = call.commandId ?? call.id;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        kind: "tool",
        id: call.id,
        commandId: key,
        title: resolveDisplayToolTitle(call, key),
        status: call.status,
        toolKind: call.kind,
        timestamp: call.timestamp,
        timelineSequence: call.timelineSequence,
        text: call.output ?? "",
        input: call.input ?? "",
        streams: call.stream ? [call.stream] : [],
      });
      continue;
    }

    current.text = `${current.text}${call.output ?? ""}`;
    current.input = current.input || call.input || "";
    if (Date.parse(call.timestamp) < Date.parse(current.timestamp)) {
      current.timestamp = call.timestamp;
    }
    current.timelineSequence = minTimelineSequence(current.timelineSequence, call.timelineSequence);
    current.status = call.status;
    current.toolKind = call.kind === "unknown" ? current.toolKind : call.kind;
    current.title = resolveMergedToolTitle(
      current.title,
      resolveDisplayToolTitle(call, key),
      call.id,
    );
    if (call.stream && !current.streams.includes(call.stream)) {
      current.streams.push(call.stream);
    }
  }
  return Array.from(groups.values());
}

export function commandChunkToToolCall(chunk: CommandChunk): AgentToolCall {
  return {
    id: `tool-${chunk.commandId}`,
    kind: "shell",
    title: chunk.commandId,
    status: chunk.stream === "stderr" ? "failed" : "running",
    commandId: chunk.commandId,
    output: chunk.text,
    stream: chunk.stream,
    timestamp: chunk.timestamp,
    updatedAt: chunk.timestamp,
    timelineSequence: chunk.timelineSequence,
  };
}

export function mergeToolCallHistory(
  current: AgentToolCall[],
  incoming: AgentToolCall[],
) {
  const merged = [...current];
  for (const next of incoming) {
    const index = merged.findIndex((item) => item.id === next.id);
    if (index === -1) {
      merged.push(next);
      continue;
    }

    const existing = merged[index];
    if (!existing) {
      merged.push(next);
      continue;
    }
    merged[index] = {
      ...existing,
      ...next,
      kind: resolveToolCallKind(existing.kind, next.kind),
      title: resolveMergedToolTitle(existing.title, next.title, next.id),
      output: mergeToolCallOutput(existing.output, next.output),
      input: next.input ?? existing.input,
      timestamp:
        Date.parse(next.timestamp) < Date.parse(existing.timestamp)
          ? next.timestamp
          : existing.timestamp,
      timelineSequence: existing.timelineSequence ?? next.timelineSequence,
      updatedAt: next.updatedAt,
      status: next.status,
    };
  }
  return merged.sort(
    (left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt),
  );
}

function resolveToolCallKind(
  currentKind: AgentToolCall["kind"],
  incomingKind: AgentToolCall["kind"],
) {
  return isHigherConfidenceToolKind(incomingKind, currentKind) ? incomingKind : currentKind;
}

function mergeToolCallOutput(
  currentOutput: string | undefined,
  incomingOutput: string | undefined,
) {
  if (!incomingOutput) {
    return currentOutput;
  }
  if (!currentOutput || incomingOutput.startsWith(currentOutput)) {
    return incomingOutput;
  }
  if (currentOutput.startsWith(incomingOutput) || currentOutput.endsWith(incomingOutput)) {
    return currentOutput;
  }
  return `${currentOutput}${incomingOutput}`;
}

function isHigherConfidenceToolKind(
  incomingKind: AgentToolCall["kind"],
  currentKind: AgentToolCall["kind"],
) {
  const rank: Record<AgentToolCall["kind"], number> = {
    unknown: 0,
    tool: 1,
    think: 2,
    todo: 2,
    fetch: 2,
    search: 3,
    read: 3,
    write: 3,
    shell: 3,
    skill: 3,
    subagent: 3,
    mcp: 4,
  };
  return rank[incomingKind] > rank[currentKind];
}

function minTimelineSequence(current: number | undefined, incoming: number | undefined) {
  if (current === undefined) {
    return incoming;
  }
  if (incoming === undefined) {
    return current;
  }
  return Math.min(current, incoming);
}

function compareTimelineItems(left: ConversationTimelineItem, right: ConversationTimelineItem) {
  if (left.timelineSequence !== undefined && right.timelineSequence !== undefined) {
    const sequenceDelta = left.timelineSequence - right.timelineSequence;
    if (sequenceDelta !== 0) {
      return sequenceDelta;
    }
  }
  const timestampDelta = Date.parse(left.timestamp) - Date.parse(right.timestamp);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return timelineKindRank(left) - timelineKindRank(right);
}

function timelineKindRank(item: ConversationTimelineItem) {
  if (item.kind === "message") {
    return 2;
  }
  return item.toolKind === "think" ? 0 : 1;
}

export {
  coalesceDisplayMessages,
  mergeAgentMessages,
  mergeMessageHistory,
  type MergeMessageHistoryOptions,
} from "./message-history";
