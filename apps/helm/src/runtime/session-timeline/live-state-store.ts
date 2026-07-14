import type {
  CanonicalSessionState,
  SessionLiveStateSnapshot,
  SessionUpdateRecord,
} from "@tiller/shared";
import type { SessionStateStore } from "@tiller/persistence";
import {
  applyCanonicalSessionStateEvent,
  createCanonicalSessionState,
  type CanonicalSessionStateEvent,
} from "../session/event/state-reducer";

export type SessionLiveStateStore = {
  get(sessionId: string): CanonicalSessionState | undefined;
  apply(
    sessionId: string,
    event: CanonicalSessionStateEvent,
    sequence: number,
  ): CanonicalSessionState;
  commit(
    sessionId: string,
    event: CanonicalSessionStateEvent,
    sequence: number,
    update: SessionUpdateRecord,
  ): CanonicalSessionState | undefined;
  adoptCommitted(sessionId: string, state: CanonicalSessionState): void;
  patch(
    sessionId: string,
    update: Partial<SessionLiveStateSnapshot>,
  ): CanonicalSessionState;
  remove(sessionId: string): void;
};

export function createSessionLiveStateStore(
  persistentStore?: SessionStateStore,
): SessionLiveStateStore {
  const state = new Map<string, CanonicalSessionState>();
  const loaded = new Set<string>();

  function getOrLoad(sessionId: string): CanonicalSessionState | undefined {
    const cached = state.get(sessionId);
    if (cached) {
      return cached;
    }
    if (loaded.has(sessionId)) {
      return undefined;
    }
    loaded.add(sessionId);
    const persisted = persistentStore?.get(sessionId);
    if (persisted) {
      state.set(sessionId, persisted);
    }
    return persisted;
  }

  function persist(sessionId: string, next: CanonicalSessionState): CanonicalSessionState {
    loaded.add(sessionId);
    persistentStore?.replace(sessionId, next);
    state.set(sessionId, next);
    return next;
  }

  return {
    get(sessionId) {
      return getOrLoad(sessionId);
    },

    apply(sessionId, event, sequence) {
      const current = getOrLoad(sessionId) ?? createCanonicalSessionState();
      const next = applyCanonicalSessionStateEvent(current, event, sequence);
      return persist(sessionId, next);
    },

    commit(sessionId, event, sequence, update) {
      if (!persistentStore) {
        return undefined;
      }
      const current = getOrLoad(sessionId) ?? createCanonicalSessionState();
      const next = applyCanonicalSessionStateEvent(current, event, sequence);
      persistentStore.commitUpdate(update, next);
      loaded.add(sessionId);
      state.set(sessionId, next);
      return next;
    },

    adoptCommitted(sessionId, committed) {
      loaded.add(sessionId);
      state.set(sessionId, committed);
    },

    patch(sessionId, update) {
      const current = getOrLoad(sessionId) ?? createCanonicalSessionState();
      const next = { ...current, ...update };
      return persist(sessionId, next);
    },

    remove(sessionId) {
      state.delete(sessionId);
      loaded.delete(sessionId);
      persistentStore?.remove(sessionId);
    },
  };
}
