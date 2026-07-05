import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { SessionTimelineDispatcher } from "./dispatcher";
import type { SessionTimelineWorkerRegistry } from "./worker-registry";

const DEFAULT_FLUSH_WINDOW_MS = 32;
const DEFAULT_FLUSH_CHAR_THRESHOLD = 256;

type TimerHandle = ReturnType<typeof setTimeout>;

type PendingFlushState = {
  bufferedChars: number;
  timer: TimerHandle | null;
};

export type SessionTimelineFlushScheduler = {
  schedule(sessionId: string, event: SessionRuntimeEvent): void;
  flushNow(sessionId: string): void;
  remove(sessionId: string): void;
  dispose(): void;
};

export type SessionTimelineFlushSchedulerDeps = {
  workers: SessionTimelineWorkerRegistry;
  dispatcher: SessionTimelineDispatcher;
  windowMs?: number;
  charThreshold?: number;
  setTimeoutFn?: (callback: () => void, delay: number) => TimerHandle;
  clearTimeoutFn?: (handle: TimerHandle) => void;
};

export function createSessionTimelineFlushScheduler(
  deps: SessionTimelineFlushSchedulerDeps,
): SessionTimelineFlushScheduler {
  const windowMs = deps.windowMs ?? DEFAULT_FLUSH_WINDOW_MS;
  const charThreshold = deps.charThreshold ?? DEFAULT_FLUSH_CHAR_THRESHOLD;
  const setTimeoutFn =
    deps.setTimeoutFn ??
    ((callback: () => void, delay: number) => setTimeout(callback, delay));
  const clearTimeoutFn =
    deps.clearTimeoutFn ?? ((handle: TimerHandle) => clearTimeout(handle));
  const pendingBySession = new Map<string, PendingFlushState>();

  function clearPendingTimer(state: PendingFlushState) {
    if (state.timer !== null) {
      clearTimeoutFn(state.timer);
      state.timer = null;
    }
  }

  function remove(sessionId: string) {
    const pending = pendingBySession.get(sessionId);
    if (!pending) {
      return;
    }
    clearPendingTimer(pending);
    pendingBySession.delete(sessionId);
  }

  function flushNow(sessionId: string) {
    remove(sessionId);
    if (!deps.workers.has(sessionId)) {
      return;
    }
    const worker = deps.workers.forSession(sessionId);
    const batches = worker.flush();
    for (const batch of batches) {
      deps.dispatcher.dispatch(sessionId, batch);
    }
  }

  function ensurePending(sessionId: string) {
    const existing = pendingBySession.get(sessionId);
    if (existing) {
      return existing;
    }
    const created: PendingFlushState = {
      bufferedChars: 0,
      timer: null,
    };
    pendingBySession.set(sessionId, created);
    return created;
  }

  return {
    schedule(sessionId, event) {
      const pending = ensurePending(sessionId);
      pending.bufferedChars += resolveBufferedCharCount(event);

      if (
        shouldFlushImmediately(event) ||
        pending.bufferedChars >= charThreshold ||
        windowMs <= 0
      ) {
        flushNow(sessionId);
        return;
      }

      if (pending.timer !== null) {
        return;
      }

      pending.timer = setTimeoutFn(() => {
        flushNow(sessionId);
      }, windowMs);
    },

    flushNow,

    remove,

    dispose() {
      for (const sessionId of [...pendingBySession.keys()]) {
        remove(sessionId);
      }
    },
  };
}

function shouldFlushImmediately(event: SessionRuntimeEvent) {
  switch (event.type) {
    case "message":
      if (event.message.role === "user") {
        return true;
      }
      return event.message.streaming !== true;
    case "tool-call":
      if (event.toolCall.kind === "think") {
        return event.toolCall.status !== "running";
      }
      return true;
    case "command-output":
      return false;
    case "compaction":
      return true;
    default:
      return true;
  }
}

function resolveBufferedCharCount(event: SessionRuntimeEvent) {
  switch (event.type) {
    case "message":
      return event.message.text.length;
    case "tool-call":
      if (event.toolCall.kind !== "think") {
        return 0;
      }
      return (event.toolCall.output ?? event.toolCall.input ?? "").length;
    case "command-output":
      return event.chunk.text.length;
    default:
      return 0;
  }
}
