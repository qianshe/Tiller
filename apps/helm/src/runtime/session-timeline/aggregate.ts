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
    entries: after.entries,
  };
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
  const entries = [...aggregate.entries];
  const matchIndex = entries.findIndex(
    (e) => e.kind === "tool_call" && matchesCommandId(e, chunk.commandId),
  );

  if (matchIndex === -1) {
    return aggregate;
  }

  const existing = entries[matchIndex];
  if (existing?.kind === "tool_call") {
    const currentOutput = existing.toolCall.output ?? "";
    entries[matchIndex] = {
      ...existing,
      toolCall: {
        ...existing.toolCall,
        output: currentOutput ? `${currentOutput}${chunk.text}` : chunk.text,
        stream: chunk.stream,
      },
      updatedAt: chunk.timestamp,
    };
  }

  return {
    ...aggregate,
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

function matchesCommandId(entry: SessionTimelineEntry, commandId: string) {
  if (entry.kind !== "tool_call") return false;
  return entry.toolCall.id === commandId ||
    entry.toolCall.commandId === commandId;
}
