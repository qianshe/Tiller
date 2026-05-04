import assert from "node:assert/strict";
import test from "node:test";
import type { AcpAgentProvider } from "@tiller/shared";
import { createStore } from "zustand/vanilla";
import { createAgentsSlice, type AgentsSlice } from "./agents-slice.js";

function createTestStore() {
  return createStore<AgentsSlice>()((...args) => ({
    ...createAgentsSlice(...args),
  }));
}

const agent = (id: string): AcpAgentProvider => ({
  id,
  name: `Agent ${id}`,
  command: "codex-acp",
  args: [],
  transport: "stdio",
  protocol: "acp",
});

test("setAgents supports value and updater forms", () => {
  const store = createTestStore();

  store.getState().setAgents([agent("a1")]);
  store.getState().setAgents((current) => [...current, agent("a2")]);

  assert.deepEqual(store.getState().agents.map((item) => item.id), ["a1", "a2"]);
});

test("setAgentModelOptions caches model option entries", () => {
  const store = createTestStore();

  store.getState().setAgentModelOptions({
    a1: { loading: true, modelOptions: [], configOptions: [], state: {} },
  });
  store.getState().setAgentModelOptions((current) => ({
    ...current,
    a1: {
      loading: false,
      message: "loaded",
      modelOptions: [{ id: "gpt", name: "GPT", label: "GPT" }],
      configOptions: [],
      state: { model: "gpt" },
    },
  }));

  assert.equal(store.getState().agentModelOptions.a1?.message, "loaded");
  assert.equal(store.getState().agentModelOptions.a1?.state.model, "gpt");
});
