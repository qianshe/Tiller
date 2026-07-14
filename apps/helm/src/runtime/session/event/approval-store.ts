import type {
  CanonicalApprovalState,
  CanonicalSessionState,
  SessionUpdateRecord,
} from "@tiller/shared";
import type { SessionApprovalStore } from "@tiller/persistence";
import {
  applyApprovalEvent,
  createApprovalState,
  type CanonicalApprovalEvent,
} from "./approval-reducer";

export type SessionApprovalStateStore = {
  get(sessionId: string): CanonicalApprovalState;
  commit(
    sessionId: string,
    event: CanonicalApprovalEvent,
    sequence: number,
    update: SessionUpdateRecord,
    sessionState: CanonicalSessionState,
  ): CanonicalApprovalState;
  remove(sessionId: string): void;
};

export function createSessionApprovalStateStore(
  persistence: SessionApprovalStore,
): SessionApprovalStateStore {
  const cache = new Map<string, CanonicalApprovalState>();

  function get(sessionId: string) {
    const cached = cache.get(sessionId);
    if (cached) {
      return cached;
    }
    const loaded = persistence.get(sessionId) ?? createApprovalState();
    cache.set(sessionId, loaded);
    return loaded;
  }

  return {
    get,
    commit(sessionId, event, sequence, update, sessionState) {
      const next = applyApprovalEvent(get(sessionId), event, sequence);
      persistence.commitUpdate(update, next, sessionState);
      cache.set(sessionId, next);
      return next;
    },
    remove(sessionId) {
      cache.delete(sessionId);
      persistence.remove(sessionId);
    },
  };
}
