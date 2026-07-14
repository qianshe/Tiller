import type { FileDiffSummary } from "@tiller/shared";
import { readWorktreeGitDiffs } from "../../sessions/facade";

const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_MAX_CONCURRENT_HYDRATIONS = 2;

type PendingHydration = {
  sessionId: string;
  cwd: string;
  promise: Promise<FileDiffSummary[]>;
  resolve: (diffs: FileDiffSummary[]) => void;
  timer?: ReturnType<typeof setTimeout>;
  cancelled: boolean;
};

export type GitHydrationScheduler = {
  hydrate(sessionId: string, cwd: string): Promise<FileDiffSummary[]>;
  remove(sessionId: string): void;
  dispose(): void;
};

export function createGitHydrationScheduler(options: {
  readDiffs?: (cwd: string) => Promise<FileDiffSummary[]>;
  debounceMs?: number;
  maxConcurrentHydrations?: number;
} = {}): GitHydrationScheduler {
  const readDiffs = options.readDiffs ?? readWorktreeGitDiffs;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxConcurrent = options.maxConcurrentHydrations ?? DEFAULT_MAX_CONCURRENT_HYDRATIONS;
  const pendingBySession = new Map<string, PendingHydration>();
  const ready: PendingHydration[] = [];
  let active = 0;

  function schedule(pending: PendingHydration): void {
    pending.timer = setTimeout(() => {
      pending.timer = undefined;
      if (pending.cancelled) {
        return;
      }
      ready.push(pending);
      drain();
    }, debounceMs);
  }

  function drain(): void {
    while (active < maxConcurrent && ready.length > 0) {
      const pending = ready.shift();
      if (!pending || pending.cancelled) {
        continue;
      }
      active += 1;
      void readDiffs(pending.cwd)
        .catch(() => [])
        .then((diffs) => {
          pending.resolve(pending.cancelled ? [] : diffs);
        })
        .finally(() => {
          active -= 1;
          if (pendingBySession.get(pending.sessionId) === pending) {
            pendingBySession.delete(pending.sessionId);
          }
          drain();
        });
    }
  }

  function remove(sessionId: string): void {
    const pending = pendingBySession.get(sessionId);
    if (!pending) {
      return;
    }
    pending.cancelled = true;
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = undefined;
    }
    pendingBySession.delete(sessionId);
    pending.resolve([]);
  }

  return {
    hydrate(sessionId, cwd) {
      const existing = pendingBySession.get(sessionId);
      if (existing) {
        return existing.promise;
      }
      let resolve!: (diffs: FileDiffSummary[]) => void;
      const promise = new Promise<FileDiffSummary[]>((nextResolve) => {
        resolve = nextResolve;
      });
      const pending: PendingHydration = {
        sessionId,
        cwd,
        promise,
        resolve,
        cancelled: false,
      };
      pendingBySession.set(sessionId, pending);
      schedule(pending);
      return promise;
    },
    remove,
    dispose() {
      for (const sessionId of [...pendingBySession.keys()]) {
        remove(sessionId);
      }
    },
  };
}
