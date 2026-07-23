type RuntimeSessionState = {
  sequence: number;
  sequenceInitialized: boolean;
  values: Map<string, unknown>;
};

export type SessionRuntimeEventState = {
  allocateSequence(sessionId: string): number;
  ensureSequence(sessionId: string, sequences: ReadonlyArray<number | undefined>): void;
  isSequenceInitialized(sessionId: string): boolean;
  peekSequence(sessionId: string): number;
  get<T>(sessionId: string, key: string): T | undefined;
  has(sessionId: string, key: string): boolean;
  remove(sessionId: string): void;
  sessionIds(): string[];
  seedSequence(sessionId: string, sequences: ReadonlyArray<number | undefined>): void;
  set<T>(sessionId: string, key: string, value: T): void;
  delete(sessionId: string, key: string): void;
};

function maxValidSequence(sequences: ReadonlyArray<number | undefined>) {
  return sequences.reduce<number>((max, value) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
      return max;
    }
    return Math.max(max, value);
  }, 0);
}

export function createSessionRuntimeEventState(): SessionRuntimeEventState {
  const sessions = new Map<string, RuntimeSessionState>();

  function getOrCreate(sessionId: string) {
    let state = sessions.get(sessionId);
    if (!state) {
      state = { sequence: 0, sequenceInitialized: false, values: new Map() };
      sessions.set(sessionId, state);
    }
    return state;
  }

  return {
    allocateSequence(sessionId) {
      const state = getOrCreate(sessionId);
      state.sequence += 1;
      return state.sequence;
    },
    ensureSequence(sessionId, sequences) {
      const state = getOrCreate(sessionId);
      if (state.sequenceInitialized) {
        return;
      }
      state.sequence = Math.max(state.sequence, maxValidSequence(sequences));
      state.sequenceInitialized = true;
    },
    isSequenceInitialized(sessionId) {
      return sessions.get(sessionId)?.sequenceInitialized ?? false;
    },
    peekSequence(sessionId) {
      return sessions.get(sessionId)?.sequence ?? 0;
    },
    get<T>(sessionId: string, key: string) {
      return sessions.get(sessionId)?.values.get(key) as T | undefined;
    },
    has(sessionId, key) {
      return sessions.get(sessionId)?.values.has(key) ?? false;
    },
    remove(sessionId) {
      sessions.delete(sessionId);
    },
    sessionIds() {
      return [...sessions.keys()];
    },
    seedSequence(sessionId, sequences) {
      const state = getOrCreate(sessionId);
      state.sequence = Math.max(state.sequence, maxValidSequence(sequences));
      state.sequenceInitialized = true;
    },
    set<T>(sessionId: string, key: string, value: T) {
      getOrCreate(sessionId).values.set(key, value);
    },
    delete(sessionId, key) {
      const state = sessions.get(sessionId);
      if (!state) {
        return;
      }
      state.values.delete(key);
      if (state.sequence === 0 && state.values.size === 0) {
        sessions.delete(sessionId);
      }
    },
  };
}
