import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { SessionTimelineBatch, SessionUpdateRecord } from "@tiller/shared";
import {
  applySessionRuntimeEventInPlace,
  buildSessionTimelineBatch,
  createEmptySessionTimelineAggregate,
  createSessionTimelineMutationIndex,
  rebuildSessionTimelineMutationIndex,
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
  let lastFlushed = { ...aggregate, entries: [...aggregate.entries] };
  let pendingUpdates: SessionUpdateRecord[] = [];
  let pendingEntries = new Map<string, import("@tiller/shared").SessionTimelineEntry>();
  const mutationIndex = createSessionTimelineMutationIndex();

  return {
    sessionId: options.sessionId,

    enqueue(event: SessionRuntimeEvent, update?: SessionUpdateRecord) {
      applySessionRuntimeEventInPlace(aggregate, event, mutationIndex);
      const changed = resolveChangedTimelineEntry(mutationIndex, aggregate.entries, event);
      if (changed) {
        pendingEntries.set(changed.id, changed);
      }
      if (event.type === "tool-call" && event.toolCall.commandId) {
        prunePendingEntries(pendingEntries, mutationIndex.entryById);
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
      rebuildSessionTimelineMutationIndex(mutationIndex, aggregate.entries);
      lastFlushed = { ...aggregate, entries: [...aggregate.entries] };
      return [{ batch, updates }];
    },

    aggregate() {
      return aggregate;
    },
  };
}

function resolveChangedTimelineEntry(
  index: ReturnType<typeof createSessionTimelineMutationIndex>,
  entries: SessionTimelineAggregate["entries"],
  event: SessionRuntimeEvent,
) {
  switch (event.type) {
    case "message":
      return index.entryById.get(event.message.id) ??
        entries.find((entry) => entry.id === event.message.id);
    case "tool-call": {
      const id = event.toolCall.kind === "think"
        ? stripThinkingSuffix(event.toolCall.commandId ?? event.toolCall.id)
        : `tool:${event.toolCall.id}`;
      const exact = index.entryById.get(id);
      if (exact || !event.toolCall.commandId) {
        return exact;
      }
      return index.toolEntryByCommandId.get(event.toolCall.commandId);
    }
    case "command-output":
      return entries[entries.length - 1];
    case "compaction":
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry?.kind === "context_compaction") return entry;
      }
      return undefined;
    default:
      return undefined;
  }
}

function prunePendingEntries(
  pendingEntries: Map<string, import("@tiller/shared").SessionTimelineEntry>,
  retainedEntries: Map<string, import("@tiller/shared").SessionTimelineEntry>,
): void {
  if (pendingEntries.size === 0) return;
  for (const id of pendingEntries.keys()) {
    if (!retainedEntries.has(id)) pendingEntries.delete(id);
  }
}

function stripThinkingSuffix(value: string) {
  return value.endsWith(":thinking") ? value.slice(0, -":thinking".length) : value;
}
