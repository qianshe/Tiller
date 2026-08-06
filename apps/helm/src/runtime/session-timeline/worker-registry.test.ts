import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import { createSessionTimelineWorkerRegistry } from "./worker-registry";

test("worker registry evicts idle hot session state while retaining recently touched sessions", () => {
  let now = 0;
  const registry = createSessionTimelineWorkerRegistry({ now: () => now });
  registry.forSession("idle-1");
  registry.forSession("idle-2");
  now = 1_000;
  registry.forSession("active");

  const removed = registry.evictIdle({ now: 2_000, idleMs: 1_500 });
  assert.deepEqual(removed.sort(), ["idle-1", "idle-2"]);
  assert.equal(registry.has("active"), true);
  assert.equal(registry.size(), 1);
});

test("worker registry flushes an idle worker before removing it", () => {
  let now = 0;
  const registry = createSessionTimelineWorkerRegistry({ now: () => now });
  const worker = registry.forSession("idle-flush");
  const calls: string[] = [];

  now = 2_000;
  const removed = registry.evictIdle({
    now,
    idleMs: 1_000,
    beforeRemove: (sessionId, candidate) => {
      calls.push(`${sessionId}:${candidate === worker ? "same" : "different"}`);
    },
  });

  assert.deepEqual(removed, ["idle-flush"]);
  assert.deepEqual(calls, ["idle-flush:same"]);
  assert.equal(registry.has("idle-flush"), false);
});

test("worker registry callback can flush pending aggregate before eviction", () => {
  let now = 0;
  const registry = createSessionTimelineWorkerRegistry({ now: () => now });
  const worker = registry.forSession("idle-aggregate");
  worker.enqueue({
    type: "message",
    message: {
      id: "assistant-idle-aggregate",
      role: "assistant",
      text: "pending aggregate",
      timestamp: "2026-07-27T00:00:00.000Z",
      streaming: false,
    },
  } satisfies SessionRuntimeEvent);

  now = 2_000;
  const removed = registry.evictIdle({
    now,
    idleMs: 1_000,
    beforeRemove: (_sessionId, candidate) => {
      const commits = candidate.flush();
      assert.equal(commits.length, 1);
      assert.equal(commits[0]?.batch.entries[0]?.kind, "assistant_message");
    },
  });

  assert.deepEqual(removed, ["idle-aggregate"]);
});
