import assert from "node:assert/strict";
import test from "node:test";
import type { FileDiffSummary } from "@tiller/shared";
import { createGitHydrationScheduler } from "./git-hydration-scheduler.js";

function waitForTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

test("git hydration scheduler coalesces one session and limits concurrent work", async () => {
  const started: string[] = [];
  const releases = new Map<string, (diffs: FileDiffSummary[]) => void>();
  const scheduler = createGitHydrationScheduler({
    debounceMs: 0,
    maxConcurrentHydrations: 2,
    readDiffs: (cwd) => new Promise<FileDiffSummary[]>((resolve) => {
      started.push(cwd);
      releases.set(cwd, resolve);
    }),
  });

  const first = scheduler.hydrate("session-1", "/one");
  const duplicate = scheduler.hydrate("session-1", "/one");
  const second = scheduler.hydrate("session-2", "/two");
  const third = scheduler.hydrate("session-3", "/three");

  assert.equal(first, duplicate);
  await waitForTimers();
  assert.deepEqual(started, ["/one", "/two"]);

  releases.get("/one")?.([]);
  await waitForTimers();
  assert.deepEqual(started, ["/one", "/two", "/three"]);

  releases.get("/two")?.([]);
  releases.get("/three")?.([]);
  await Promise.all([first, duplicate, second, third]);
  scheduler.dispose();
});

test("git hydration scheduler resolves cancelled work without retaining it", async () => {
  const scheduler = createGitHydrationScheduler({
    debounceMs: 50,
    readDiffs: async () => {
      throw new Error("should not start");
    },
  });
  const pending = scheduler.hydrate("session-1", "/one");
  scheduler.remove("session-1");
  assert.deepEqual(await pending, []);
  scheduler.dispose();
});
