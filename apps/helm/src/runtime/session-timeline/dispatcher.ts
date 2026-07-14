import type { SessionTimelineBatch, SessionUpdateRecord } from "@tiller/shared";
import type { SessionTimelineStore } from "@tiller/persistence";

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
      if (deps.store.commitBatch) {
        deps.store.commitBatch(sessionId, batch, updates);
      } else {
        if (updates.length) {
          throw new Error("Timeline store does not support atomic update commits.");
        }
        deps.store.applyBatch(sessionId, batch);
      }
      deps.publish(sessionId, batch);
    },
  };
}
