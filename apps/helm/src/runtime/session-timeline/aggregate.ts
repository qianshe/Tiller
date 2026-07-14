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
  switch (event.type) {
    case "message":
      return applyMessageEvent(aggregate, event);
    case "tool-call":
      return applyToolCallEvent(aggregate, event);
    case "command-output":
      return applyCommandOutputEvent(aggregate, event);
    case "compaction":
      return applyCompactionEvent(aggregate, event);
    default:
      return aggregate;
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
  aggregate: SessionTimelineAggregate,
  event: Extract<SessionRuntimeEvent, { type: "message" }>,
): SessionTimelineAggregate {
  const message = event.message;
  const sequence = message.sequence ?? nextSequence(aggregate);
  const entries = [...aggregate.entries];
  appendMessageToSessionTimeline(entries, { ...message, sequence });
  return {
    ...aggregate,
    lastSequence: Math.max(aggregate.lastSequence, sequence),
    deliverySequence: aggregate.deliverySequence + 1,
    entries,
  };
}

function applyToolCallEvent(
  aggregate: SessionTimelineAggregate,
  event: Extract<SessionRuntimeEvent, { type: "tool-call" }>,
): SessionTimelineAggregate {
  const { toolCall } = event;
  const sequence = toolCall.sequence ?? nextSequence(aggregate);
  const entries = [...aggregate.entries];
  appendToolCallToSessionTimeline(entries, { ...toolCall, sequence });

  return {
    ...aggregate,
    lastSequence: Math.max(aggregate.lastSequence, sequence),
    deliverySequence: aggregate.deliverySequence + 1,
    entries,
  };
}

function applyCommandOutputEvent(
  aggregate: SessionTimelineAggregate,
  event: Extract<SessionRuntimeEvent, { type: "command-output" }>,
): SessionTimelineAggregate {
  const { chunk } = event;
  const sequence = chunk.sequence ?? nextSequence(aggregate);
  const entries = [...aggregate.entries];
  entries.push({
    id: `output:${chunk.commandId}:${sequence ?? chunk.id}`,
    kind: "command_output",
    commandId: chunk.commandId,
    output: { ...chunk, sequence },
    timestamp: chunk.timestamp,
    updatedAt: chunk.timestamp,
    sequence,
  });

  return {
    ...aggregate,
    lastSequence: Math.max(aggregate.lastSequence, sequence),
    deliverySequence: aggregate.deliverySequence + 1,
    entries,
  };
}

function applyCompactionEvent(
  aggregate: SessionTimelineAggregate,
  event: Extract<SessionRuntimeEvent, { type: "compaction" }>,
): SessionTimelineAggregate {
  const entries = [...aggregate.entries];
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

  return {
    ...aggregate,
    deliverySequence: aggregate.deliverySequence + 1,
    entries,
  };
}

function nextSequence(aggregate: SessionTimelineAggregate) {
  return aggregate.lastSequence + 1;
}
