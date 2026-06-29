import type { SessionTimelineBatch } from "@tiller/shared";
import type { SessionTimelineStore } from "@tiller/persistence";

export type SessionTimelineDispatcherDeps = {
  store: SessionTimelineStore;
  publish: (sessionId: string, batch: SessionTimelineBatch) => void;
};

export type SessionTimelineDispatcher = {
  dispatch(sessionId: string, batch: SessionTimelineBatch): void;
};

export function createSessionTimelineDispatcher(
  deps: SessionTimelineDispatcherDeps,
): SessionTimelineDispatcher {
  return {
    dispatch(sessionId, batch) {
      deps.store.applyBatch(sessionId, batch);
      deps.publish(sessionId, batch);
    },
  };
}
