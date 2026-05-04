import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeHelmCards,
  resolveHelmConnectionState,
} from "./connection-helpers.js";

test("resolveHelmConnectionState prefers explicit per-helm state", () => {
  assert.equal(
    resolveHelmConnectionState(
      { key: "h1", isCurrent: true },
      "h1",
      "connected",
      { h1: "connecting" },
    ),
    "connecting",
  );
});

test("resolveHelmConnectionState falls back to global current connection", () => {
  assert.equal(
    resolveHelmConnectionState({ key: "h1", isCurrent: true }, "h1", "connected", {}),
    "connected",
  );
});

test("dedupeHelmCards keeps first cards by key", () => {
  assert.deepEqual(
    dedupeHelmCards([
      { key: "h1", isCurrent: true, label: "first" },
      { key: "h1", isCurrent: false, label: "second" },
      { key: "h2", isCurrent: false, label: "third" },
    ]).map((card) => card.label),
    ["first", "third"],
  );
});
