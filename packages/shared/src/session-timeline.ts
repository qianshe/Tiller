import type { AgentMessage, AgentToolCall, CommandChunk } from "./types";
import type {
  SessionTimelineContextCompactionEntry,
  SessionTimelineHistoryGapEntry,
} from "./session-transcript";
import { isTranscriptEventEntry } from "./session-transcript";

export type SessionTimelineContentChunk = {
  id: string;
  kind: "content";
  text: string;
  timestamp: string;
  sequence?: number;
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

export type SessionTimelineEntry =
  | SessionTimelineMessageEntry
  | SessionTimelineAssistantEntry
  | SessionTimelineToolCallEntry
  | SessionTimelineContextCompactionEntry
  | SessionTimelineHistoryGapEntry;

export type SessionTimelineBatch = {
  replace: boolean;
  deliverySequence: number;
  lastSequence: number;
  entries: SessionTimelineEntry[];
};

export type SessionTimelineStorePage = {
  entries: SessionTimelineEntry[];
  nextCursor?: string;
  hasMore: boolean;
};

export type BuildSessionTimelineInput = {
  messages: AgentMessage[];
  outputs?: CommandChunk[];
  toolCalls?: AgentToolCall[];
};

const USER_PROMPT_REPRESENTATION_WINDOW_MS = 10_000;
const TIMELINE_SEQUENCE_RESET_TIMESTAMP_GAP_MS = 60_000;

type LegacyTimelineSource =
  | { kind: "message"; message: AgentMessage; timestamp: string; sequence?: number }
  | { kind: "tool_call"; toolCall: AgentToolCall; timestamp: string; sequence?: number }
  | { kind: "output"; output: CommandChunk; timestamp: string; sequence?: number };

type TimelineUserMessageAnchor = {
  id: string;
  entryId: string;
  text: string;
  timestamp: string;
  sequence?: number;
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
      sequence: message.sequence,
    })),
    ...toolCalls.map((toolCall): LegacyTimelineSource => ({
      kind: "tool_call",
      toolCall,
      timestamp: toolCall.timestamp,
      sequence: toolCall.sequence,
    })),
    ...outputs
      .filter((output) => !toolCalls.some((toolCall) => matchesCommandOutput(toolCall, output)))
      .map((output): LegacyTimelineSource => ({
        kind: "output",
        output,
        timestamp: output.timestamp,
        sequence: output.sequence,
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
      sequence: entry.message.sequence ?? entry.sequence,
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
  return typeof anchor.sequence === "number" &&
    typeof message.sequence === "number" &&
    anchor.sequence === message.sequence;
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
    sequence: toolCall.sequence,
  });
  const chunk: SessionTimelineThinkingChunk = {
    id: chunkId,
    kind: "thinking",
    text: toolCall.output ?? toolCall.input ?? "",
    title: toolCall.title,
    status: toolCall.status,
    timestamp: toolCall.timestamp,
    updatedAt: toolCall.updatedAt,
    sequence: toolCall.sequence,
  };
  const entry = findOrCreateAssistantEntry(entries, assistantEntryId, chunk.timestamp, chunk.sequence);
  entry.chunks = upsertAssistantChunk(entry.chunks, chunk);
  applyAssistantEntryBounds(entry);
  return entries;
}

function resolveAssistantChunkId(input: {
  entries: SessionTimelineEntry[];
  assistantEntryId: string;
  baseChunkId: string;
  kind: SessionAssistantTimelineChunk["kind"];
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
    if (isTranscriptEventEntry(entry)) {
      return false;
    }
    return entry.kind !== "assistant_message" &&
      typeof entry.sequence === "number" &&
      entry.sequence > start &&
      entry.sequence < end;
  });
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
  item: { sequence?: number; timestamp: string },
  left: { sequence?: number; timestamp: string },
  right: { sequence?: number; timestamp: string },
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
      const leftSequence = isTranscriptEventEntry(left.item) ? undefined : left.item.sequence;
      const rightSequence = isTranscriptEventEntry(right.item) ? undefined : right.item.sequence;
      const sequenceDelta = compareOptionalTimelineSequence(
        leftSequence,
        rightSequence,
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
    sequence: toolCall.sequence,
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
    timestamp: shouldPreferIncomingTextTimestamp(
      current.message.text,
      incoming.message.text,
      current.timestamp,
      incoming.timestamp,
    )
      ? incoming.timestamp
      : current.timestamp,
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
    timestamp: shouldPreferIncomingTextTimestamp(
      current.text,
      incoming.text,
      current.timestamp,
      incoming.timestamp,
    )
      ? incoming.timestamp
      : current.timestamp,
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
    text: mergeThinkingSnapshotText(current.text, incoming.text) ?? "",
    title: /^thinking$/iu.test(current.title.trim()) ? incoming.title : current.title,
    timestamp: current.timestamp,
    sequence: current.sequence ?? incoming.sequence,
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
      kind: resolveMergedToolCallKind(current.toolCall, incoming.toolCall),
      title: resolveMergedToolCallTitle(current.toolCall, incoming.toolCall),
      status: resolveMergedToolCallStatus(current.toolCall, incoming.toolCall),
      input: incoming.toolCall.input ?? current.toolCall.input,
      output: resolveMergedToolCallOutput(current.toolCall, incoming.toolCall),
      timestamp: shouldPreferIncomingToolTimestamp(current.toolCall, incoming.toolCall)
        ? incoming.toolCall.timestamp
        : current.toolCall.timestamp,
      sequence: current.toolCall.sequence ?? incoming.toolCall.sequence,
    },
    timestamp: shouldPreferIncomingToolTimestamp(current.toolCall, incoming.toolCall)
      ? incoming.timestamp
      : current.timestamp,
    sequence: current.sequence ?? incoming.sequence,
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

function resolveMergedToolCallKind(current: AgentToolCall, incoming: AgentToolCall) {
  return toolKindRank(incoming.kind) > toolKindRank(current.kind)
    ? incoming.kind
    : current.kind;
}

function resolveMergedToolCallTitle(current: AgentToolCall, incoming: AgentToolCall) {
  const currentTitle = current.title.trim();
  const incomingTitle = incoming.title.trim();
  if (isWeakMergedToolCallTitle(incomingTitle, incoming)) {
    return current.title;
  }
  if (isWeakMergedToolCallTitle(currentTitle, current)) {
    return incoming.title;
  }
  if (isGenericToolCallTitle(incomingTitle)) {
    if (!isGenericToolCallTitle(currentTitle)) {
      return current.title;
    }
    return toolKindRank(incoming.kind) > toolKindRank(current.kind)
      ? incoming.title
      : current.title;
  }
  return incoming.title;
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
  if ((current.status !== "completed" && current.status !== "failed") || incoming.status !== "running") {
    return false;
  }
  if (toolKindRank(incoming.kind) > toolKindRank(current.kind)) {
    return false;
  }
  if (!isWeakMergedToolCallTitle(incoming.title, incoming) && incoming.title !== current.title) {
    return false;
  }
  if (incoming.input && incoming.input !== current.input) {
    return false;
  }
  if (incoming.commandId && incoming.commandId !== current.commandId) {
    return false;
  }
  return true;
}

function isWeakMergedToolCallTitle(title: string, toolCall: AgentToolCall) {
  const normalizedTitle = title.trim().toLowerCase();
  return !normalizedTitle ||
    normalizedTitle === toolCall.id.toLowerCase() ||
    normalizedTitle === toolCall.commandId?.toLowerCase() ||
    normalizedTitle.startsWith("tool call ");
}

function isGenericToolCallTitle(title: string) {
  return GENERIC_TOOL_CALL_TITLES.has(title.trim().toLowerCase());
}

function toolKindRank(kind: AgentToolCall["kind"]) {
  const ranks: Record<AgentToolCall["kind"], number> = {
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
  return ranks[kind];
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
  const sortedChunks = sortAssistantTimelineChunks(entry.chunks);
  const firstChunk = sortedChunks[0];
  const lastChunk = sortedChunks.at(-1);
  entry.chunks = sortedChunks;
  entry.timestamp = firstChunk?.timestamp ?? entry.timestamp;
  entry.updatedAt = lastChunk && "updatedAt" in lastChunk ? lastChunk.updatedAt : lastChunk?.timestamp ?? entry.updatedAt;
  entry.sequence = minDefined(sortedChunks.map((chunk) => chunk.sequence));
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
    sequence: output.sequence,
  };
}

function compareTimelineItems<T extends { sequence?: number; timestamp: string }>(
  left: { item: T; index: number },
  right: { item: T; index: number },
) {
  const leftItem = left.item;
  const rightItem = right.item;
  const timestampDelta = compareIsoTimestamps(leftItem.timestamp, rightItem.timestamp);
  const timelineDelta = compareOptionalTimelineSequence(leftItem.sequence, rightItem.sequence);
  if (timelineDelta !== null) {
    const sequenceResetTimestampDelta = compareSequenceResetTimestampDelta(
      timelineDelta,
      timestampDelta,
    );
    if (sequenceResetTimestampDelta !== null) {
      return sequenceResetTimestampDelta;
    }
    return timelineDelta;
  }
  // When sequence is absent or present on only one side, fall back to
  // chronological timestamp (then insertion index) rather than index alone, so
  // legacy history with partial sequences keeps real message/tool interleaving
  // instead of collapsing into the kind-segregated rebuild order.
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

function compareSequenceResetTimestampDelta(
  timelineDelta: number,
  timestampDelta: number,
) {
  if (
    timestampDelta === 0 ||
    Math.abs(timestampDelta) < TIMELINE_SEQUENCE_RESET_TIMESTAMP_GAP_MS
  ) {
    return null;
  }
  return Math.sign(timelineDelta) === Math.sign(timestampDelta)
    ? null
    : timestampDelta;
}

function shouldPreferIncomingTextTimestamp(
  currentText: string,
  incomingText: string,
  currentTimestamp: string,
  incomingTimestamp: string,
) {
  return normalizeComparableText(currentText) === normalizeComparableText(incomingText) &&
    exceedsTimestampSkew(currentTimestamp, incomingTimestamp);
}

function shouldPreferIncomingToolTimestamp(
  current: AgentToolCall,
  incoming: AgentToolCall,
) {
  return current.kind === incoming.kind &&
    current.title.trim() === incoming.title.trim() &&
    exceedsTimestampSkew(current.timestamp, incoming.timestamp);
}

function normalizeComparableText(text: string) {
  return text.replace(/[*_~`]/gu, "").replace(/\s+/gu, " ").trim();
}

function exceedsTimestampSkew(left: string, right: string) {
  const delta = Math.abs(Date.parse(left) - Date.parse(right));
  return Number.isFinite(delta) && delta > TIMELINE_SEQUENCE_RESET_TIMESTAMP_GAP_MS;
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
  if (current.streaming === true && incoming.streaming !== true && incoming.text) {
    return incoming.text;
  }
  return mergeOptionalText(current.text, incoming.text);
}

function resolveMergedToolCallOutput(
  current: AgentToolCall,
  incoming: AgentToolCall,
) {
  if (current.kind !== "think" && incoming.kind !== "think") {
    return mergeOptionalText(current.output, incoming.output);
  }
  return mergeThinkingSnapshotText(current.output, incoming.output);
}

function mergeThinkingSnapshotText(
  current: string | undefined,
  incoming: string | undefined,
) {
  if (!current) {
    return incoming;
  }
  if (!incoming || current.endsWith(incoming)) {
    return current;
  }
  if (incoming.startsWith(current) || current.startsWith(incoming)) {
    return incoming.length >= current.length ? incoming : current;
  }
  const overlapped = mergeTextByLineOverlap(current, incoming);
  if (overlapped) {
    return overlapped;
  }
  return incoming.length >= current.length ? incoming : current;
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
