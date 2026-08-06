import type { AgentMessage, AgentToolCall, CommandChunk } from "./types";
import type {
  SessionTimelineContextCompactionEntry,
  SessionTimelineHistoryGapEntry,
} from "./session-transcript";
import { isTranscriptEventEntry } from "./session-transcript";
import { isAssistantSnapshotContinuation, mergeStreamingText } from "./stream-text";
import { resolveMergedAgentToolCallKind } from "./utils/tool-call-classification";

export type SessionTimelineContentChunk = {
  id: string;
  kind: "content";
  text: string;
  timestamp: string;
  sequence?: number;
  streaming?: boolean;
  streamMode?: AgentMessage["streamMode"];
};

export type SessionTimelineThinkingChunk = {
  id: string;
  kind: "thinking";
  text: string;
  title: string;
  status: AgentToolCall["status"];
  streamMode?: AgentMessage["streamMode"];
  timestamp: string;
  updatedAt: string;
  sequence?: number;
};

export type SessionAssistantTimelineChunk =
  | SessionTimelineContentChunk
  | SessionTimelineThinkingChunk;

export type SessionTimelineMessageEntry = {
  id: string;
  kind: "user_message" | "system_message";
  message: AgentMessage;
  timestamp: string;
  updatedAt: string;
  sequence?: number;
};

export type SessionTimelineAssistantEntry = {
  id: string;
  kind: "assistant_message";
  chunks: SessionAssistantTimelineChunk[];
  timestamp: string;
  updatedAt: string;
  sequence?: number;
  streaming?: boolean;
};

export type SessionTimelineToolCallEntry = {
  id: string;
  kind: "tool_call";
  toolCall: AgentToolCall;
  timestamp: string;
  updatedAt: string;
  sequence?: number;
};

export type SessionTimelineOutputEntry = {
  id: string;
  kind: "command_output";
  commandId: string;
  output: CommandChunk;
  timestamp: string;
  updatedAt: string;
  sequence?: number;
};

export type SessionTimelineEntry =
  | SessionTimelineMessageEntry
  | SessionTimelineAssistantEntry
  | SessionTimelineToolCallEntry
  | SessionTimelineOutputEntry
  | SessionTimelineContextCompactionEntry
  | SessionTimelineHistoryGapEntry;

export type SessionTimelineBatch = {
  replace: boolean;
  /** Per-connection, per-session send revision stamped by the outbound transport. */
  deliverySequence: number;
  lastSequence: number;
  entries: SessionTimelineEntry[];
};

export type SessionTimelineStorePage = {
  entries: SessionTimelineEntry[];
  nextCursor?: string;
  hasMore: boolean;
};

export function appendMessageToSessionTimeline(
  entries: SessionTimelineEntry[],
  message: AgentMessage,
): SessionTimelineEntry[] {
  if (message.role === "assistant") {
    if (message.contentKind === "thought") {
      return upsertAssistantThinking(entries, message);
    }
    return upsertAssistantContent(entries, message);
  }
  return upsertMessageEntry(entries, message);
}

export function appendToolCallToSessionTimeline(
  entries: SessionTimelineEntry[],
  toolCall: AgentToolCall,
): SessionTimelineEntry[] {
  return upsertToolCallEntry(entries, toolCall);
}

export function resolveSessionTimelineToolCallEntryId(toolCall: AgentToolCall) {
  return `tool:${toolCall.kind === "subagent" && toolCall.commandId
    ? toolCall.commandId
    : toolCall.id}`;
}

export function sortSessionTimelineEntries(
  entries: SessionTimelineEntry[],
): SessionTimelineEntry[] {
  return splitSessionTimelineAssistantEntriesAtBoundaries(entries);
}

export function splitSessionTimelineAssistantEntriesAtBoundaries(
  entries: SessionTimelineEntry[],
): SessionTimelineEntry[] {
  const normalized = entries.map((entry) =>
    entry.kind === "assistant_message"
      ? { ...entry, chunks: sortAssistantTimelineChunks(entry.chunks) }
      : entry
  );
  return sortTimelineEntriesByDefinedSequence(
    splitAssistantEntriesAtTimelineBoundaries(normalized),
  );
}

export function sortAssistantTimelineChunks(
  chunks: SessionAssistantTimelineChunk[],
): SessionAssistantTimelineChunk[] {
  return sortItemsByCompleteSequence(chunks, (chunk) => chunk.sequence);
}

function upsertMessageEntry(
  entries: SessionTimelineEntry[],
  message: AgentMessage,
): SessionTimelineEntry[] {
  const kind = message.role === "system" ? "system_message" : "user_message";
  const existingIndex = entries.findIndex((entry) => entry.id === message.id && entry.kind === kind);
  const entry: SessionTimelineMessageEntry = {
    id: message.id,
    kind,
    message,
    timestamp: message.timestamp,
    updatedAt: message.timestamp,
    sequence: message.sequence,
  };
  if (existingIndex === -1) {
    entries.push(entry);
    return entries;
  }
  entries[existingIndex] = mergeMessageEntry(entries[existingIndex] as SessionTimelineMessageEntry, entry);
  return entries;
}

function upsertAssistantContent(
  entries: SessionTimelineEntry[],
  message: AgentMessage,
): SessionTimelineEntry[] {
  const chunkId = resolveAssistantChunkId({
    entries,
    assistantEntryId: message.id,
    baseChunkId: `${message.id}:content`,
    kind: "content",
    incomingText: message.text,
    sequence: message.sequence,
  });
  const entry = findOrCreateAssistantEntry(entries, message.id, message.timestamp, message.sequence);
  const chunk: SessionTimelineContentChunk = {
    id: chunkId,
    kind: "content",
    text: resolveContentChunkText(entry, `${message.id}:content`, chunkId, message.text),
    timestamp: message.timestamp,
    sequence: message.sequence,
    streaming: message.streaming,
    streamMode: message.streamMode,
  };
  entry.chunks = upsertAssistantChunk(entry.chunks, chunk);
  applyAssistantEntryBounds(entry);
  return entries;
}

function resolveContentChunkText(
  entry: SessionTimelineAssistantEntry,
  baseChunkId: string,
  chunkId: string,
  incomingText: string,
) {
  const updatesExistingChunk = entry.chunks.some((chunk) =>
    chunk.kind === "content" && chunk.id === chunkId
  );
  if (updatesExistingChunk) {
    return incomingText;
  }
  const previousText = entry.chunks
    .filter((chunk) => chunk.kind === "content" && isSameAssistantChunkIdentity(chunk.id, baseChunkId))
    .map((chunk) => chunk.text)
    .join("");
  if (!previousText || !incomingText.startsWith(previousText)) {
    return incomingText;
  }
  return incomingText.slice(previousText.length);
}

function resolveAssistantChunkId(input: {
  entries: SessionTimelineEntry[];
  assistantEntryId: string;
  baseChunkId: string;
  kind: SessionAssistantTimelineChunk["kind"];
  incomingText?: string;
  sequence?: number;
}) {
  const entry = input.entries.find((candidate): candidate is SessionTimelineAssistantEntry =>
    candidate.kind === "assistant_message" && candidate.id === input.assistantEntryId,
  );
  const matchingChunks = entry?.chunks.filter((chunk) =>
    chunk.kind === input.kind && isSameAssistantChunkIdentity(chunk.id, input.baseChunkId),
  ) ?? [];
  if (!matchingChunks.length) {
    return input.baseChunkId;
  }
  if (
    matchingChunks.length === 1 &&
    isAssistantSnapshotContinuation(matchingChunks[0]?.text, input.incomingText) &&
    hasOnlySubagentBoundariesBetween(
      input.entries,
      matchingChunks[0]?.sequence,
      input.sequence,
    )
  ) {
    return matchingChunks[0]?.id ?? input.baseChunkId;
  }
  const reusable = [...matchingChunks].reverse().find((chunk) =>
    !hasTimelineBoundaryBetween(input.entries, chunk.sequence, input.sequence),
  );
  if (reusable) {
    return reusable.id;
  }
  return `${input.baseChunkId}:${input.sequence ?? matchingChunks.length + 1}`;
}

function isSameAssistantChunkIdentity(chunkId: string, baseChunkId: string) {
  return chunkId === baseChunkId || chunkId.startsWith(`${baseChunkId}:`);
}

function hasTimelineBoundaryBetween(
  entries: SessionTimelineEntry[],
  leftSequence: number | undefined,
  rightSequence: number | undefined,
) {
  if (leftSequence === undefined || rightSequence === undefined) {
    return false;
  }
  const start = Math.min(leftSequence, rightSequence);
  const end = Math.max(leftSequence, rightSequence);
  return entries.some((entry) => {
    if (!isAssistantTimelineBoundaryEntry(entry)) {
      return false;
    }
    return typeof entry.sequence === "number" &&
      entry.sequence > start &&
      entry.sequence < end;
  });
}

function hasOnlySubagentBoundariesBetween(
  entries: SessionTimelineEntry[],
  leftSequence: number | undefined,
  rightSequence: number | undefined,
) {
  if (leftSequence === undefined || rightSequence === undefined) {
    return false;
  }
  const start = Math.min(leftSequence, rightSequence);
  const end = Math.max(leftSequence, rightSequence);
  let hasSubagentBoundary = false;
  for (const entry of entries) {
    if (
      !isAssistantTimelineBoundaryEntry(entry) ||
      typeof entry.sequence !== "number" ||
      entry.sequence <= start ||
      entry.sequence >= end
    ) {
      continue;
    }
    if (entry.kind !== "tool_call" || entry.toolCall.kind !== "subagent") {
      return false;
    }
    hasSubagentBoundary = true;
  }
  return hasSubagentBoundary;
}

function splitAssistantEntriesAtTimelineBoundaries(
  entries: SessionTimelineEntry[],
): SessionTimelineEntry[] {
  return entries.flatMap((entry) => {
    if (entry.kind !== "assistant_message" || entry.chunks.length < 2) {
      return [entry];
    }
    const groups: SessionAssistantTimelineChunk[][] = [];
    for (const chunk of entry.chunks) {
      const currentGroup = groups.at(-1);
      const previousChunk = currentGroup?.at(-1);
      if (
        currentGroup &&
        previousChunk &&
        hasTimelineEntryBoundaryBetweenChunks(entries, previousChunk, chunk)
      ) {
        groups.push([chunk]);
        continue;
      }
      if (currentGroup) {
        currentGroup.push(chunk);
        continue;
      }
      groups.push([chunk]);
    }
    if (groups.length < 2) {
      return [entry];
    }
    return groups.map((chunks, index) => {
      const segment: SessionTimelineAssistantEntry = {
        ...entry,
        id: resolveAssistantSegmentEntryId(entry.id, index),
        chunks,
      };
      applyAssistantEntryBounds(segment);
      return segment;
    });
  });
}

function hasTimelineEntryBoundaryBetweenChunks(
  entries: SessionTimelineEntry[],
  leftChunk: SessionAssistantTimelineChunk,
  rightChunk: SessionAssistantTimelineChunk,
) {
  return entries.some((entry) =>
    isAssistantTimelineBoundaryEntry(entry) &&
    isTimelineItemBetween(entry, leftChunk, rightChunk)
  );
}

function isAssistantTimelineBoundaryEntry(
  entry: SessionTimelineEntry,
): entry is Extract<
  SessionTimelineEntry,
  { kind: "user_message" | "system_message" | "tool_call" }
> {
  return entry.kind === "user_message" ||
    entry.kind === "system_message" ||
    entry.kind === "tool_call";
}

function isTimelineItemBetween(
  item: { sequence?: number; timestamp: string },
  left: { sequence?: number; timestamp: string },
  right: { sequence?: number; timestamp: string },
) {
  return typeof item.sequence === "number" &&
    typeof left.sequence === "number" &&
    typeof right.sequence === "number" &&
    item.sequence > left.sequence &&
    item.sequence < right.sequence;
}

function resolveAssistantSegmentEntryId(baseId: string, segmentIndex: number) {
  return segmentIndex === 0 ? baseId : `${baseId}#p${segmentIndex}`;
}

function sortTimelineEntriesByDefinedSequence(
  entries: SessionTimelineEntry[],
) {
  return sortItemsByCompleteSequence(
    entries,
    (entry) => isTranscriptEventEntry(entry) ? undefined : entry.sequence,
  );
}

function upsertToolCallEntry(
  entries: SessionTimelineEntry[],
  toolCall: AgentToolCall,
): SessionTimelineEntry[] {
  const id = resolveSessionTimelineToolCallEntryId(toolCall);
  const exactIndex = entries.findIndex((entry) =>
    entry.kind === "tool_call" && (
      entry.id === id || entry.toolCall.id === toolCall.id
    )
  );
  const existingIndex = exactIndex >= 0
    ? exactIndex
    : entries.findIndex((entry) =>
        entry.kind === "tool_call" &&
        isSameToolCommand(entry.toolCall, toolCall),
      );
  const entry: SessionTimelineToolCallEntry = {
    id,
    kind: "tool_call",
    toolCall,
    timestamp: toolCall.timestamp,
    updatedAt: toolCall.updatedAt,
    sequence: toolCall.sequence,
  };
  if (existingIndex === -1) {
    entries.push(entry);
    return entries;
  }
  const merged = mergeToolCallEntry(
    entries[existingIndex] as SessionTimelineToolCallEntry,
    entry,
  );
  merged.id = resolveSessionTimelineToolCallEntryId(merged.toolCall);
  entries[existingIndex] = merged;
  collapseDuplicateToolCommandEntries(entries, existingIndex);
  return entries;
}

function collapseDuplicateToolCommandEntries(
  entries: SessionTimelineEntry[],
  enrichedIndex: number,
) {
  const enriched = entries[enrichedIndex];
  if (
    enriched?.kind !== "tool_call" ||
    enriched.toolCall.kind === "subagent" ||
    !enriched.toolCall.commandId
  ) {
    return;
  }
  const matchingIndices = entries
    .map((candidate, index) => (
      candidate.kind === "tool_call" &&
      candidate.toolCall.kind !== "subagent" &&
      candidate.toolCall.commandId === enriched.toolCall.commandId
        ? index
        : -1
    ))
    .filter((index) => index >= 0);
  if (matchingIndices.length < 2) {
    return;
  }
  matchingIndices.sort((leftIndex, rightIndex) => {
    const left = entries[leftIndex] as SessionTimelineToolCallEntry;
    const right = entries[rightIndex] as SessionTimelineToolCallEntry;
    return (left.sequence ?? Number.MAX_SAFE_INTEGER) -
      (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
      leftIndex - rightIndex;
  });
  const targetIndex = matchingIndices[0]!;
  let merged = entries[targetIndex] as SessionTimelineToolCallEntry;
  for (const index of matchingIndices.slice(1)) {
    merged = mergeToolCallEntry(
      merged,
      entries[index] as SessionTimelineToolCallEntry,
    );
  }
  entries[targetIndex] = merged;
  for (const index of matchingIndices.slice(1).sort((left, right) => right - left)) {
    entries.splice(index, 1);
  }
}

function upsertAssistantThinking(
  entries: SessionTimelineEntry[],
  message: AgentMessage,
): SessionTimelineEntry[] {
  const chunkId = resolveAssistantChunkId({
    entries,
    assistantEntryId: message.id,
    baseChunkId: `${message.id}:thinking`,
    kind: "thinking",
    sequence: message.sequence,
  });
  const entry = findOrCreateAssistantEntry(entries, message.id, message.timestamp, message.sequence);
  const chunk: SessionTimelineThinkingChunk = {
    id: chunkId,
    kind: "thinking",
    text: message.text,
    title: "Thinking",
    status: message.streaming === false ? "completed" : "running",
    ...(message.streamMode ? { streamMode: message.streamMode } : {}),
    timestamp: message.timestamp,
    updatedAt: message.timestamp,
    sequence: message.sequence,
  };
  entry.chunks = upsertAssistantChunk(entry.chunks, chunk);
  applyAssistantEntryBounds(entry);
  return entries;
}

function appendOutputToSessionTimeline(
  entries: SessionTimelineEntry[],
  output: CommandChunk,
): SessionTimelineEntry[] {
  entries.push({
    id: `output:${output.commandId}:${output.sequence ?? output.id}`,
    kind: "command_output",
    commandId: output.commandId,
    output,
    timestamp: output.timestamp,
    updatedAt: output.timestamp,
    sequence: output.sequence,
  });
  return entries;
}

function findOrCreateAssistantEntry(
  entries: SessionTimelineEntry[],
  id: string,
  timestamp: string,
  sequence: number | undefined,
): SessionTimelineAssistantEntry {
  const existing = entries.find((entry): entry is SessionTimelineAssistantEntry => (
    entry.kind === "assistant_message" && entry.id === id
  ));
  if (existing) {
    return existing;
  }
  const entry: SessionTimelineAssistantEntry = {
    id,
    kind: "assistant_message",
    chunks: [],
    timestamp,
    updatedAt: timestamp,
    sequence,
  };
  entries.push(entry);
  return entry;
}

function upsertAssistantChunk(
  chunks: SessionAssistantTimelineChunk[],
  incoming: SessionAssistantTimelineChunk,
): SessionAssistantTimelineChunk[] {
  const existingIndex = chunks.findIndex((chunk) => chunk.id === incoming.id && chunk.kind === incoming.kind);
  if (existingIndex === -1) {
    return [...chunks, incoming];
  }
  const current = chunks[existingIndex];
  if (!current) {
    return [...chunks, incoming];
  }
  chunks[existingIndex] = current.kind === "content" && incoming.kind === "content"
    ? mergeContentChunk(current, incoming)
    : current.kind === "thinking" && incoming.kind === "thinking"
      ? mergeThinkingChunk(current, incoming)
      : incoming;
  return chunks;
}

function mergeMessageEntry(
  current: SessionTimelineMessageEntry,
  incoming: SessionTimelineMessageEntry,
): SessionTimelineMessageEntry {
  return {
    ...incoming,
    message: incoming.message,
    timestamp: current.timestamp,
    updatedAt: incoming.updatedAt,
    sequence: current.sequence ?? incoming.sequence,
  };
}

function mergeContentChunk(
  current: SessionTimelineContentChunk,
  incoming: SessionTimelineContentChunk,
): SessionTimelineContentChunk {
  return {
    ...incoming,
    id: current.id,
    text: mergeTimelineContentText(current, incoming) ?? "",
    timestamp: current.timestamp,
    sequence: current.sequence ?? incoming.sequence,
  };
}

function mergeThinkingChunk(
  current: SessionTimelineThinkingChunk,
  incoming: SessionTimelineThinkingChunk,
): SessionTimelineThinkingChunk {
  return {
    ...incoming,
    id: current.id,
    text: mergeStreamingText(current.text, incoming.text, incoming.streamMode ?? "auto") ?? "",
    title: /^thinking$/iu.test(current.title.trim()) ? incoming.title : current.title,
    timestamp: current.timestamp,
    sequence: current.sequence ?? incoming.sequence,
  };
}

function mergeToolCallEntry(
  current: SessionTimelineToolCallEntry,
  incoming: SessionTimelineToolCallEntry,
): SessionTimelineToolCallEntry {
  const kind = resolveMergedAgentToolCallKind(
    current.toolCall,
    incoming.toolCall,
  );
  return {
    ...incoming,
    id: current.id,
    toolCall: {
      ...current.toolCall,
      ...incoming.toolCall,
      id: current.toolCall.id,
      kind,
      title: resolveMergedToolCallTitle(current.toolCall, incoming.toolCall),
      status: resolveMergedToolCallStatus(current.toolCall, incoming.toolCall),
      input: kind === "subagent"
        ? mergeSubagentInput(current.toolCall.input, incoming.toolCall.input)
        : incoming.toolCall.input ?? current.toolCall.input,
      output: resolveMergedToolCallOutput(current.toolCall, incoming.toolCall),
      timestamp: current.toolCall.timestamp,
      sequence: current.toolCall.sequence ?? incoming.toolCall.sequence,
    },
    timestamp: current.timestamp,
    sequence: current.sequence ?? incoming.sequence,
  };
}

function mergeSubagentInput(current: string | undefined, incoming: string | undefined) {
  if (incoming === undefined || !current) {
    return incoming ?? current;
  }
  const currentRecord = parseRecord(current);
  const incomingRecord = parseRecord(incoming);
  if (!currentRecord || !incomingRecord) {
    return incoming;
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

function isSameToolCommand(left: AgentToolCall, right: AgentToolCall) {
  if (left.kind === "subagent" || right.kind === "subagent") {
    return left.kind === "subagent" &&
      right.kind === "subagent" &&
      Boolean(left.commandId && left.commandId === right.commandId);
  }
  if (left.commandId && right.commandId && left.commandId === right.commandId) {
    return true;
  }
  return (
    Boolean(left.commandId && left.commandId === right.id) ||
    Boolean(right.commandId && right.commandId === left.id)
  );
}

function resolveMergedToolCallTitle(current: AgentToolCall, incoming: AgentToolCall) {
  const incomingCategory = resolveSubagentCategory(incoming);
  if (incomingCategory) {
    return incomingCategory;
  }
  const currentCategory = resolveSubagentCategory(current);
  if (currentCategory) {
    return currentCategory;
  }
  const currentTitle = current.title.trim();
  const incomingTitle = incoming.title.trim();
  if (isWeakMergedToolCallTitle(incomingTitle, incoming)) {
    return current.title;
  }
  if (isWeakMergedToolCallTitle(currentTitle, current)) {
    return incoming.title;
  }
  if (isGenericToolCallTitle(incomingTitle)) {
    return current.title;
  }
  return incoming.title;
}

function resolveSubagentCategory(toolCall: AgentToolCall) {
  if (toolCall.kind !== "subagent" || !toolCall.input) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(toolCall.input);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const category = (parsed as Record<string, unknown>).category;
    return typeof category === "string" && category.trim() ? category.trim() : undefined;
  } catch {
    return undefined;
  }
}

function resolveMergedToolCallStatus(
  current: AgentToolCall,
  incoming: AgentToolCall,
) {
  if (shouldKeepTerminalToolStatus(current, incoming)) {
    return current.status;
  }
  return incoming.status;
}

function shouldKeepTerminalToolStatus(current: AgentToolCall, incoming: AgentToolCall) {
  const sameInvocation =
    (current.kind !== "subagent" && incoming.kind !== "subagent") ||
    current.id === incoming.id;
  return (
    sameInvocation &&
    (
      current.status === "completed" ||
      current.status === "failed" ||
      current.status === "cancelled"
    )
  ) && (incoming.status === "running" || incoming.status === "pending");
}

function isWeakMergedToolCallTitle(title: string, toolCall: AgentToolCall) {
  const normalizedTitle = title.trim().toLowerCase();
  return !normalizedTitle ||
    normalizedTitle === toolCall.id.toLowerCase() ||
    normalizedTitle === toolCall.commandId?.toLowerCase() ||
    normalizedTitle.startsWith("tool call ") ||
    (toolCall.kind === "subagent" && normalizedTitle === "task");
}

function isGenericToolCallTitle(title: string) {
  return GENERIC_TOOL_CALL_TITLES.has(title.trim().toLowerCase());
}

const GENERIC_TOOL_CALL_TITLES = new Set([
  "agent",
  "built-in",
  "builtin",
  "fetch",
  "file",
  "mcp",
  "read",
  "search",
  "shell",
  "skill",
  "subagent",
  "think",
  "thinking",
  "todo",
  "tool",
  "write",
]);

function applyAssistantEntryBounds(entry: SessionTimelineAssistantEntry) {
  const firstChunk = entry.chunks[0];
  const lastChunk = entry.chunks.at(-1);
  entry.timestamp = firstChunk?.timestamp ?? entry.timestamp;
  entry.updatedAt = lastChunk && "updatedAt" in lastChunk ? lastChunk.updatedAt : lastChunk?.timestamp ?? entry.updatedAt;
  entry.sequence = minDefined(entry.chunks.map((chunk) => chunk.sequence));
  entry.streaming = entry.chunks.some((chunk) => chunk.kind === "content" && chunk.streaming);
}

function sortItemsByCompleteSequence<T>(
  items: T[],
  getSequence: (item: T) => number | undefined,
) {
  if (!items.every((item) => typeof getSequence(item) === "number")) {
    return [...items];
  }

  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => getSequence(left.item)! - getSequence(right.item)! || left.index - right.index)
    .map(({ item }) => item);
}

function minDefined(values: Array<number | undefined>) {
  return values.reduce<number | undefined>((minimum, value) => {
    if (value === undefined) {
      return minimum;
    }
    return minimum === undefined ? value : Math.min(minimum, value);
  }, undefined);
}

function mergeOptionalText(current: string | undefined, incoming: string | undefined) {
  if (!current) {
    return incoming;
  }
  if (!incoming || current.endsWith(incoming)) {
    return current;
  }
  if (incoming.startsWith(current)) {
    return incoming;
  }
  return `${current}${incoming}`;
}

function mergeTimelineContentText(
  current: SessionTimelineContentChunk,
  incoming: SessionTimelineContentChunk,
) {
  if (
    current.streaming === true &&
    incoming.streaming !== true &&
    shouldPreferFinalAssistantSnapshot(current.text, incoming.text)
  ) {
    return incoming.text;
  }
  return mergeStreamingText(
    current.text,
    incoming.text,
    incoming.streamMode ?? "auto",
  );
}

function shouldPreferFinalAssistantSnapshot(currentText: string, incomingText: string) {
  const normalizedCurrent = stripTimelineChunkWhitespace(currentText);
  const normalizedIncoming = stripTimelineChunkWhitespace(incomingText);
  return normalizedIncoming.length >= normalizedCurrent.length &&
    normalizedIncoming.includes(normalizedCurrent);
}

function stripTimelineChunkWhitespace(value: string) {
  return value.replace(/\s+/gu, "");
}

function resolveMergedToolCallOutput(
  current: AgentToolCall,
  incoming: AgentToolCall,
) {
  return mergeOptionalText(current.output, incoming.output);
}
