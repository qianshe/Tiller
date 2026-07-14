import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { SessionTimelineBatch, SessionUpdateRecord } from "@tiller/shared";
import {
  applySessionRuntimeEvent,
  buildSessionTimelineBatch,
  createEmptySessionTimelineAggregate,
  retainActiveSessionTimelineEntries,
  type SessionTimelineAggregate,
} from "./aggregate";

export type SessionTimelineWorker = {
  sessionId: string;
  enqueue(event: SessionRuntimeEvent, update?: SessionUpdateRecord): void;
  flush(): SessionTimelineCommit[];
  aggregate(): SessionTimelineAggregate;
};

export type SessionTimelineCommit = {
  batch: SessionTimelineBatch;
  updates: SessionUpdateRecord[];
};

export type SessionTimelineWorkerOptions = {
  sessionId: string;
  providerId?: string;
  lastSequence?: number;
};

export function createSessionTimelineWorker(
  options: SessionTimelineWorkerOptions,
): SessionTimelineWorker {
  let aggregate = createEmptySessionTimelineAggregate(options.sessionId, {
    providerId: options.providerId,
    lastSequence: options.lastSequence,
  });
  let lastFlushed = aggregate;
  let pendingUpdates: SessionUpdateRecord[] = [];
  let pendingEntries = new Map<string, import("@tiller/shared").SessionTimelineEntry>();

  return {
    sessionId: options.sessionId,

    enqueue(event: SessionRuntimeEvent, update?: SessionUpdateRecord) {
      aggregate = applySessionRuntimeEvent(aggregate, event);
      const retainedIds = new Set(aggregate.entries.map((entry) => entry.id));
      for (const id of pendingEntries.keys()) {
        if (!retainedIds.has(id)) {
          pendingEntries.delete(id);
        }
      }
      const changed = resolveChangedTimelineEntry(aggregate, event);
      if (changed) {
        pendingEntries.set(changed.id, changed);
      }
      if (update) {
        pendingUpdates.push(update);
      }
    },

    flush(): SessionTimelineCommit[] {
      const batch = buildSessionTimelineBatch(
        lastFlushed,
        aggregate,
        [...pendingEntries.values()],
      );
      if (!batch) {
        return [];
      }
      const updates = pendingUpdates;
      pendingUpdates = [];
      pendingEntries = new Map();
      aggregate = retainActiveSessionTimelineEntries(aggregate);
      lastFlushed = aggregate;
      return [{ batch, updates }];
    },

    aggregate() {
      return aggregate;
    },
  };
}

function resolveChangedTimelineEntry(
  aggregate: SessionTimelineAggregate,
  event: SessionRuntimeEvent,
) {
  switch (event.type) {
    case "message":
      return aggregate.entries.find((entry) => entry.id === event.message.id);
    case "tool-call": {
      const id = event.toolCall.kind === "think"
        ? stripThinkingSuffix(event.toolCall.commandId ?? event.toolCall.id)
        : `tool:${event.toolCall.id}`;
      const exact = aggregate.entries.find((entry) => entry.id === id);
      if (exact || !event.toolCall.commandId) {
        return exact;
      }
      return aggregate.entries.find((entry) =>
        entry.kind === "tool_call" &&
        entry.toolCall.commandId === event.toolCall.commandId
      );
    }
    case "command-output":
      return aggregate.entries.find((entry) =>
        entry.kind === "command_output" &&
        entry.output.id === event.chunk.id
      );
    case "compaction":
      return [...aggregate.entries].reverse().find((entry) =>
        entry.kind === "context_compaction"
      );
    default:
      return undefined;
  }
}

function stripThinkingSuffix(value: string) {
  return value.endsWith(":thinking") ? value.slice(0, -":thinking".length) : value;
}
