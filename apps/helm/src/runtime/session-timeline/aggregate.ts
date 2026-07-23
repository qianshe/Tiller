import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import {
  appendMessageToSessionTimeline,
  appendToolCallToSessionTimeline,
  type SessionTimelineBatch,
  type SessionTimelineEntry,
} from "@tiller/shared";
import {
  buildSessionCompactionEntryFromProvider,
  upsertSessionCompactionEntry,
} from "../../sessions/compaction-entry";

export type SessionTimelineAggregate = {
  sessionId: string;
  lastSequence: number;
  deliverySequence: number;
  entries: SessionTimelineEntry[];
  providerId?: string;
};

export type SessionTimelineMutationIndex = {
  entryById: Map<string, SessionTimelineEntry>;
  toolEntryByCommandId: Map<string, SessionTimelineEntry>;
};

export function createSessionTimelineMutationIndex(
  entries: SessionTimelineEntry[] = [],
): SessionTimelineMutationIndex {
  const index = {
    entryById: new Map<string, SessionTimelineEntry>(),
    toolEntryByCommandId: new Map<string, SessionTimelineEntry>(),
  };
  rebuildSessionTimelineMutationIndex(index, entries);
  return index;
}

export function rebuildSessionTimelineMutationIndex(
  index: SessionTimelineMutationIndex,
  entries: SessionTimelineEntry[],
): void {
  index.entryById.clear();
  index.toolEntryByCommandId.clear();
  for (const entry of entries) {
    index.entryById.set(entry.id, entry);
    if (entry.kind === "tool_call" && entry.toolCall.commandId) {
      index.toolEntryByCommandId.set(entry.toolCall.commandId, entry);
    }
  }
}

export function createEmptySessionTimelineAggregate(
  sessionId: string,
  options?: { providerId?: string; lastSequence?: number },
): SessionTimelineAggregate {
  return {
    sessionId,
    lastSequence: options?.lastSequence ?? 0,
    deliverySequence: 0,
    entries: [],
    providerId: options?.providerId,
  };
}

// --- PLACEHOLDER_AGGREGATE_BODY ---

export function applySessionRuntimeEvent(
  aggregate: SessionTimelineAggregate,
  event: SessionRuntimeEvent,
): SessionTimelineAggregate {
  const entries = [...aggregate.entries];
  const next = { ...aggregate, entries };
  applySessionRuntimeEventToEntries(entries, event, next);
  return next;
}

export function applySessionRuntimeEventInPlace(
  aggregate: SessionTimelineAggregate,
  event: SessionRuntimeEvent,
  index?: SessionTimelineMutationIndex,
): SessionTimelineAggregate {
  applySessionRuntimeEventToEntries(aggregate.entries, event, aggregate, index);
  return aggregate;
}

function applySessionRuntimeEventToEntries(
  entries: SessionTimelineEntry[],
  event: SessionRuntimeEvent,
  aggregate: SessionTimelineAggregate,
  index?: SessionTimelineMutationIndex,
): void {
  switch (event.type) {
    case "message":
      applyMessageEvent(entries, aggregate, event, index);
      break;
    case "tool-call":
      applyToolCallEvent(entries, aggregate, event, index);
      return;
    case "command-output":
      applyCommandOutputEvent(entries, aggregate, event, index);
      break;
    case "compaction":
      applyCompactionEvent(entries, aggregate, event, index);
      break;
    default:
      return;
  }
}

export function buildSessionTimelineBatch(
  before: SessionTimelineAggregate,
  after: SessionTimelineAggregate,
  changedEntries: SessionTimelineEntry[] = after.entries,
): SessionTimelineBatch | null {
  if (after.entries.length === 0 && before.entries.length === 0) {
    return null;
  }
  if (after.deliverySequence === before.deliverySequence) {
    return null;
  }
  return {
    replace: false,
    deliverySequence: after.deliverySequence,
    lastSequence: after.lastSequence,
    entries: changedEntries,
  };
}

export function retainActiveSessionTimelineEntries(
  aggregate: SessionTimelineAggregate,
): SessionTimelineAggregate {
  let latestUnresolvedCompactionIndex = -1;
  for (let index = aggregate.entries.length - 1; index >= 0; index -= 1) {
    const entry = aggregate.entries[index];
    if (entry?.kind === "user_message") {
      break;
    }
    if (
      entry?.kind === "context_compaction" &&
      (entry.phase === "started" || !entry.summaryText)
    ) {
      latestUnresolvedCompactionIndex = index;
      break;
    }
  }

  const entries = aggregate.entries.filter((entry, index) => {
    if (entry.kind === "assistant_message") {
      return entry.streaming === true || entry.chunks.some((chunk) =>
        chunk.kind === "thinking" && chunk.status === "running"
      );
    }
    if (entry.kind === "tool_call") {
      return entry.toolCall.status === "pending" || entry.toolCall.status === "running";
    }
    return entry.kind === "context_compaction" && index === latestUnresolvedCompactionIndex;
  });
  return entries.length === aggregate.entries.length ? aggregate : { ...aggregate, entries };
}

function applyMessageEvent(
  entries: SessionTimelineEntry[],
  aggregate: SessionTimelineAggregate,
  event: Extract<SessionRuntimeEvent, { type: "message" }>,
  index?: SessionTimelineMutationIndex,
): void {
  const message = event.message;
  const sequence = message.sequence ?? nextSequence(aggregate);
  appendMessageToSessionTimeline(entries, { ...message, sequence });
  if (index) rebuildSessionTimelineMutationIndex(index, entries);
  aggregate.lastSequence = Math.max(aggregate.lastSequence, sequence);
  aggregate.deliverySequence += 1;
}

function applyToolCallEvent(
  entries: SessionTimelineEntry[],
  aggregate: SessionTimelineAggregate,
  event: Extract<SessionRuntimeEvent, { type: "tool-call" }>,
  index?: SessionTimelineMutationIndex,
): void {
  const { toolCall } = event;
  const sequence = toolCall.sequence ?? nextSequence(aggregate);
  const normalized = { ...toolCall, sequence };
  const id = `tool:${toolCall.id}`;
  const canAppendWithoutSearch =
    toolCall.kind !== "think" &&
    index !== undefined &&
    !index.entryById.has(id) &&
    (!toolCall.commandId || !index.toolEntryByCommandId.has(toolCall.commandId));
  if (canAppendWithoutSearch) {
    const entry: SessionTimelineEntry = {
      id,
      kind: "tool_call",
      toolCall: normalized,
      timestamp: toolCall.timestamp,
      updatedAt: toolCall.updatedAt,
      sequence,
    };
    entries.push(entry);
    index.entryById.set(id, entry);
    if (toolCall.commandId) index.toolEntryByCommandId.set(toolCall.commandId, entry);
  } else {
    appendToolCallToSessionTimeline(entries, normalized);
    if (index) rebuildSessionTimelineMutationIndex(index, entries);
  }
  aggregate.lastSequence = Math.max(aggregate.lastSequence, sequence);
  aggregate.deliverySequence += 1;
}

function applyCommandOutputEvent(
  entries: SessionTimelineEntry[],
  aggregate: SessionTimelineAggregate,
  event: Extract<SessionRuntimeEvent, { type: "command-output" }>,
  index?: SessionTimelineMutationIndex,
): void {
  const { chunk } = event;
  const sequence = chunk.sequence ?? nextSequence(aggregate);
  const entry: SessionTimelineEntry = {
    id: `output:${chunk.commandId}:${sequence ?? chunk.id}`,
    kind: "command_output",
    commandId: chunk.commandId,
    output: { ...chunk, sequence },
    timestamp: chunk.timestamp,
    updatedAt: chunk.timestamp,
    sequence,
  };
  entries.push(entry);
  index?.entryById.set(entry.id, entry);

  aggregate.lastSequence = Math.max(aggregate.lastSequence, sequence);
  aggregate.deliverySequence += 1;
}

function applyCompactionEvent(
  entries: SessionTimelineEntry[],
  aggregate: SessionTimelineAggregate,
  event: Extract<SessionRuntimeEvent, { type: "compaction" }>,
  index?: SessionTimelineMutationIndex,
): void {
  const compactionEntry = buildSessionCompactionEntryFromProvider({
    sessionId: aggregate.sessionId,
    timestamp: event.timestamp,
    providerId: aggregate.providerId,
    phase: event.phase,
    source: event.source,
    summaryText: event.summaryText,
    summaryMessageId: event.messageId,
  });
  upsertSessionCompactionEntry(entries, compactionEntry);
  if (index) rebuildSessionTimelineMutationIndex(index, entries);

  aggregate.deliverySequence += 1;
}

function nextSequence(aggregate: SessionTimelineAggregate) {
  return aggregate.lastSequence + 1;
}
