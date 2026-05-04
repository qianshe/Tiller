import assert from "node:assert/strict";
import test from "node:test";
import {
  daemonProfileToHelmSummary,
  mergeHelmSummariesByEndpoint,
} from "./daemon-helpers.js";

test("daemonProfileToHelmSummary converts string ports to numeric Helm summaries", () => {
  assert.deepEqual(
    daemonProfileToHelmSummary({
      id: "local",
      name: "Local",
      host: "127.0.0.1",
      port: "47631",
    }),
    { id: "local", name: "Local", host: "127.0.0.1", port: 47631 },
  );
});

test("mergeHelmSummariesByEndpoint keeps the last summary per endpoint", () => {
  const merged = mergeHelmSummariesByEndpoint([
    { id: "first", name: "First", host: "127.0.0.1", port: 47631 },
    { id: "second", name: "Second", host: "127.0.0.1", port: 47631 },
    { id: "third", name: "Third", host: "127.0.0.1", port: 47632 },
  ]);

  assert.deepEqual(
    merged.map((item) => item.id),
    ["second", "third"],
  );
});
