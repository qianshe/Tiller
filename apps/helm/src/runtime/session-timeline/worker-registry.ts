import { createSessionTimelineWorker, type SessionTimelineWorker } from "./worker";

export type SessionTimelineWorkerRegistry = {
  forSession(sessionId: string, options?: { providerId?: string; lastSequence?: number }): SessionTimelineWorker;
  has(sessionId: string): boolean;
  remove(sessionId: string): void;
};

export function createSessionTimelineWorkerRegistry(): SessionTimelineWorkerRegistry {
  const workers = new Map<string, SessionTimelineWorker>();

  return {
    forSession(sessionId, options) {
      const existing = workers.get(sessionId);
      if (existing) return existing;
      const worker = createSessionTimelineWorker({
        sessionId,
        providerId: options?.providerId,
        lastSequence: options?.lastSequence,
      });
      workers.set(sessionId, worker);
      return worker;
    },

    has(sessionId) {
      return workers.has(sessionId);
    },

    remove(sessionId) {
      workers.delete(sessionId);
    },
  };
}
