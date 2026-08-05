import {
  resolveMergedAgentToolCallKind,
  type AgentMessage,
  type AgentToolCall,
  type CommandChunk,
} from "@tiller/shared";

import { coalesceDisplayMessages } from "./message-history";
import {
  resolveDisplayToolTitle,
  resolveDisplayToolKind,
  resolveMergedToolTitle,
} from "./tool-title";

export function sortAgentMessagesByTimeline(items: AgentMessage[]) {
  return items
    .map((message, index) => ({ message, index }))
    .sort(compareMessageTimelineEntries)
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
  subagentRole?: AgentToolCall["subagentRole"];
  subagentOperation?: AgentToolCall["subagentOperation"];
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
    const displayKind = resolveDisplayToolKind(call);
    const displayCall = displayKind === call.kind
      ? call
      : { ...call, kind: displayKind };
    const key = call.commandId ?? call.id;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        kind: "tool",
        id: call.id,
        commandId: call.commandId ?? call.id,
        title: resolveDisplayToolTitle(displayCall, key),
        status: call.status,
        toolKind: displayKind,
        subagentRole: call.subagentRole,
        subagentOperation: call.subagentOperation,
        timestamp: call.timestamp,
        sequence: call.sequence,
        text: call.output ?? "",
        input: call.input ?? "",
        streams: call.stream ? [call.stream] : [],
      });
      continue;
    }

    current.text = `${current.text}${call.output ?? ""}`;
    current.input = current.toolKind === "subagent" || displayKind === "subagent"
      ? mergeSubagentInputs(current.input, call.input)
      : current.input || call.input || "";
    current.sequence = firstTimelineSequence(current.sequence, call.sequence);
    current.status = call.status;
    current.subagentRole = call.subagentRole ?? current.subagentRole;
    current.subagentOperation = call.subagentOperation ?? current.subagentOperation;
    if (displayKind === current.toolKind) {
      current.title = resolveMergedToolTitle(
        current.title,
        resolveDisplayToolTitle(displayCall, key),
        call.id,
        current.toolKind === "subagent" || displayKind === "subagent",
        current.input,
        call.input,
      );
    }
    if (call.stream && !current.streams.includes(call.stream)) {
      current.streams.push(call.stream);
    }
  }
  return Array.from(groups.values());
}

function mergeSubagentInputs(current: string, incoming: string | undefined) {
  if (!incoming) {
    return current;
  }
  if (!current) {
    return incoming;
  }
  const currentRecord = parseRecord(current);
  const incomingRecord = parseRecord(incoming);
  if (!currentRecord || !incomingRecord) {
    return current;
  }
  return JSON.stringify(mergeRecords(currentRecord, incomingRecord));
}

function mergeRecords(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    const currentValue = merged[key];
    if (isRecord(currentValue) && isRecord(value)) {
      merged[key] = mergeRecords(currentValue, value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
      kind: resolveMergedAgentToolCallKind(existing, next),
      title: resolveMergedToolTitle(
        existing.title,
        next.title,
        next.id,
        existing.kind === "subagent" || next.kind === "subagent",
        existing.input,
        next.input,
      ),
      output: mergeToolCallHistoryOutput(existing, next),
      input: next.input ?? existing.input,
      timestamp: existing.timestamp,
      sequence: firstTimelineSequence(existing.sequence, next.sequence),
      updatedAt: next.updatedAt,
      status: next.status,
    };
  }
  return merged
    .map((toolCall, index) => ({ toolCall, index }))
    .sort(compareToolCallTimelineEntries)
    .map((entry) => entry.toolCall);
}

function mergeToolCallHistoryOutput(
  current: AgentToolCall,
  incoming: AgentToolCall,
) {
  if (current.status === "completed" && incoming.status === "completed" && incoming.output) {
    return incoming.output;
  }
  return mergeToolCallOutput(current.output, incoming.output);
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

function firstTimelineSequence(current: number | undefined, incoming: number | undefined) {
  if (current === undefined) {
    return incoming;
  }
  if (incoming === undefined) {
    return current;
  }
  return current;
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
  return left.index - right.index;
}

function compareMessageTimelineEntries(left: MessageTimelineEntry, right: MessageTimelineEntry) {
  const timelineDelta = compareOptionalTimelineSequence(
    left.message.sequence,
    right.message.sequence,
  );
  return timelineDelta ?? left.index - right.index;
}

function compareTimelineItems(left: ConversationTimelineItem, right: ConversationTimelineItem) {
  const timelineDelta = compareOptionalTimelineSequence(
    left.sequence,
    right.sequence,
  );
  if (timelineDelta !== null) {
    return timelineDelta;
  }
  return (left.sourceIndex ?? 0) - (right.sourceIndex ?? 0);
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

export {
  coalesceDisplayMessages,
  mergeAgentMessages,
  mergeMessageHistory,
  normalizeSystemMessageText,
  type MergeMessageHistoryOptions,
} from "./message-history";
