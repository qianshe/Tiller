import { createSessionTimelineWorker, type SessionTimelineWorker } from "./worker";

export type SessionTimelineWorkerRegistry = {
  forSession(sessionId: string, options?: { providerId?: string; lastSequence?: number }): SessionTimelineWorker;
  has(sessionId: string): boolean;
  remove(sessionId: string): void;
  evictIdle(options?: {
    now?: number;
    idleMs?: number;
    beforeRemove?: (sessionId: string, worker: SessionTimelineWorker) => void;
  }): string[];
  size(): number;
};

export function createSessionTimelineWorkerRegistry(options: { now?: () => number } = {}): SessionTimelineWorkerRegistry {
  const now = options.now ?? Date.now;
  const workers = new Map<string, { worker: SessionTimelineWorker; lastTouchedAt: number }>();

  return {
    forSession(sessionId, options) {
      const existing = workers.get(sessionId);
      if (existing) {
        existing.lastTouchedAt = now();
        return existing.worker;
      }
      const worker = createSessionTimelineWorker({
        sessionId,
        providerId: options?.providerId,
        lastSequence: options?.lastSequence,
      });
      workers.set(sessionId, { worker, lastTouchedAt: now() });
      return worker;
    },

    has(sessionId) {
      return workers.has(sessionId);
    },

    remove(sessionId) {
      workers.delete(sessionId);
    },

    evictIdle(options = {}) {
      const currentTime = options.now ?? now();
      const idleMs = options.idleMs ?? 5 * 60_000;
      const removed: string[] = [];
      for (const [sessionId, state] of workers) {
        if (currentTime - state.lastTouchedAt < idleMs) continue;
        options.beforeRemove?.(sessionId, state.worker);
        workers.delete(sessionId);
        removed.push(sessionId);
      }
      return removed;
    },

    size() {
      return workers.size;
    },
  };
}
