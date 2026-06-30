import type { SessionLiveStateSnapshot } from "@tiller/shared";

export type SessionLiveStateStore = {
  get(sessionId: string): SessionLiveStateSnapshot | undefined;
  patch(sessionId: string, update: Partial<SessionLiveStateSnapshot>): SessionLiveStateSnapshot;
  remove(sessionId: string): void;
};

export function createSessionLiveStateStore(): SessionLiveStateStore {
  const state = new Map<string, SessionLiveStateSnapshot>();

  return {
    get(sessionId) {
      return state.get(sessionId);
    },

    patch(sessionId, update) {
      const current = state.get(sessionId) ?? {};
      const next = { ...current, ...update };
      state.set(sessionId, next);
      return next;
    },

    remove(sessionId) {
      state.delete(sessionId);
    },
  };
}
