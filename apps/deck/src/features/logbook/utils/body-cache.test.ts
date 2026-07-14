import assert from "node:assert/strict";
import test from "node:test";
import { createHydratedBodyCache } from "./body-cache";

test("hydrated body cache evicts least recently used content by UTF-8 bytes", () => {
  const cache = createHydratedBodyCache(8);
  cache.set("a", "1234");
  cache.set("b", "5678");
  assert.equal(cache.get("a"), "1234");

  cache.set("c", "zzzz");

  assert.equal(cache.get("a"), "1234");
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("c"), "zzzz");
  assert.deepEqual(cache.stats(), { entries: 2, totalBytes: 8, maxBytes: 8 });
});

test("hydrated body cache refuses a single body larger than its budget", () => {
  const cache = createHydratedBodyCache(4);
  assert.equal(cache.set("large", "你好"), false);
  assert.equal(cache.get("large"), undefined);
  assert.equal(cache.stats().totalBytes, 0);
});
