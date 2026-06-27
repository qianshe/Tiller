import assert from "node:assert/strict";
import test from "node:test";
import type { SessionConfigOption } from "@tiller/shared";
import {
  applyConfigOptionValue,
  readConfigSelectionState,
  toConfigPatchState,
} from "./session-config-preferences";

const options: SessionConfigOption[] = [
  { id: "mode", category: "mode", currentValue: "build" },
  { id: "model", category: "model", currentValue: "gpt-5.4" },
  { id: "reasoning", category: "reasoning", currentValue: "medium" },
];

test("applyConfigOptionValue updates only the selected option", () => {
  const next = applyConfigOptionValue(options, "model", "gpt-5.5");

  assert.equal(next.find((option) => option.id === "model")?.currentValue, "gpt-5.5");
  assert.equal(next.find((option) => option.id === "mode")?.currentValue, "build");
});

test("readConfigSelectionState derives mode model and reasoning", () => {
  assert.deepEqual(readConfigSelectionState(options), {
    agentMode: "build",
    model: "gpt-5.4",
    reasoningEffort: "medium",
  });
});

test("toConfigPatchState normalizes provider default model", () => {
  assert.deepEqual(toConfigPatchState({
    agentMode: "plan",
    model: "provider-default",
    reasoningEffort: "high",
  }), {
    agentMode: "plan",
    model: undefined,
    reasoningEffort: "high",
  });
});
