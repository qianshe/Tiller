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

export const MAX_QUEUED_PROMPTS = 32;
export const MAX_PROMPT_QUEUE_ITEM_BYTES = 16 * 1024 * 1024;
export const MAX_PROMPT_QUEUE_SESSION_BYTES = 32 * 1024 * 1024;
export const PROMPT_QUEUE_CAPACITY_ERROR_CODE = "PROMPT_QUEUE_CAPACITY_EXCEEDED";

export class PromptQueueCapacityError extends Error {
  readonly code = PROMPT_QUEUE_CAPACITY_ERROR_CODE;

  constructor(message: string) {
    super(message);
    this.name = "PromptQueueCapacityError";
  }
}

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

function promptBytes(input: Pick<PromptQueueInput, "text" | "content">): number {
  let bytes = Buffer.byteLength(input.text, "utf8");
  for (const item of input.content ?? []) {
    if (item.type === "text") {
      bytes += Buffer.byteLength(item.text, "utf8");
      continue;
    }
    bytes += item.byteSize ?? (item.data ? Buffer.byteLength(item.data, "utf8") : 0);
    bytes += Buffer.byteLength(item.mimeType, "utf8");
    bytes += Buffer.byteLength(item.name ?? "", "utf8");
    bytes += Buffer.byteLength(item.uri ?? "", "utf8");
  }
  return bytes;
}

function stateBytes(state: QueueState): number {
  return (state.inFlight ? promptBytes(state.inFlight) : 0) + state.queued.reduce(
    (total, item) => total + promptBytes(item),
    0,
  );
}

function assertPromptBytes(input: Pick<PromptQueueInput, "text" | "content">): number {
  const bytes = promptBytes(input);
  if (bytes > MAX_PROMPT_QUEUE_ITEM_BYTES) {
    throw new PromptQueueCapacityError("Prompt exceeds the 16 MiB queue item limit.");
  }
  return bytes;
}

function assertSessionCapacity(state: QueueState, nextBytes: number, replacedBytes = 0): void {
  if (stateBytes(state) - replacedBytes + nextBytes > MAX_PROMPT_QUEUE_SESSION_BYTES) {
    throw new PromptQueueCapacityError("Prompt queue exceeds the 32 MiB session limit.");
  }
}

export function createSessionPromptQueueManager() {
  const states = new Map<string, QueueState>();

  function stateForWrite(sessionId: string): QueueState {
    let state = states.get(sessionId);
    if (!state) {
      state = { queued: [], draining: false };
      states.set(sessionId, state);
    }
    return state;
  }

  function stateForRead(sessionId: string): QueueState | undefined {
    return states.get(sessionId);
  }

  function clearEmptyState(sessionId: string, state: QueueState): void {
    if (!state.inFlight && state.queued.length === 0 && !state.draining) {
      states.delete(sessionId);
    }
  }

  function snapshot(sessionId: string): SessionPromptQueueSnapshot {
    const state = stateForRead(sessionId);
    return {
      sessionId,
      ...(state?.inFlight ? { inFlight: state.inFlight } : {}),
      queued: state ? [...state.queued] : [],
    };
  }

  return {
    hasInFlight(sessionId: string) {
      return Boolean(stateForRead(sessionId)?.inFlight);
    },
    enqueue(input: PromptQueueInput) {
      const state = stateForWrite(input.sessionId);
      if (state.queued.length >= MAX_QUEUED_PROMPTS) {
        throw new PromptQueueCapacityError("Prompt queue supports at most 32 queued prompts.");
      }
      const bytes = assertPromptBytes(input);
      assertSessionCapacity(state, bytes);
      const item = createQueuedPrompt(input, "queued");
      state.queued.push(item);
      return item;
    },
    markInFlight(input: PromptQueueInput) {
      const state = stateForWrite(input.sessionId);
      const bytes = assertPromptBytes(input);
      assertSessionCapacity(state, bytes);
      const item = createQueuedPrompt(input, "sending");
      state.inFlight = item;
      return item;
    },
    setInFlight(item: SessionQueuedPrompt) {
      const state = stateForWrite(item.sessionId);
      const bytes = assertPromptBytes(item);
      assertSessionCapacity(state, bytes, state.inFlight ? promptBytes(state.inFlight) : 0);
      state.inFlight = { ...item, status: "sending", updatedAt: nowIso() };
      return state.inFlight;
    },
    clearInFlight(sessionId: string, itemId?: string) {
      const state = stateForRead(sessionId);
      if (!state) {
        return;
      }
      if (!itemId || state.inFlight?.id === itemId) {
        state.inFlight = undefined;
      }
      clearEmptyState(sessionId, state);
    },
    takeNext(sessionId: string) {
      const state = stateForRead(sessionId);
      return state?.queued.shift();
    },
    updateQueuedPrompt(
      sessionId: string,
      queueItemId: string,
      patch: { text: string; content?: AgentPromptContent[] },
    ) {
      const state = stateForRead(sessionId);
      if (!state) {
        throw new Error("Queued prompt not found or already sending.");
      }
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
      const bytes = assertPromptBytes(next);
      assertSessionCapacity(state, bytes, promptBytes(current));
      state.queued[index] = next;
      return next;
    },
    deleteQueuedPrompt(sessionId: string, queueItemId: string) {
      const state = stateForRead(sessionId);
      if (!state) {
        throw new Error("Queued prompt not found or already sending.");
      }
      const before = state.queued.length;
      state.queued = state.queued.filter((item) => item.id !== queueItemId);
      if (state.queued.length === before) {
        throw new Error("Queued prompt not found or already sending.");
      }
      const result = snapshot(sessionId);
      clearEmptyState(sessionId, state);
      return result;
    },
    getQueuedPrompt(sessionId: string, queueItemId: string) {
      return stateForRead(sessionId)?.queued.find((item) => item.id === queueItemId);
    },
    remove(sessionId: string) {
      const state = stateForRead(sessionId);
      if (!state) {
        return [];
      }
      states.delete(sessionId);
      return [...state.queued, ...(state.inFlight ? [state.inFlight] : [])];
    },
    sessionIds() {
      return [...states.keys()];
    },
    isDraining(sessionId: string) {
      return stateForRead(sessionId)?.draining ?? false;
    },
    setDraining(sessionId: string, draining: boolean) {
      const state = draining ? stateForWrite(sessionId) : stateForRead(sessionId);
      if (!state) {
        return;
      }
      state.draining = draining;
      clearEmptyState(sessionId, state);
    },
    snapshot,
  };
}

export type SessionPromptQueueManager = ReturnType<typeof createSessionPromptQueueManager>;
