import assert from "node:assert/strict";
import test from "node:test";
import type { SessionConfigOptionValue } from "@tiller/shared";
import type { AcpSessionConfigOption } from "../runtime-types";
import {
  resolveRequestedRuntimeSessionId,
  updateSessionConfigOptionValue,
  updateSessionConfigOptionValueById,
} from "./session-config";

test("resolveRequestedRuntimeSessionId prefers runtime id for loaded sessions", () => {
  assert.equal(
    resolveRequestedRuntimeSessionId({
      kind: "load",
      tillerSessionId: "tiller-1",
      runtimeSessionId: "runtime-1",
    }),
    "runtime-1",
  );
  assert.equal(
    resolveRequestedRuntimeSessionId({
      kind: "new",
      tillerSessionId: "tiller-2",
    }),
    "tiller-2",
  );
});

test("updateSessionConfigOptionValueById updates all value fields immutably", () => {
  const options = [
    { id: "mode", category: "mode", currentValue: "plan", selectedValue: "plan", value: "plan" },
    { id: "model", category: "model", currentValue: "small", selectedValue: "small", value: "small" },
  ] as AcpSessionConfigOption[];

  const next = updateSessionConfigOptionValueById(options, "mode", "build" satisfies SessionConfigOptionValue);

  assert.notEqual(next, options);
  assert.deepEqual(next[0], {
    id: "mode",
    category: "mode",
    currentValue: "build",
    selectedValue: "build",
    value: "build",
  });
  assert.equal(next[1], options[1]);
});

test("updateSessionConfigOptionValue matches categories case-insensitively", () => {
  const options = [
    { id: "reasoning", category: "Thought_Level", currentValue: "low", selectedValue: "low", value: "low" },
  ] as AcpSessionConfigOption[];

  const next = updateSessionConfigOptionValue(options, "thought_level", "high");

  assert.deepEqual(next[0], {
    id: "reasoning",
    category: "Thought_Level",
    currentValue: "high",
    selectedValue: "high",
    value: "high",
  });
});
