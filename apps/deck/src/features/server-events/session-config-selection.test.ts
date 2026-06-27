import assert from "node:assert/strict";
import test from "node:test";
import {
  applySessionConfigSelection,
  deriveConfigOptionMapsFromSessions,
  resolveSessionConfigSelection,
} from "./session-config-selection";

test("resolveSessionConfigSelection reads model mode and reasoning from options", () => {
  const selection = resolveSessionConfigSelection(undefined, undefined, [
    { id: "mode", category: "mode", currentValue: "build" },
    { id: "model", category: "model", currentValue: "gpt" },
    { id: "thought", category: "thought_level", currentValue: "high" },
  ] as any);

  assert.deepEqual(selection, {
    agentMode: "build",
    model: "gpt",
    reasoningEffort: "high",
  });
});

test("resolveSessionConfigSelection removes stale reasoning when options no longer include reasoning", () => {
  const selection = resolveSessionConfigSelection(
    { model: "old", reasoningEffort: "high" } as any,
    { model: "new" } as any,
    [{ id: "model", category: "model", currentValue: "new" }] as any,
  );

  assert.deepEqual(selection, { model: "new" });
});

test("applySessionConfigSelection writes selected values into options", () => {
  const options = applySessionConfigSelection([
    { id: "model", category: "model", currentValue: "old" },
    { id: "thought", category: "thought_level", currentValue: "low" },
  ] as any, { model: "new", reasoningEffort: "high" } as any);

  assert.equal(options[0]?.currentValue, "new");
  assert.equal(options[1]?.currentValue, "high");
});

test("deriveConfigOptionMapsFromSessions returns maps only for sessions with options", () => {
  const maps = deriveConfigOptionMapsFromSessions([
    { id: "s1", model: "gpt", configOptions: [{ id: "model", category: "model", currentValue: "old" }] },
    { id: "s2", configOptions: [] },
  ] as any);

  assert.deepEqual(maps, {
    s1: [{ id: "model", category: "model", currentValue: "gpt" }],
  });
});
