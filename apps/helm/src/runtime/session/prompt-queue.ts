import type {
  AgentPromptContent,
  SessionPromptQueueSnapshot,
  SessionQueuedPrompt,
} from "@tiller/shared";

export type PromptQueueInput = {
  sessionId: string;
  text: string;
  content?: AgentPromptContent[];
  clientMessageId: string;
};

type QueueState = {
  inFlight?: SessionQueuedPrompt;
  queued: SessionQueuedPrompt[];
  draining: boolean;
};

function nowIso() {
  return new Date().toISOString();
}

function createQueuedPrompt(
  input: PromptQueueInput,
  status: SessionQueuedPrompt["status"],
): SessionQueuedPrompt {
  const timestamp = nowIso();
  return {
    id: `${input.sessionId}-queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: input.sessionId,
    text: input.text,
    content: input.content,
    clientMessageId: input.clientMessageId,
    createdAt: timestamp,
    updatedAt: timestamp,
    status,
  };
}

export function createSessionPromptQueueManager() {
  const states = new Map<string, QueueState>();

  function stateFor(sessionId: string): QueueState {
    let state = states.get(sessionId);
    if (!state) {
      state = { queued: [], draining: false };
      states.set(sessionId, state);
    }
    return state;
  }

  function snapshot(sessionId: string): SessionPromptQueueSnapshot {
    const state = stateFor(sessionId);
    return {
      sessionId,
      inFlight: state.inFlight,
      queued: [...state.queued],
    };
  }

  return {
    hasInFlight(sessionId: string) {
      return Boolean(stateFor(sessionId).inFlight);
    },
    enqueue(input: PromptQueueInput) {
      const item = createQueuedPrompt(input, "queued");
      stateFor(input.sessionId).queued.push(item);
      return item;
    },
    markInFlight(input: PromptQueueInput) {
      const item = createQueuedPrompt(input, "sending");
      stateFor(input.sessionId).inFlight = item;
      return item;
    },
    setInFlight(item: SessionQueuedPrompt) {
      const state = stateFor(item.sessionId);
      state.inFlight = { ...item, status: "sending", updatedAt: nowIso() };
      return state.inFlight;
    },
    clearInFlight(sessionId: string, itemId?: string) {
      const state = stateFor(sessionId);
      if (!itemId || state.inFlight?.id === itemId) {
        state.inFlight = undefined;
      }
    },
    takeNext(sessionId: string) {
      return stateFor(sessionId).queued.shift();
    },
    updateQueuedPrompt(
      sessionId: string,
      queueItemId: string,
      patch: { text: string; content?: AgentPromptContent[] },
    ) {
      const state = stateFor(sessionId);
      const index = state.queued.findIndex((item) => item.id === queueItemId);
      if (index < 0) {
        throw new Error("Queued prompt not found or already sending.");
      }
      const current = state.queued[index] as SessionQueuedPrompt;
      const next: SessionQueuedPrompt = {
        ...current,
        text: patch.text,
        content: patch.content,
        updatedAt: nowIso(),
      };
      state.queued[index] = next;
      return next;
    },
    deleteQueuedPrompt(sessionId: string, queueItemId: string) {
      const state = stateFor(sessionId);
      const before = state.queued.length;
      state.queued = state.queued.filter((item) => item.id !== queueItemId);
      if (state.queued.length === before) {
        throw new Error("Queued prompt not found or already sending.");
      }
      return snapshot(sessionId);
    },
    isDraining(sessionId: string) {
      return stateFor(sessionId).draining;
    },
    setDraining(sessionId: string, draining: boolean) {
      stateFor(sessionId).draining = draining;
    },
    snapshot,
  };
}

export type SessionPromptQueueManager = ReturnType<typeof createSessionPromptQueueManager>;
