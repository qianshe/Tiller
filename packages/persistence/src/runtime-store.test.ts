import assert from "node:assert/strict";
import test from "node:test";
import { isStoredSessionRuntimeDescriptor } from "./runtime-store.js";

const descriptor = {
  sessionId: "session-1",
  providerId: "codex",
  runtimeSessionId: "runtime-1",
  capabilities: { sessionLoad: true },
  lastSeenAt: "2026-07-27T00:00:00.000Z",
  state: "resumeable",
};

test("runtime descriptor accepts an optional pending config marker", () => {
  assert.equal(isStoredSessionRuntimeDescriptor({
    ...descriptor,
    pendingConfig: {
      model: "opus",
      reasoningEffort: "high",
      configOptions: [{ configId: "web-search", value: true }],
    },
  }), true);
  assert.equal(isStoredSessionRuntimeDescriptor(descriptor), true);
});

test("runtime descriptor rejects an invalid pending config marker", () => {
  assert.equal(isStoredSessionRuntimeDescriptor({
    ...descriptor,
    pendingConfig: { reasoningEffort: "maximum" },
  }), false);
  assert.equal(isStoredSessionRuntimeDescriptor({
    ...descriptor,
    pendingConfig: { configOptions: [{ configId: "web-search", value: 1 }] },
  }), false);
});
