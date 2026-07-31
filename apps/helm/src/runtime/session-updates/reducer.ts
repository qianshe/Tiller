import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type {
  AgentMessage,
  AgentPlan,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionTimelineEntry,
  SessionPromptQueueSnapshot,
  SessionUpdateRecord,
} from "@tiller/shared";
import {
  appendMessageToSessionTimeline,
  appendToolCallToSessionTimeline,
  compactBinaryToolCallOutput,
  resolveMergedAgentToolCallKind,
  shouldStartNewAssistantOccurrenceAfterBoundary,
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
  assistantBoundarySequence?: number;
};

export type PersistedSessionEvent =
  | SessionRuntimeEvent
  | { type: "prompt-queue"; snapshot: SessionPromptQueueSnapshot }
  | {
      type: "approval-status";
      approvalId: string;
      status: "pending" | "resolving" | "expired";
      updatedAt: string;
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
  const event = parsePersistedSessionEvent(record.payloadJson);
  return event && event.type !== "prompt-queue" && event.type !== "approval-status"
    ? applySessionRuntimeEventToStateWithMeta(
      state,
      backfillSessionUpdateEventMeta(event, record),
      record,
    )
    : state;
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
  meta?: Pick<SessionUpdateRecord, "providerId" | "sessionId" | "sequence">,
): SessionUpdateReducerState {
  switch (event.type) {
    case "message":
      return applyMessage(state, event.message, meta?.sequence);
    case "compaction":
      return applyCompaction(state, event, meta);
    case "tool-call":
      return applyToolCall(state, event.toolCall, meta?.sequence ?? event.toolCall.sequence);
    case "command-output":
      return applyCommandOutput(
        state,
        event.chunk,
        event.toolCall,
        meta?.sequence ?? event.chunk.sequence,
      );
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
    entries,
  };
}

export function createSessionUpdateRecord(input: {
  sessionId: string;
  runtimeSessionId: string;
  providerId: string;
  sequence: number;
  source: SessionUpdateRecord["source"];
  event: PersistedSessionEvent;
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
  observationSequence?: number,
): SessionUpdateReducerState {
  const resolvedMessage = resolveMessageIdentity(state, message, observationSequence);
  const messages = upsertMessage(state.messages, resolvedMessage);
  const mergedMessage = messages.find((item) =>
    item.id === resolvedMessage.id && item.role === resolvedMessage.role
  ) ?? resolvedMessage;
  const entries = appendMessageToSessionTimeline([...state.entries], mergedMessage);
  return {
    ...state,
    messages,
    entries,
  };
}

function resolveMessageIdentity(
  state: SessionUpdateReducerState,
  incoming: AgentMessage,
  observationSequence?: number,
) {
  const sameIdentity = findLatestCompatibleMessageOccurrence(state.messages, incoming);
  if (sameIdentity) {
    if (
      shouldStartNewAssistantOccurrence(
        state,
        sameIdentity,
        incoming,
        observationSequence,
      )
    ) {
      return {
        ...incoming,
        sequence: observationSequence ?? incoming.sequence,
        id: resolveOccurrenceScopedMessageId(
          state.messages,
          incoming,
          state.assistantBoundarySequence!,
        ),
      };
    }
    return sameIdentity.id === incoming.id
      ? incoming
      : { ...incoming, id: sameIdentity.id };
  }
  const conflictingMessage = state.messages.find((message) => message.id === incoming.id);
  if (!conflictingMessage) {
    return incoming;
  }
  const scopedId = resolveRoleScopedMessageId(state.messages, incoming);
  return { ...incoming, id: scopedId };
}

function findLatestCompatibleMessageOccurrence(
  messages: AgentMessage[],
  incoming: AgentMessage,
): AgentMessage | undefined {
  const occurrencePrefix = `${incoming.id}:occ-`;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (
      (message.id === incoming.id ||
        (incoming.role === "assistant" && message.id.startsWith(occurrencePrefix))) &&
      message.role === incoming.role &&
      resolveMessageContentKind(message) === resolveMessageContentKind(incoming)
    ) {
      return message;
    }
  }
  return undefined;
}

function shouldStartNewAssistantOccurrence(
  state: SessionUpdateReducerState,
  current: AgentMessage,
  incoming: AgentMessage,
  observationSequence?: number,
) {
  if (incoming.role !== "assistant") return false;
  const boundary = state.assistantBoundarySequence;
  const incomingSequence = observationSequence ?? incoming.sequence;
  if (
    boundary === undefined ||
    current.sequence === undefined ||
    incomingSequence === undefined ||
    boundary <= current.sequence ||
    boundary >= incomingSequence
  ) {
    return false;
  }
  return shouldStartNewAssistantOccurrenceAfterBoundary(
    current.text,
    incoming.text,
    true,
  );
}

function resolveOccurrenceScopedMessageId(
  messages: AgentMessage[],
  message: AgentMessage,
  boundarySequence: number,
) {
  const baseId = `${message.id}:occ-${boundarySequence}`;
  let candidateId = baseId;
  let suffix = 2;
  while (messages.some((item) => item.id === candidateId)) {
    candidateId = `${baseId}:${suffix}`;
    suffix += 1;
  }
  return candidateId;
}

function resolveRoleScopedMessageId(messages: AgentMessage[], message: AgentMessage) {
  const hasSameRoleConflict = messages.some((item) =>
    item.id === message.id && item.role === message.role
  );
  const baseId = hasSameRoleConflict
    ? `${message.id}:${resolveMessageContentKind(message)}`
    : `${message.id}:${message.role}`;
  let candidateId = baseId;
  let suffix = 2;
  while (true) {
    const current = messages.find((item) => item.id === candidateId);
    if (
      !current ||
      (
        current.role === message.role &&
        resolveMessageContentKind(current) === resolveMessageContentKind(message)
      )
    ) {
      return candidateId;
    }
    candidateId = `${baseId}:${suffix}`;
    suffix += 1;
  }
}

function applyToolCall(
  state: SessionUpdateReducerState,
  toolCall: AgentToolCall,
  observationSequence?: number,
): SessionUpdateReducerState {
  const toolCalls = upsertToolCall(state.toolCalls, toolCall);
  const mergedToolCall = toolCalls.find((item) => item.id === toolCall.id) ?? toolCall;
  const entries = appendToolCallToSessionTimeline([...state.entries], mergedToolCall);
  return {
    ...state,
    toolCalls,
    entries,
    assistantBoundarySequence: maxSequence(
      state.assistantBoundarySequence,
      observationSequence,
    ),
  };
}

function applyCommandOutput(
  state: SessionUpdateReducerState,
  chunk: CommandChunk,
  toolCall?: AgentToolCall,
  observationSequence?: number,
): SessionUpdateReducerState {
  const outputs = upsertOutput(state.outputs, chunk);
  return toolCall
    ? { ...applyToolCall(state, toolCall, observationSequence), outputs }
    : {
      ...state,
      outputs,
      assistantBoundarySequence: maxSequence(
        state.assistantBoundarySequence,
        observationSequence,
      ),
    };
}

function maxSequence(current: number | undefined, incoming: number | undefined) {
  if (incoming === undefined) return current;
  return current === undefined ? incoming : Math.max(current, incoming);
}

function upsertMessage(
  messages: AgentMessage[],
  incoming: AgentMessage,
) {
  const existingIndex = messages.findIndex((message) =>
    message.id === incoming.id &&
    message.role === incoming.role &&
    resolveMessageContentKind(message) === resolveMessageContentKind(incoming)
  );
  if (existingIndex === -1) {
    return [...messages, incoming];
  }
  const next = [...messages];
  const current = next[existingIndex]!;
  next[existingIndex] = {
    ...current,
    ...incoming,
    text: mergeMessageText(current, incoming),
    timestamp: current.timestamp,
    sequence: current.sequence ?? incoming.sequence,
  };
  return next;
}

function resolveMessageContentKind(message: AgentMessage) {
  return message.contentKind ?? "content";
}

function upsertToolCall(
  toolCalls: AgentToolCall[],
  incoming: AgentToolCall,
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
    status: resolveToolCallStatus(current.status, incoming.status),
    kind: resolveMergedAgentToolCallKind(current, incoming),
    title: resolveToolCallTitle(current.title, incoming.title, incoming.id),
    id: current.id,
    timestamp: current.timestamp,
    sequence: current.sequence ?? incoming.sequence,
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
  const current = next[existingIndex]!;
  next[existingIndex] = {
    ...current,
    ...incoming,
    id: current.id,
    timestamp: current.timestamp,
    sequence: current.sequence ?? incoming.sequence,
  };
  return next;
}

function resolveToolCallStatus(
  current: AgentToolCall["status"],
  incoming: AgentToolCall["status"],
) {
  return isTerminalToolCallStatus(current) && !isTerminalToolCallStatus(incoming)
    ? current
    : incoming;
}

function isTerminalToolCallStatus(status: AgentToolCall["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled";
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
  return mergeText(current.output, incoming.output);
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

export function parsePersistedSessionEvent(payloadJson: string): PersistedSessionEvent | null {
  try {
    const parsed = JSON.parse(payloadJson) as Partial<PersistedSessionEvent>;
    return typeof parsed?.type === "string"
      ? normalizeSessionUpdateEvent(parsed as PersistedSessionEvent)
      : null;
  } catch {
    return null;
  }
}

function normalizeSessionUpdateEvent(event: PersistedSessionEvent): PersistedSessionEvent {
  if (event.type === "message") {
    const normalized = { ...event };
    delete normalized.origin;
    return normalized;
  }
  if (event.type === "tool-call") {
    const normalized = {
      ...event,
      toolCall: compactBinaryToolCallOutput(event.toolCall),
    };
    delete normalized.origin;
    return normalized;
  }
  return event;
}

function backfillSessionUpdateEventMeta(
  event: SessionRuntimeEvent,
  record: Pick<SessionUpdateRecord, "sequence" | "receivedAt">,
): SessionRuntimeEvent {
  switch (event.type) {
    case "message":
      return event.message.sequence === undefined
        ? {
          ...event,
          message: {
            ...event.message,
            sequence: record.sequence,
            timestamp: record.receivedAt,
          },
        }
        : event;
    case "tool-call":
      return event.toolCall.sequence === undefined
        ? {
          ...event,
          toolCall: {
            ...event.toolCall,
            sequence: record.sequence,
            timestamp: record.receivedAt,
            updatedAt: record.receivedAt,
          },
        }
        : event;
    case "command-output":
      return {
        ...event,
        chunk: event.chunk.sequence === undefined
          ? {
            ...event.chunk,
            sequence: record.sequence,
            timestamp: record.receivedAt,
          }
          : event.chunk,
        ...(event.toolCall && event.toolCall.sequence === undefined
          ? {
            toolCall: {
              ...event.toolCall,
              sequence: record.sequence,
              timestamp: record.receivedAt,
              updatedAt: record.receivedAt,
            },
          }
          : event.toolCall
            ? { toolCall: event.toolCall }
            : {}),
      };
    default:
      return event;
  }
}
