import assert from "node:assert/strict";
import test from "node:test";
import {
  extractAcpModelState,
  extractSessionConfigOptions,
  findSessionConfigOptionId,
  hasSessionConfigOptionIdValue,
  hasSessionConfigOptionValue,
  resolveCombinedSessionConfigState,
  resolveSessionConfigState,
} from "./config-events";

test("extractSessionConfigOptions flattens grouped option choices", () => {
  const options = extractSessionConfigOptions({
    configOptions: [
      {
        id: "model",
        name: "Model",
        category: "model",
        currentValue: "sonnet",
        options: [
          { group: "claude", options: [{ value: "opus", name: "Opus" }] },
        ],
      },
    ],
  });

  assert.deepEqual(options, [
    {
      id: "model",
      name: "Model",
      category: "model",
      currentValue: "sonnet",
      selectedValue: undefined,
      value: undefined,
      options: [{ value: "opus", label: "Opus", name: "Opus" }],
    },
  ]);
});

test("extractAcpModelState supports camel and snake model fields", () => {
  assert.deepEqual(extractAcpModelState({
    models: {
      current_model_id: "gpt-5.4",
      available_models: [
        { model_id: "gpt-5.4", name: "GPT 5.4", description: "fast" },
      ],
    },
  }), {
    currentModelId: "gpt-5.4",
    options: [{ id: "gpt-5.4", name: "GPT 5.4", description: "fast" }],
  });
});

test("resolveCombinedSessionConfigState keeps explicit config model before model state", () => {
  const options = extractSessionConfigOptions({
    configOptions: [
      { id: "mode", category: "mode", currentValue: "build" },
      { id: "model", category: "model", currentValue: "explicit-model" },
      { id: "thought", category: "thought_level", currentValue: "high" },
    ],
  });

  assert.deepEqual(resolveSessionConfigState(options), {
    agentMode: "build",
    model: "explicit-model",
    reasoningEffort: "high",
  });
  assert.deepEqual(resolveCombinedSessionConfigState(options, { currentModelId: "fallback-model", options: [] }), {
    agentMode: "build",
    model: "explicit-model",
    reasoningEffort: "high",
  });
  assert.equal(findSessionConfigOptionId(options, "model"), "model");
  assert.equal(hasSessionConfigOptionValue(options, "model", "explicit-model"), true);
  assert.equal(hasSessionConfigOptionIdValue(options, "model", "any-provider-string"), true);
});
