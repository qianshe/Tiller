import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type {
  AgentMessage,
  AgentPlan,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionTimelineEntry,
  SessionUpdateRecord,
} from "@tiller/shared";
import {
  appendMessageToSessionTimeline,
  appendToolCallToSessionTimeline,
  compactBinaryToolCallOutput,
  sortSessionTimelineEntries,
} from "@tiller/shared";
import {
  buildSessionCompactionEntryFromProvider,
  upsertSessionCompactionEntry,
} from "../../sessions/compaction-entry";

export type SessionUpdateReducerState = {
  entries: SessionTimelineEntry[];
  messages: AgentMessage[];
  toolCalls: AgentToolCall[];
  outputs: CommandChunk[];
  diffs: FileDiffSummary[];
  plan?: AgentPlan;
};

export function createEmptySessionUpdateReducerState(): SessionUpdateReducerState {
  return {
    entries: [],
    messages: [],
    toolCalls: [],
    outputs: [],
    diffs: [],
  };
}

export function applySessionUpdateRecordToState(
  state: SessionUpdateReducerState,
  record: SessionUpdateRecord,
): SessionUpdateReducerState {
  const event = parseSessionRuntimeEvent(record.payloadJson);
  return event ? applySessionRuntimeEventToStateWithMeta(state, event, record) : state;
}

export function applySessionRuntimeEventToState(
  state: SessionUpdateReducerState,
  event: SessionRuntimeEvent,
): SessionUpdateReducerState {
  return applySessionRuntimeEventToStateWithMeta(state, event);
}

function applySessionRuntimeEventToStateWithMeta(
  state: SessionUpdateReducerState,
  event: SessionRuntimeEvent,
  meta?: Pick<SessionUpdateRecord, "providerId" | "sessionId" | "source">,
): SessionUpdateReducerState {
  switch (event.type) {
    case "message":
      return applyMessage(state, event.message, meta?.source);
    case "compaction":
      return applyCompaction(state, event, meta);
    case "tool-call":
      return applyToolCall(state, event.toolCall, meta?.source);
    case "command-output":
      return applyCommandOutput(state, event.chunk, event.toolCall);
    case "diff-update":
      return { ...state, diffs: event.files };
    case "plan-update":
      return { ...state, plan: event.plan };
    default:
      return state;
  }
}

function applyCompaction(
  state: SessionUpdateReducerState,
  event: Extract<SessionRuntimeEvent, { type: "compaction" }>,
  meta?: Pick<SessionUpdateRecord, "providerId" | "sessionId">,
): SessionUpdateReducerState {
  if (!meta?.sessionId) {
    return state;
  }
  const entry = buildSessionCompactionEntryFromProvider({
    sessionId: meta.sessionId,
    providerId: meta.providerId,
    timestamp: event.timestamp,
    phase: event.phase,
    source: event.source,
    summaryText: event.summaryText,
    summaryMessageId: event.messageId,
    idSuffix: event.messageId ? undefined : `compaction:${event.timestamp}`,
  });
  const entries = [...state.entries];
  upsertSessionCompactionEntry(entries, entry);
  return {
    ...state,
    entries: sortSessionTimelineEntries(entries),
  };
}

export function createSessionUpdateRecord(input: {
  sessionId: string;
  runtimeSessionId: string;
  providerId: string;
  sequence: number;
  source: SessionUpdateRecord["source"];
  event: SessionRuntimeEvent;
  receivedAt?: string;
}): SessionUpdateRecord {
  const event = normalizeSessionUpdateEvent(input.event);
  return {
    sessionId: input.sessionId,
    runtimeSessionId: input.runtimeSessionId,
    providerId: input.providerId,
    sequence: input.sequence,
    source: input.source,
    updateType: event.type,
    receivedAt: input.receivedAt ?? new Date().toISOString(),
    payloadJson: JSON.stringify(event),
  };
}

function applyMessage(
  state: SessionUpdateReducerState,
  message: AgentMessage,
  source?: SessionUpdateRecord["source"],
): SessionUpdateReducerState {
  const resolvedMessage = resolveMessageIdentity(state.messages, message);
  const messages = upsertMessage(state.messages, resolvedMessage, source);
  const mergedMessage = messages.find((item) =>
    item.id === resolvedMessage.id && item.role === resolvedMessage.role
  ) ?? resolvedMessage;
  const entries = appendMessageToSessionTimeline([...state.entries], mergedMessage);
  return {
    ...state,
    messages,
    entries: sortSessionTimelineEntries(entries),
  };
}

function resolveMessageIdentity(messages: AgentMessage[], incoming: AgentMessage) {
  const sameRole = messages.find((message) => message.id === incoming.id && message.role === incoming.role);
  if (sameRole) {
    return incoming;
  }
  const otherRole = messages.find((message) => message.id === incoming.id);
  if (!otherRole) {
    return incoming;
  }
  const scopedId = resolveRoleScopedMessageId(messages, incoming);
  return { ...incoming, id: scopedId };
}

function resolveRoleScopedMessageId(messages: AgentMessage[], message: AgentMessage) {
  const baseId = `${message.id}:${message.role}`;
  let candidateId = baseId;
  let suffix = 2;
  while (true) {
    const current = messages.find((item) => item.id === candidateId);
    if (!current || current.role === message.role) {
      return candidateId;
    }
    candidateId = `${baseId}:${suffix}`;
    suffix += 1;
  }
}

function applyToolCall(
  state: SessionUpdateReducerState,
  toolCall: AgentToolCall,
  source?: SessionUpdateRecord["source"],
): SessionUpdateReducerState {
  const toolCalls = upsertToolCall(state.toolCalls, toolCall, source);
  const mergedToolCall = toolCalls.find((item) => item.id === toolCall.id) ?? toolCall;
  const entries = appendToolCallToSessionTimeline([...state.entries], mergedToolCall);
  return {
    ...state,
    toolCalls,
    entries: sortSessionTimelineEntries(entries),
  };
}

function applyCommandOutput(
  state: SessionUpdateReducerState,
  chunk: CommandChunk,
  toolCall?: AgentToolCall,
): SessionUpdateReducerState {
  const outputs = upsertOutput(state.outputs, chunk);
  return toolCall
    ? { ...applyToolCall(state, toolCall), outputs }
    : { ...state, outputs };
}

function upsertMessage(
  messages: AgentMessage[],
  incoming: AgentMessage,
  source?: SessionUpdateRecord["source"],
) {
  const existingIndex = messages.findIndex((message) => message.id === incoming.id && message.role === incoming.role);
  if (existingIndex === -1) {
    return [...messages, incoming];
  }
  const next = [...messages];
  const current = next[existingIndex]!;
  next[existingIndex] = {
    ...current,
    ...incoming,
    text: mergeMessageText(current, incoming),
    timestamp: shouldPreferIncomingMessageTimestamp(current, incoming, source)
      ? incoming.timestamp
      : current.timestamp,
    sequence: current.sequence ?? incoming.sequence,
  };
  return next;
}

function upsertToolCall(
  toolCalls: AgentToolCall[],
  incoming: AgentToolCall,
  source?: SessionUpdateRecord["source"],
) {
  const existingIndex = toolCalls.findIndex((toolCall) => toolCall.id === incoming.id);
  if (existingIndex === -1) {
    return [...toolCalls, incoming];
  }
  const next = [...toolCalls];
  const current = next[existingIndex]!;
  next[existingIndex] = {
    ...current,
    ...incoming,
    kind: resolveToolCallKind(current, incoming),
    title: resolveToolCallTitle(current.title, incoming.title, incoming.id),
    id: current.id,
    timestamp: shouldPreferIncomingToolCallTimestamp(current, incoming, source)
      ? incoming.timestamp
      : current.timestamp,
    sequence: shouldPreferIncomingToolCallSequence(current, incoming, source)
      ? incoming.sequence
      : (current.sequence ?? incoming.sequence),
    input: incoming.input ?? current.input,
    output: mergeToolCallOutput(current, incoming),
  };
  return next;
}

function upsertOutput(outputs: CommandChunk[], incoming: CommandChunk) {
  const existingIndex = outputs.findIndex((output) => output.id === incoming.id);
  if (existingIndex === -1) {
    return [...outputs, incoming];
  }
  const next = [...outputs];
  next[existingIndex] = incoming;
  return next;
}

function mergeText(current: string | undefined, incoming: string | undefined) {
  if (!current) {
    return incoming ?? "";
  }
  if (!incoming || current.endsWith(incoming)) {
    return current;
  }
  if (incoming.startsWith(current)) {
    return incoming;
  }
  return `${current}${incoming}`;
}

function mergeMessageText(current: AgentMessage, incoming: AgentMessage) {
  if (current.streaming === true && incoming.streaming !== true && incoming.text) {
    return incoming.text;
  }
  return mergeText(current.text, incoming.text);
}

function mergeToolCallOutput(current: AgentToolCall, incoming: AgentToolCall) {
  if (current.kind !== "think" && incoming.kind !== "think") {
    return mergeText(current.output, incoming.output);
  }
  return mergeThinkingSnapshotText(current.output, incoming.output);
}

function mergeThinkingSnapshotText(
  current: string | undefined,
  incoming: string | undefined,
) {
  if (!incoming) {
    return current ?? "";
  }
  if (!current || incoming.startsWith(current)) {
    return incoming;
  }
  if (current.startsWith(incoming) || current.endsWith(incoming)) {
    return current;
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

function resolveToolCallKind(
  current: AgentToolCall,
  incoming: AgentToolCall,
) {
  if (shouldPreferSearchRepair(current, incoming)) {
    return incoming.kind;
  }
  return isHigherConfidenceToolKind(incoming.kind, current.kind) ? incoming.kind : current.kind;
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
    search: 2,
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

function shouldPreferIncomingMessageTimestamp(
  current: AgentMessage,
  incoming: AgentMessage,
  source: SessionUpdateRecord["source"] | undefined,
) {
  if (
    source !== "agent_transcript_repair" &&
    source !== "local_history_repair"
  ) {
    return false;
  }
  if (normalizeComparableText(current.text) !== normalizeComparableText(incoming.text)) {
    return false;
  }
  return exceedsTimestampSkew(current.timestamp, incoming.timestamp);
}

function shouldPreferIncomingToolCallTimestamp(
  current: AgentToolCall,
  incoming: AgentToolCall,
  source: SessionUpdateRecord["source"] | undefined,
) {
  if (source !== "agent_transcript_repair") {
    return false;
  }
  if (current.kind !== incoming.kind || current.title.trim() !== incoming.title.trim()) {
    return false;
  }
  return exceedsTimestampSkew(current.timestamp, incoming.timestamp);
}

function shouldPreferIncomingToolCallSequence(
  current: AgentToolCall,
  incoming: AgentToolCall,
  source: SessionUpdateRecord["source"] | undefined,
) {
  return source === "agent_transcript_repair" &&
    current.sequence === undefined &&
    incoming.sequence !== undefined;
}

function resolveToolCallTitle(
  currentTitle: string,
  incomingTitle: string,
  id: string,
) {
  if (isInformativeToolCallTitle(incomingTitle, id) && !isFallbackToolCallTitle(incomingTitle)) {
    return incomingTitle;
  }
  return currentTitle || incomingTitle || id;
}

function isInformativeToolCallTitle(title: string | undefined, id: string) {
  const normalized = title?.trim();
  return Boolean(normalized && normalized !== id && !/^call_[A-Za-z0-9]+$/u.test(normalized));
}

function isFallbackToolCallTitle(title: string | undefined) {
  return /^Tool call\b/u.test(title?.trim() ?? "");
}

function normalizeComparableText(text: string) {
  return text.replace(/[*_~`]/gu, "").replace(/\s+/gu, " ").trim();
}

function exceedsTimestampSkew(left: string, right: string) {
  const delta = Math.abs(Date.parse(left) - Date.parse(right));
  return Number.isFinite(delta) && delta > 60_000;
}

function parseSessionRuntimeEvent(payloadJson: string): SessionRuntimeEvent | null {
  try {
    const parsed = JSON.parse(payloadJson) as Partial<SessionRuntimeEvent>;
    return typeof parsed?.type === "string"
      ? normalizeSessionUpdateEvent(parsed as SessionRuntimeEvent)
      : null;
  } catch {
    return null;
  }
}

function normalizeSessionUpdateEvent(event: SessionRuntimeEvent): SessionRuntimeEvent {
  if (event.type !== "tool-call") {
    return event;
  }
  return {
    ...event,
    toolCall: compactBinaryToolCallOutput(event.toolCall),
  };
}

