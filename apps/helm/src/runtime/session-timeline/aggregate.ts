import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { SessionTimelineBatch, SessionTimelineEntry } from "@tiller/shared";
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
  if (entriesEqual(before.entries, after.entries)) {
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

  if (message.role === "assistant") {
    const baseId = message.id;
    const existingIndex = entries.findIndex(
      (e) => e.kind === "assistant_message" && e.id === baseId,
    );
    const chunkId = `${baseId}:content`;
    const chunk = {
      id: chunkId,
      kind: "content" as const,
      text: message.text,
      timestamp: message.timestamp,
      sequence,
      streaming: message.streaming,
    };
    if (existingIndex !== -1) {
      const existing = entries[existingIndex];
      if (existing?.kind === "assistant_message") {
        const chunkIndex = existing.chunks.findIndex((c) => c.kind === "content" && c.id === chunkId);
        const nextChunks = [...existing.chunks];
        if (chunkIndex !== -1) {
          nextChunks[chunkIndex] = chunk;
        } else {
          nextChunks.push(chunk);
        }
        entries[existingIndex] = {
          ...existing,
          chunks: nextChunks,
          updatedAt: message.timestamp,
          sequence: existing.sequence ?? sequence,
          streaming: message.streaming,
        };
      }
    } else {
      entries.push({
        id: baseId,
        kind: "assistant_message",
        chunks: [chunk],
        timestamp: message.timestamp,
        updatedAt: message.timestamp,
        sequence,
        streaming: message.streaming,
      });
    }
    return {
      ...aggregate,
      lastSequence: Math.max(aggregate.lastSequence, sequence),
      deliverySequence: aggregate.deliverySequence + 1,
      entries,
    };
  }

  const kind = message.role === "system" ? "system_message" as const : "user_message" as const;
  const existingIndex = entries.findIndex((e) => e.id === message.id && e.kind === kind);
  const entry = {
    id: message.id,
    kind,
    message: { ...message, sequence },
    timestamp: message.timestamp,
    updatedAt: message.timestamp,
    sequence,
  };
  if (existingIndex !== -1) {
    entries[existingIndex] = entry;
  } else {
    entries.push(entry);
  }
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

  if (toolCall.kind === "think") {
    return applyThinkingToolCall(aggregate, toolCall);
  }

  const sequence = toolCall.sequence ?? nextSequence(aggregate);
  const entryId = `tool:${toolCall.id}`;
  const entries = [...aggregate.entries];
  const existingIndex = entries.findIndex(
    (e) => e.kind === "tool_call" && (e.id === entryId || matchesToolCommand(e, toolCall)),
  );

  const entry = {
    id: entryId,
    kind: "tool_call" as const,
    toolCall: { ...toolCall, sequence },
    timestamp: toolCall.timestamp,
    updatedAt: toolCall.updatedAt,
    sequence,
  };

  if (existingIndex !== -1) {
    const current = entries[existingIndex];
    if (current?.kind === "tool_call") {
      entries[existingIndex] = mergeToolCallEntry(current, entry);
    } else {
      entries[existingIndex] = entry;
    }
  } else {
    entries.push(entry);
  }

  return {
    ...aggregate,
    lastSequence: Math.max(aggregate.lastSequence, sequence),
    deliverySequence: aggregate.deliverySequence + 1,
    entries,
  };
}

function applyThinkingToolCall(
  aggregate: SessionTimelineAggregate,
  toolCall: import("@tiller/shared").AgentToolCall,
): SessionTimelineAggregate {
  const sourceId = toolCall.commandId ?? toolCall.id;
  const assistantId = stripThinkingSuffix(sourceId) ?? stripThinkingSuffix(toolCall.id) ?? sourceId;
  const sequence = toolCall.sequence ?? nextSequence(aggregate);
  const entries = [...aggregate.entries];

  const existingIndex = entries.findIndex(
    (e) => e.kind === "assistant_message" && e.id === assistantId,
  );
  const chunk = {
    id: toolCall.id,
    kind: "thinking" as const,
    text: toolCall.output ?? toolCall.input ?? "",
    title: toolCall.title,
    status: toolCall.status,
    timestamp: toolCall.timestamp,
    updatedAt: toolCall.updatedAt,
    sequence,
  };

  if (existingIndex !== -1) {
    const existing = entries[existingIndex];
    if (existing?.kind === "assistant_message") {
      const chunkIndex = existing.chunks.findIndex((c) => c.kind === "thinking" && c.id === toolCall.id);
      const nextChunks = [...existing.chunks];
      if (chunkIndex !== -1) {
        nextChunks[chunkIndex] = chunk;
      } else {
        nextChunks.push(chunk);
      }
      entries[existingIndex] = {
        ...existing,
        chunks: nextChunks,
        updatedAt: toolCall.updatedAt,
        sequence: existing.sequence ?? sequence,
      };
    }
  } else {
    entries.push({
      id: assistantId,
      kind: "assistant_message",
      chunks: [chunk],
      timestamp: toolCall.timestamp,
      updatedAt: toolCall.updatedAt,
      sequence,
    });
  }

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
  if (event.phase === "started") {
    return aggregate;
  }

  const entries = [...aggregate.entries];
  const compactionEntry = buildSessionCompactionEntryFromProvider({
    sessionId: aggregate.sessionId,
    timestamp: event.timestamp,
    providerId: aggregate.providerId,
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

function stripThinkingSuffix(value: string) {
  return value.endsWith(":thinking") ? value.slice(0, -":thinking".length) : null;
}

function matchesToolCommand(
  entry: SessionTimelineEntry,
  toolCall: import("@tiller/shared").AgentToolCall,
) {
  if (entry.kind !== "tool_call") return false;
  const existing = entry.toolCall;
  if (existing.commandId && toolCall.commandId && existing.commandId === toolCall.commandId) return true;
  if (existing.commandId && existing.commandId === toolCall.id) return true;
  if (toolCall.commandId && toolCall.commandId === existing.id) return true;
  return false;
}

function matchesCommandId(entry: SessionTimelineEntry, commandId: string) {
  if (entry.kind !== "tool_call") return false;
  return entry.toolCall.id === commandId ||
    entry.toolCall.commandId === commandId;
}

function mergeToolCallEntry(
  current: Extract<SessionTimelineEntry, { kind: "tool_call" }>,
  incoming: Extract<SessionTimelineEntry, { kind: "tool_call" }>,
): Extract<SessionTimelineEntry, { kind: "tool_call" }> {
  return {
    ...incoming,
    id: current.id,
    toolCall: {
      ...current.toolCall,
      ...incoming.toolCall,
      id: current.toolCall.id,
      output: incoming.toolCall.output ?? current.toolCall.output,
      timestamp: current.toolCall.timestamp,
      sequence: current.toolCall.sequence ?? incoming.toolCall.sequence,
    },
    timestamp: current.timestamp,
    sequence: current.sequence ?? incoming.sequence,
  };
}

function entriesEqual(a: SessionTimelineEntry[], b: SessionTimelineEntry[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
