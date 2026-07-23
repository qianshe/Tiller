import assert from "node:assert/strict";
import test from "node:test";
import type { SessionSummary } from "@tiller/shared";
import { createSessionBootstrapEvents } from "./bootstrap.js";

test("session bootstrap publishes configuration before the terminal status", () => {
  const summary = {
    id: "session-1",
    projectId: "project-1",
    projectName: "Tiller",
    agentId: "opencode",
    agentName: "OpenCode",
    cwd: "D:/repo",
    model: "cpa-oai/gpt-5.5",
    agentMode: "Sisyphus - Ultraworker",
    reasoningEffort: "xhigh",
    configOptions: [{
      id: "model",
      name: "Model",
      category: "model",
      currentValue: "cpa-oai/gpt-5.5",
      options: [{ value: "cpa-oai/gpt-5.5", label: "GPT-5.5" }],
    }],
    modelOptions: [{ id: "cpa-oai/gpt-5.5", name: "GPT-5.5" }],
    availableCommands: [{ name: "review", description: "Review changes" }],
    status: "idle",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  } as SessionSummary;

  const events = createSessionBootstrapEvents(summary);

  assert.deepEqual(events.map((event) => event.type), [
    "config-options",
    "model-options",
    "available-commands",
    "status",
  ]);
  assert.deepEqual(events[0], {
    type: "config-options",
    state: {
      agentMode: "Sisyphus - Ultraworker",
      model: "cpa-oai/gpt-5.5",
      reasoningEffort: "xhigh",
    },
    options: summary.configOptions,
  });
  assert.deepEqual(events.at(-1), { type: "status", status: "idle" });
});

test("session bootstrap omits configuration and inventories that were not loaded", () => {
  const events = createSessionBootstrapEvents({
    id: "session-1",
    projectId: "project-1",
    projectName: "Tiller",
    agentId: "claudecode",
    agentName: "ClaudeCode",
    cwd: "D:/repo",
    status: "idle",
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  } as SessionSummary);

  assert.deepEqual(events.map((event) => event.type), ["status"]);
});
