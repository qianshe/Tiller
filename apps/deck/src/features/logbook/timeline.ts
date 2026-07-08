import type { AgentMessage, AgentToolCall, CommandChunk } from "@tiller/shared";

import { coalesceDisplayMessages } from "./message-history";
import {
  resolveDisplayToolKind,
  resolveDisplayToolTitle,
  resolveMergedToolTitle,
} from "./tool-title";

export function sortAgentMessagesByTimeline(items: AgentMessage[]) {
  return items
    .map((message, index) => ({ message, index }))
    .sort((left, right) => compareMessageTimelineEntries(left, right))
    .map((entry) => entry.message);
}

type MessageTimelineEntry = {
  index: number;
  message: AgentMessage;
};

export type ConversationTimelineItem =
  | { kind: "message"; sourceIndex?: number; timestamp: string; sequence?: number; message: AgentMessage }
  | ConversationToolCallItem;

export type ConversationToolCallItem = {
  kind: "tool";
  id: string;
  sourceIndex?: number;
  commandId: string;
  title: string;
  status: AgentToolCall["status"];
  toolKind: AgentToolCall["kind"];
  timestamp: string;
  sequence?: number;
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
  ).map((message, index) => ({
    kind: "message",
    sourceIndex: index,
    timestamp: message.timestamp,
    sequence: message.sequence,
    message,
  }));
  const indexedToolItems = toolItems.map((item, index) => ({
    ...item,
    sourceIndex: messageItems.length + index,
  }));
  return [...messageItems, ...indexedToolItems].sort(compareTimelineItems);
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
        toolKind: resolveDisplayToolKind(call),
        timestamp: call.timestamp,
        sequence: call.sequence,
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
    current.sequence = minTimelineSequence(current.sequence, call.sequence);
    current.status = call.status;
    current.toolKind = mergeGroupedToolKind(
      current.toolKind,
      resolveDisplayToolKind(call),
    );
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
    sequence: chunk.sequence,
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
      kind: resolveToolCallKind(existing, next),
      title: resolveMergedToolTitle(existing.title, next.title, next.id),
      output: mergeToolCallHistoryOutput(existing, next),
      input: next.input ?? existing.input,
      timestamp:
        Date.parse(next.timestamp) < Date.parse(existing.timestamp)
          ? next.timestamp
          : existing.timestamp,
      sequence: minTimelineSequence(existing.sequence, next.sequence),
      updatedAt: next.updatedAt,
      status: next.status,
    };
  }
  return merged
    .map((toolCall, index) => ({ toolCall, index }))
    .sort(compareToolCallTimelineEntries)
    .map((entry) => entry.toolCall);
}

export function dropActiveThinkingToolCalls(toolCalls: AgentToolCall[]) {
  return toolCalls.filter((toolCall) => !isActiveThinkingToolCall(toolCall));
}

export function isActiveThinkingToolCall(toolCall: AgentToolCall) {
  return (
    toolCall.kind === "think" &&
    (toolCall.status === "pending" || toolCall.status === "running")
  );
}

function resolveToolCallKind(
  current: AgentToolCall,
  incoming: AgentToolCall,
) {
  if (shouldPreferSearchRepair(current, incoming)) {
    return incoming.kind;
  }
  return isHigherConfidenceToolKind(incoming.kind, current.kind) ? incoming.kind : current.kind;
}

function mergeToolCallHistoryOutput(
  current: AgentToolCall,
  incoming: AgentToolCall,
) {
  if (current.status === "completed" && incoming.status === "completed" && incoming.output) {
    return incoming.output;
  }
  if (current.kind === "think" || incoming.kind === "think") {
    return mergeThinkingToolCallOutput(current.output, incoming.output);
  }
  return mergeToolCallOutput(current.output, incoming.output);
}

function mergeThinkingToolCallOutput(
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

  const overlapped = mergeTextByLineOverlap(currentOutput, incomingOutput);
  if (overlapped) {
    return overlapped;
  }

  return incomingOutput.length >= currentOutput.length
    ? incomingOutput
    : currentOutput;
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

function mergeTextByLineOverlap(currentText: string, incomingText: string) {
  const currentLines = currentText.split(/\r?\n/u);
  const incomingLines = incomingText.split(/\r?\n/u);
  const overlapLineCount = Math.min(currentLines.length, incomingLines.length);
  for (let size = overlapLineCount; size >= 1; size -= 1) {
    const currentSlice = currentLines.slice(-size).join("\n");
    const incomingSlice = incomingLines.slice(0, size).join("\n");
    if (currentSlice !== incomingSlice) {
      continue;
    }
    const suffix = incomingLines.slice(size).join("\n");
    return suffix ? `${currentText}\n${suffix}` : currentText;
  }
  return null;
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

function shouldPreferSearchRepair(
  current: AgentToolCall,
  incoming: AgentToolCall,
) {
  return current.kind === "shell" &&
    incoming.kind === "search" &&
    Date.parse(incoming.updatedAt) >= Date.parse(current.updatedAt);
}

function mergeGroupedToolKind(
  currentKind: AgentToolCall["kind"],
  incomingKind: AgentToolCall["kind"],
) {
  if (incomingKind === "unknown") {
    return currentKind;
  }
  if (currentKind === "unknown" || currentKind === "shell" && incomingKind === "search") {
    return incomingKind;
  }
  return isHigherConfidenceToolKind(incomingKind, currentKind) ? incomingKind : currentKind;
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

type ToolCallTimelineEntry = {
  index: number;
  toolCall: AgentToolCall;
};

function compareToolCallTimelineEntries(
  left: ToolCallTimelineEntry,
  right: ToolCallTimelineEntry,
) {
  const timelineDelta = compareOptionalTimelineSequence(
    left.toolCall.sequence,
    right.toolCall.sequence,
  );
  if (timelineDelta !== null) {
    return timelineDelta;
  }
  const timestampDelta = compareIsoTimestamps(left.toolCall.timestamp, right.toolCall.timestamp);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  const updatedAtDelta = compareIsoTimestamps(left.toolCall.updatedAt, right.toolCall.updatedAt);
  return updatedAtDelta === 0 ? left.index - right.index : updatedAtDelta;
}

function compareIsoTimestamps(leftTimestamp: string, rightTimestamp: string) {
  const leftTime = Date.parse(leftTimestamp);
  const rightTime = Date.parse(rightTimestamp);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return 0;
  }
  return leftTime - rightTime;
}

function compareMessageTimelineEntries(left: MessageTimelineEntry, right: MessageTimelineEntry) {
  const timelineDelta = compareOptionalTimelineSequence(
    left.message.sequence,
    right.message.sequence,
  );
  if (timelineDelta !== null) {
    return timelineDelta;
  }
  const timestampDelta = Date.parse(left.message.timestamp) - Date.parse(right.message.timestamp);
  return timestampDelta === 0 ? left.index - right.index : timestampDelta;
}

function compareTimelineItems(left: ConversationTimelineItem, right: ConversationTimelineItem) {
  const timelineDelta = compareOptionalTimelineSequence(
    left.sequence,
    right.sequence,
  );
  if (timelineDelta !== null) {
    return timelineDelta;
  }
  const timestampDelta = Date.parse(left.timestamp) - Date.parse(right.timestamp);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return timelineKindRank(left) - timelineKindRank(right);
}

function compareOptionalTimelineSequence(
  left: number | undefined,
  right: number | undefined,
) {
  if (left === undefined || right === undefined) {
    return null;
  }
  const sequenceDelta = left - right;
  return sequenceDelta === 0 ? null : sequenceDelta;
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
  normalizeSystemMessageText,
  type MergeMessageHistoryOptions,
} from "./message-history";
