import type { AgentMessage, AgentToolCall, CommandChunk } from "./types";

export type SessionTimelineContentChunk = {
  id: string;
  kind: "content";
  text: string;
  timestamp: string;
  timelineSequence?: number;
  streaming?: boolean;
};

export type SessionTimelineThinkingChunk = {
  id: string;
  kind: "thinking";
  text: string;
  title: string;
  status: AgentToolCall["status"];
  timestamp: string;
  updatedAt: string;
  timelineSequence?: number;
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
  timelineSequence?: number;
};

export type SessionTimelineAssistantEntry = {
  id: string;
  kind: "assistant_message";
  chunks: SessionAssistantTimelineChunk[];
  timestamp: string;
  updatedAt: string;
  timelineSequence?: number;
  streaming?: boolean;
};

export type SessionTimelineToolCallEntry = {
  id: string;
  kind: "tool_call";
  toolCall: AgentToolCall;
  timestamp: string;
  updatedAt: string;
  timelineSequence?: number;
};

export type SessionTimelineEntry =
  | SessionTimelineMessageEntry
  | SessionTimelineAssistantEntry
  | SessionTimelineToolCallEntry;

export type BuildSessionTimelineInput = {
  messages: AgentMessage[];
  outputs?: CommandChunk[];
  toolCalls?: AgentToolCall[];
};

export function buildSessionTimelineFromLegacy({
  messages,
  outputs = [],
  toolCalls = [],
}: BuildSessionTimelineInput): SessionTimelineEntry[] {
  const entries: SessionTimelineEntry[] = [];
  for (const message of messages) {
    appendMessageToSessionTimeline(entries, message);
  }
  for (const toolCall of toolCalls) {
    appendToolCallToSessionTimeline(entries, toolCall);
  }
  for (const output of outputs) {
    if (!toolCalls.some((toolCall) => matchesCommandOutput(toolCall, output))) {
      appendToolCallToSessionTimeline(entries, commandOutputToToolCall(output));
    }
  }
  return sortSessionTimelineEntries(entries);
}

export function appendMessageToSessionTimeline(
  entries: SessionTimelineEntry[],
  message: AgentMessage,
): SessionTimelineEntry[] {
  if (message.role === "assistant") {
    return upsertAssistantContent(entries, message);
  }
  return upsertMessageEntry(entries, message);
}

export function appendToolCallToSessionTimeline(
  entries: SessionTimelineEntry[],
  toolCall: AgentToolCall,
): SessionTimelineEntry[] {
  if (toolCall.kind === "think") {
    return upsertThinkingChunk(entries, toolCall);
  }
  return upsertToolCallEntry(entries, toolCall);
}

export function sortSessionTimelineEntries(
  entries: SessionTimelineEntry[],
): SessionTimelineEntry[] {
  return entries
    .map((entry, index) => ({
      item: entry.kind === "assistant_message"
        ? { ...entry, chunks: sortAssistantTimelineChunks(entry.chunks) }
        : entry,
      index,
    }))
    .sort((left, right) => compareTimelineItems(left, right))
    .map(({ item }) => item);
}

export function sortAssistantTimelineChunks(
  chunks: SessionAssistantTimelineChunk[],
): SessionAssistantTimelineChunk[] {
  return chunks
    .map((chunk, index) => ({ item: chunk, index }))
    .sort((left, right) => compareTimelineItems(left, right))
    .map(({ item }) => item);
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
    timelineSequence: message.timelineSequence,
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
  const chunk: SessionTimelineContentChunk = {
    id: `${message.id}:content`,
    kind: "content",
    text: message.text,
    timestamp: message.timestamp,
    timelineSequence: message.timelineSequence,
    streaming: message.streaming,
  };
  const entry = findOrCreateAssistantEntry(entries, message.id, chunk.timestamp, chunk.timelineSequence);
  entry.chunks = upsertAssistantChunk(entry.chunks, chunk);
  applyAssistantEntryBounds(entry);
  return entries;
}

function upsertThinkingChunk(
  entries: SessionTimelineEntry[],
  toolCall: AgentToolCall,
): SessionTimelineEntry[] {
  const chunk: SessionTimelineThinkingChunk = {
    id: toolCall.id,
    kind: "thinking",
    text: toolCall.output ?? toolCall.input ?? "",
    title: toolCall.title,
    status: toolCall.status,
    timestamp: toolCall.timestamp,
    updatedAt: toolCall.updatedAt,
    timelineSequence: toolCall.timelineSequence,
  };
  const assistantEntryId = resolveAssistantEntryIdFromThinking(toolCall);
  const entry = findOrCreateAssistantEntry(entries, assistantEntryId, chunk.timestamp, chunk.timelineSequence);
  entry.chunks = upsertAssistantChunk(entry.chunks, chunk);
  applyAssistantEntryBounds(entry);
  return entries;
}

function upsertToolCallEntry(
  entries: SessionTimelineEntry[],
  toolCall: AgentToolCall,
): SessionTimelineEntry[] {
  const id = `tool:${toolCall.id}`;
  const existingIndex = entries.findIndex((entry) => entry.id === id && entry.kind === "tool_call");
  const entry: SessionTimelineToolCallEntry = {
    id,
    kind: "tool_call",
    toolCall,
    timestamp: toolCall.timestamp,
    updatedAt: toolCall.updatedAt,
    timelineSequence: toolCall.timelineSequence,
  };
  if (existingIndex === -1) {
    entries.push(entry);
    return entries;
  }
  entries[existingIndex] = mergeToolCallEntry(entries[existingIndex] as SessionTimelineToolCallEntry, entry);
  return entries;
}

function findOrCreateAssistantEntry(
  entries: SessionTimelineEntry[],
  id: string,
  timestamp: string,
  timelineSequence: number | undefined,
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
    timelineSequence,
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
    timelineSequence: current.timelineSequence ?? incoming.timelineSequence,
  };
}

function mergeContentChunk(
  current: SessionTimelineContentChunk,
  incoming: SessionTimelineContentChunk,
): SessionTimelineContentChunk {
  return {
    ...incoming,
    id: current.id,
    text: mergeOptionalText(current.text, incoming.text) ?? "",
    timestamp: current.timestamp,
    timelineSequence: current.timelineSequence ?? incoming.timelineSequence,
  };
}

function mergeThinkingChunk(
  current: SessionTimelineThinkingChunk,
  incoming: SessionTimelineThinkingChunk,
): SessionTimelineThinkingChunk {
  return {
    ...incoming,
    id: current.id,
    text: mergeOptionalText(current.text, incoming.text) ?? "",
    title: /^thinking$/iu.test(current.title.trim()) ? incoming.title : current.title,
    timestamp: current.timestamp,
    timelineSequence: current.timelineSequence ?? incoming.timelineSequence,
  };
}

function mergeToolCallEntry(
  current: SessionTimelineToolCallEntry,
  incoming: SessionTimelineToolCallEntry,
): SessionTimelineToolCallEntry {
  return {
    ...incoming,
    id: current.id,
    toolCall: {
      ...current.toolCall,
      ...incoming.toolCall,
      id: current.toolCall.id,
      input: mergeOptionalText(current.toolCall.input, incoming.toolCall.input),
      output: mergeOptionalText(current.toolCall.output, incoming.toolCall.output),
      timestamp: current.toolCall.timestamp,
      timelineSequence: current.toolCall.timelineSequence ?? incoming.toolCall.timelineSequence,
    },
    timestamp: current.timestamp,
    timelineSequence: current.timelineSequence ?? incoming.timelineSequence,
  };
}

function applyAssistantEntryBounds(entry: SessionTimelineAssistantEntry) {
  const sortedChunks = sortAssistantTimelineChunks(entry.chunks);
  const firstChunk = sortedChunks[0];
  const lastChunk = sortedChunks.at(-1);
  entry.chunks = sortedChunks;
  entry.timestamp = firstChunk?.timestamp ?? entry.timestamp;
  entry.updatedAt = lastChunk && "updatedAt" in lastChunk ? lastChunk.updatedAt : lastChunk?.timestamp ?? entry.updatedAt;
  entry.timelineSequence = minDefined(sortedChunks.map((chunk) => chunk.timelineSequence));
  entry.streaming = sortedChunks.some((chunk) => chunk.kind === "content" && chunk.streaming);
}

function resolveAssistantEntryIdFromThinking(toolCall: AgentToolCall) {
  const sourceId = toolCall.commandId ?? toolCall.id;
  return stripThinkingSuffix(sourceId) ?? stripThinkingSuffix(toolCall.id) ?? sourceId;
}

function stripThinkingSuffix(value: string) {
  return value.endsWith(":thinking") ? value.slice(0, -":thinking".length) : null;
}

function matchesCommandOutput(toolCall: AgentToolCall, output: CommandChunk) {
  return toolCall.id === output.commandId || toolCall.commandId === output.commandId;
}

function commandOutputToToolCall(output: CommandChunk): AgentToolCall {
  return {
    id: output.commandId,
    commandId: output.commandId,
    kind: "shell",
    title: output.commandId,
    status: "running",
    output: output.text,
    stream: output.stream,
    timestamp: output.timestamp,
    updatedAt: output.timestamp,
    timelineSequence: output.timelineSequence,
  };
}

function compareTimelineItems<T extends { timelineSequence?: number; timestamp: string }>(
  left: { item: T; index: number },
  right: { item: T; index: number },
) {
  const leftItem = left.item;
  const rightItem = right.item;
  const timelineDelta = compareOptionalTimelineSequence(leftItem.timelineSequence, rightItem.timelineSequence);
  if (timelineDelta !== null) {
    return timelineDelta;
  }
  if (hasMixedTimelineSequence(leftItem, rightItem)) {
    return left.index - right.index;
  }
  const timestampDelta = compareIsoTimestamps(leftItem.timestamp, rightItem.timestamp);
  return timestampDelta === 0 ? left.index - right.index : timestampDelta;
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

function hasMixedTimelineSequence(
  left: { timelineSequence?: number },
  right: { timelineSequence?: number },
) {
  return (left.timelineSequence === undefined) !== (right.timelineSequence === undefined);
}

function compareIsoTimestamps(leftTimestamp: string, rightTimestamp: string) {
  const leftTime = Date.parse(leftTimestamp);
  const rightTime = Date.parse(rightTimestamp);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return 0;
  }
  return leftTime - rightTime;
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
