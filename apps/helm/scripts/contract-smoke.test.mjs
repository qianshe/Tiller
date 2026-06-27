import assert from "node:assert/strict";
import test from "node:test";
import {
  assertInventoryResultShapes,
  resolveContractSmokeTarget,
  summarizeInventoryResults,
} from "./contract-smoke.mjs";

test("resolveContractSmokeTarget derives HTTP root and WebSocket URL", () => {
  assert.deepEqual(resolveContractSmokeTarget("http://127.0.0.1:52725"), {
    httpRoot: "http://127.0.0.1:52725/",
    wsUrl: "ws://127.0.0.1:52725/",
  });
  assert.deepEqual(resolveContractSmokeTarget("https://example.test/tiller"), {
    httpRoot: "https://example.test/tiller/",
    wsUrl: "wss://example.test/tiller/",
  });
});

test("summarizeInventoryResults counts provider-free inventory arrays", () => {
  assert.deepEqual(
    summarizeInventoryResults({
      helmList: { helms: [{ id: "local" }] },
      projectList: { projects: [{ id: "project-1" }, { id: "project-2" }] },
      agentList: { agents: [] },
      sessionList: { sessions: [{ id: "session-1" }] },
    }),
    { helms: 1, projects: 2, agents: 0, sessions: 1 },
  );
});

test("assertInventoryResultShapes rejects malformed provider-free envelopes", () => {
  assert.throws(
    () => assertInventoryResultShapes({ helms: [] }, { projects: [] }, { agents: [] }, { notSessions: [] }),
    /session\/list result must include sessions array/,
  );
});
