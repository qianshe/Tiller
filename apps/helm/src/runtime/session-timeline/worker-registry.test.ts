import assert from "node:assert/strict";
import test from "node:test";
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
