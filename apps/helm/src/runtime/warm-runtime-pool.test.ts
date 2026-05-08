import assert from "node:assert/strict";
import test from "node:test";
import { createWarmRuntimePool } from "./warm-runtime-pool.js";

test("warm runtime pool reuses runtime by workspace and agent", () => {
  const pool = createWarmRuntimePool<string>();
  pool.set({ workspaceId: "w1", agentId: "codex" }, "runtime-1");
  assert.equal(pool.take({ workspaceId: "w1", agentId: "codex" }), "runtime-1");
  assert.equal(pool.take({ workspaceId: "w1", agentId: "codex" }), undefined);
});

test("warm runtime pool keeps workspace, agent, and config keys isolated", () => {
  const pool = createWarmRuntimePool<string>();
  pool.set({ workspaceId: "w1", agentId: "codex" }, "runtime-codex");
  pool.set({ workspaceId: "w1", agentId: "opencode" }, "runtime-opencode");
  pool.set({ workspaceId: "w1", agentId: "codex", configKey: "model=gpt" }, "runtime-codex-gpt");

  assert.equal(pool.get({ workspaceId: "w1", agentId: "codex" }), "runtime-codex");
  assert.equal(pool.get({ workspaceId: "w1", agentId: "opencode" }), "runtime-opencode");
  assert.equal(
    pool.get({ workspaceId: "w1", agentId: "codex", configKey: "model=gpt" }),
    "runtime-codex-gpt",
  );
  assert.equal(pool.size(), 3);
});
