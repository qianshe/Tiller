import assert from "node:assert/strict";
import test from "node:test";
import { createHelmContextState } from "./context";

test("createHelmContextState exposes mutable inventory accessors", () => {
  const state = createHelmContextState({
    helms: [{ id: "local" }],
    worktrees: [{ id: "worktree-1" }],
    agents: [{ id: "codex" }],
    projects: [{ id: "tiller" }],
  });

  assert.deepEqual(state.getHelms(), [{ id: "local" }]);
  state.setHelms([{ id: "remote" }]);
  assert.deepEqual(state.getHelms(), [{ id: "remote" }]);

  assert.deepEqual(state.getAgents(), [{ id: "codex" }]);
  state.setAgents([{ id: "claude" }]);
  assert.deepEqual(state.getAgents(), [{ id: "claude" }]);
});
