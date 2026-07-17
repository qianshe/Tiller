import type {
  SessionTimelineBatch,
  SessionTimelineEntry,
  SessionUpdateRecord,
} from "@tiller/shared";
import type { SessionTimelineStore } from "@tiller/persistence";
import { upsertSessionCompactionEntry } from "../../sessions/compaction-entry";

export type SessionTimelineDispatcherDeps = {
  store: SessionTimelineStore;
  publish: (sessionId: string, batch: SessionTimelineBatch) => void;
};

export type SessionTimelineDispatcher = {
  dispatch(
    sessionId: string,
    batch: SessionTimelineBatch,
    updates?: SessionUpdateRecord[],
  ): void;
};

export function createSessionTimelineDispatcher(
  deps: SessionTimelineDispatcherDeps,
): SessionTimelineDispatcher {
  return {
    dispatch(sessionId, batch, updates = []) {
      const reconciledBatch = batch.replace ||
          !batch.entries.some((entry) => entry.kind === "context_compaction")
        ? batch
        : reconcileCompactionBatch(deps.store.list(sessionId), batch);
      if (deps.store.commitBatch) {
        deps.store.commitBatch(sessionId, reconciledBatch, updates);
      } else {
        if (updates.length) {
          throw new Error("Timeline store does not support atomic update commits.");
        }
        deps.store.applyBatch(sessionId, reconciledBatch);
      }
      deps.publish(sessionId, reconciledBatch);
    },
  };
}

function reconcileCompactionBatch(
  persistedEntries: SessionTimelineEntry[],
  batch: SessionTimelineBatch,
): SessionTimelineBatch {
  const workingEntries = [...persistedEntries];
  let changed = false;
  const entries = batch.entries.map((entry) => {
    if (entry.kind === "context_compaction") {
      const reconciled = upsertSessionCompactionEntry(workingEntries, entry);
      changed ||= reconciled !== entry;
      return reconciled;
    }
    const existingIndex = workingEntries.findIndex((current) => current.id === entry.id);
    if (existingIndex === -1) {
      workingEntries.push(entry);
    } else {
      workingEntries[existingIndex] = entry;
    }
    return entry;
  });
  return changed ? { ...batch, entries } : batch;
}
