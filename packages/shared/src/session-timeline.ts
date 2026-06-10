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

const USER_PROMPT_REPRESENTATION_WINDOW_MS = 10_000;

type LegacyTimelineSource =
  | { kind: "message"; message: AgentMessage; timestamp: string; timelineSequence?: number }
  | { kind: "tool_call"; toolCall: AgentToolCall; timestamp: string; timelineSequence?: number }
  | { kind: "output"; output: CommandChunk; timestamp: string; timelineSequence?: number };

type TimelineUserMessageAnchor = {
  id: string;
  entryId: string;
  text: string;
  timestamp: string;
  timelineSequence?: number;
};

export function buildSessionTimelineFromLegacy({
  messages,
  outputs = [],
  toolCalls = [],
}: BuildSessionTimelineInput): SessionTimelineEntry[] {
  const entries: SessionTimelineEntry[] = [];
  const sources = buildLegacyTimelineSources({ messages, outputs, toolCalls });
  for (const source of sources) {
    if (source.kind === "message") {
      appendMessageToSessionTimeline(entries, source.message);
      continue;
    }
    if (source.kind === "tool_call") {
      appendToolCallToSessionTimeline(entries, source.toolCall);
      continue;
    }
    appendToolCallToSessionTimeline(entries, commandOutputToToolCall(source.output));
  }
  return sortSessionTimelineEntries(entries);
}

function buildLegacyTimelineSources({
  messages,
  outputs,
  toolCalls,
}: Required<BuildSessionTimelineInput>) {
  return [
    ...messages.map((message): LegacyTimelineSource => ({
      kind: "message",
      message,
      timestamp: message.timestamp,
      timelineSequence: message.timelineSequence,
    })),
    ...toolCalls.map((toolCall): LegacyTimelineSource => ({
      kind: "tool_call",
      toolCall,
      timestamp: toolCall.timestamp,
      timelineSequence: toolCall.timelineSequence,
    })),
    ...outputs
      .filter((output) => !toolCalls.some((toolCall) => matchesCommandOutput(toolCall, output)))
      .map((output): LegacyTimelineSource => ({
        kind: "output",
        output,
        timestamp: output.timestamp,
        timelineSequence: output.timelineSequence,
      })),
  ]
    .map((item, index) => ({ item, index }))
    .sort((left, right) => compareTimelineItems(left, right))
    .map(({ item }) => item);
}

export function resolveTimelineRepresentedUserMessageIds(
  entries: SessionTimelineEntry[],
  messages: AgentMessage[],
): Set<string> {
  const candidates = messages.filter(isRepresentableUserMessage);
  const represented = new Set<string>();
  for (const anchor of collectTimelineUserMessageAnchors(entries)) {
    const matchIndex = findRepresentedUserMessageIndex(candidates, anchor);
    if (matchIndex === -1) {
      continue;
    }
    const [match] = candidates.splice(matchIndex, 1);
    if (match) {
      represented.add(match.id);
    }
  }
  return represented;
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

function collectTimelineUserMessageAnchors(
  entries: SessionTimelineEntry[],
): TimelineUserMessageAnchor[] {
  return entries.flatMap((entry) => {
    if (entry.kind !== "user_message") {
      return [];
    }
    return [{
      id: entry.message.id,
      entryId: entry.id,
      text: entry.message.text.trim(),
      timestamp: entry.message.timestamp,
      timelineSequence: entry.message.timelineSequence ?? entry.timelineSequence,
    }];
  });
}

function isRepresentableUserMessage(message: AgentMessage) {
  return message.role === "user" && Boolean(message.text.trim());
}

function findRepresentedUserMessageIndex(
  candidates: AgentMessage[],
  anchor: TimelineUserMessageAnchor,
) {
  const idMatchIndex = candidates.findIndex(
    (message) => message.id === anchor.id || message.id === anchor.entryId,
  );
  if (idMatchIndex !== -1) {
    return idMatchIndex;
  }

  let nearestIndex = -1;
  let nearestDelta = Number.POSITIVE_INFINITY;
  let textFallbackIndex = -1;
  for (const [index, message] of candidates.entries()) {
    if (message.text.trim() !== anchor.text) {
      continue;
    }
    if (textFallbackIndex === -1) {
      textFallbackIndex = index;
    }
    if (hasSameUserPromptSequence(anchor, message)) {
      return index;
    }
    const delta = Math.abs(Date.parse(anchor.timestamp) - Date.parse(message.timestamp));
    if (
      Number.isFinite(delta) &&
      delta <= USER_PROMPT_REPRESENTATION_WINDOW_MS &&
      delta < nearestDelta
    ) {
      nearestDelta = delta;
      nearestIndex = index;
    }
  }

  return nearestIndex === -1 ? textFallbackIndex : nearestIndex;
}

function hasSameUserPromptSequence(anchor: TimelineUserMessageAnchor, message: AgentMessage) {
  return typeof anchor.timelineSequence === "number" &&
    typeof message.timelineSequence === "number" &&
    anchor.timelineSequence === message.timelineSequence;
}

export function sortSessionTimelineEntries(
  entries: SessionTimelineEntry[],
): SessionTimelineEntry[] {
  return splitSessionTimelineAssistantEntriesAtBoundaries(entries)
    .map((entry, index) => ({
      item: entry,
      index,
    }))
    .sort((left, right) => compareTimelineItems(left, right))
    .map(({ item }) => item);
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
  const chunkId = resolveAssistantChunkId({
    entries,
    assistantEntryId: message.id,
    baseChunkId: `${message.id}:content`,
    kind: "content",
    timelineSequence: message.timelineSequence,
  });
  const entry = findOrCreateAssistantEntry(entries, message.id, message.timestamp, message.timelineSequence);
  const chunk: SessionTimelineContentChunk = {
    id: chunkId,
    kind: "content",
    text: resolveContentChunkText(entry, `${message.id}:content`, chunkId, message.text),
    timestamp: message.timestamp,
    timelineSequence: message.timelineSequence,
    streaming: message.streaming,
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

function upsertThinkingChunk(
  entries: SessionTimelineEntry[],
  toolCall: AgentToolCall,
): SessionTimelineEntry[] {
  const assistantEntryId = resolveAssistantEntryIdFromThinking(toolCall);
  const chunkId = resolveAssistantChunkId({
    entries,
    assistantEntryId,
    baseChunkId: toolCall.id,
    kind: "thinking",
    timelineSequence: toolCall.timelineSequence,
  });
  const chunk: SessionTimelineThinkingChunk = {
    id: chunkId,
    kind: "thinking",
    text: toolCall.output ?? toolCall.input ?? "",
    title: toolCall.title,
    status: toolCall.status,
    timestamp: toolCall.timestamp,
    updatedAt: toolCall.updatedAt,
    timelineSequence: toolCall.timelineSequence,
  };
  const entry = findOrCreateAssistantEntry(entries, assistantEntryId, chunk.timestamp, chunk.timelineSequence);
  entry.chunks = upsertAssistantChunk(entry.chunks, chunk);
  applyAssistantEntryBounds(entry);
  return entries;
}

function resolveAssistantChunkId(input: {
  entries: SessionTimelineEntry[];
  assistantEntryId: string;
  baseChunkId: string;
  kind: SessionAssistantTimelineChunk["kind"];
  timelineSequence?: number;
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
  const reusable = [...matchingChunks].reverse().find((chunk) =>
    !hasTimelineBoundaryBetween(input.entries, chunk.timelineSequence, input.timelineSequence),
  );
  if (reusable) {
    return reusable.id;
  }
  return `${input.baseChunkId}:${input.timelineSequence ?? matchingChunks.length + 1}`;
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
  return entries.some((entry) =>
    entry.kind !== "assistant_message" &&
    typeof entry.timelineSequence === "number" &&
    entry.timelineSequence > start &&
    entry.timelineSequence < end,
  );
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
    entry.kind !== "assistant_message" &&
    isTimelineItemBetween(entry, leftChunk, rightChunk)
  );
}

function isTimelineItemBetween(
  item: { timelineSequence?: number; timestamp: string },
  left: { timelineSequence?: number; timestamp: string },
  right: { timelineSequence?: number; timestamp: string },
) {
  return compareTimelineItems({ item, index: 0 }, { item: left, index: -1 }) > 0 &&
    compareTimelineItems({ item, index: 0 }, { item: right, index: 1 }) < 0;
}

function resolveAssistantSegmentEntryId(baseId: string, segmentIndex: number) {
  return segmentIndex === 0 ? baseId : `${baseId}#p${segmentIndex}`;
}

function sortTimelineEntriesByDefinedSequence(
  entries: SessionTimelineEntry[],
) {
  return entries
    .map((entry, index) => ({ item: entry, index }))
    .sort((left, right) => {
      const sequenceDelta = compareOptionalTimelineSequence(
        left.item.timelineSequence,
        right.item.timelineSequence,
      );
      return sequenceDelta ?? left.index - right.index;
    })
    .map(({ item }) => item);
}

function upsertToolCallEntry(
  entries: SessionTimelineEntry[],
  toolCall: AgentToolCall,
): SessionTimelineEntry[] {
  const id = `tool:${toolCall.id}`;
  const existingIndex = entries.findIndex((entry) =>
    entry.kind === "tool_call" &&
    (entry.id === id || isSameToolCommand(entry.toolCall, toolCall)),
  );
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
      title: resolveMergedToolCallTitle(current.toolCall, incoming.toolCall),
      status: resolveMergedToolCallStatus(current.toolCall.status, incoming.toolCall.status),
      input: mergeOptionalText(current.toolCall.input, incoming.toolCall.input),
      output: mergeOptionalText(current.toolCall.output, incoming.toolCall.output),
      timestamp: current.toolCall.timestamp,
      timelineSequence: current.toolCall.timelineSequence ?? incoming.toolCall.timelineSequence,
    },
    timestamp: current.timestamp,
    timelineSequence: current.timelineSequence ?? incoming.timelineSequence,
  };
}

function isSameToolCommand(left: AgentToolCall, right: AgentToolCall) {
  if (left.commandId && right.commandId && left.commandId === right.commandId) {
    return true;
  }
  return (
    Boolean(left.commandId && left.commandId === right.id) ||
    Boolean(right.commandId && right.commandId === left.id)
  );
}

function resolveMergedToolCallTitle(current: AgentToolCall, incoming: AgentToolCall) {
  const incomingTitle = incoming.title.trim();
  if (!incomingTitle || incomingTitle === incoming.id || incomingTitle === incoming.commandId) {
    return current.title;
  }
  return incoming.title;
}

function resolveMergedToolCallStatus(
  current: AgentToolCall["status"],
  incoming: AgentToolCall["status"],
) {
  if ((current === "completed" || current === "failed") && incoming === "running") {
    return current;
  }
  return incoming;
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
  // When timelineSequence is absent or present on only one side, fall back to
  // chronological timestamp (then insertion index) rather than index alone, so
  // legacy history with partial sequences keeps real message/tool interleaving
  // instead of collapsing into the kind-segregated rebuild order.
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
