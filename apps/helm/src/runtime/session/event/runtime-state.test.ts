import assert from "node:assert/strict";
import test from "node:test";
import { createSessionRuntimeEventState } from "./runtime-state.js";

test("runtime event state scopes sequences and cleanup to one session", () => {
  const state = createSessionRuntimeEventState();

  state.seedSequence("session-a", [2, undefined, 7]);
  assert.equal(state.allocateSequence("session-a"), 8);
  assert.equal(state.allocateSequence("session-b"), 1);

  state.set("session-a", "pending-output", { text: "buffered" });
  state.remove("session-a");

  assert.equal(state.get("session-a", "pending-output"), undefined);
  assert.equal(state.allocateSequence("session-a"), 1);
  assert.equal(state.allocateSequence("session-b"), 2);
});
