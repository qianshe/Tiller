import assert from "node:assert/strict";
import test from "node:test";
import { createProviderLifecycle } from "./provider-lifecycle";

test("provider lifecycle delegates runtime creation and draft cleanup", async () => {
  const calls: string[] = [];
  const runtime = {
    runtimeSessionId: "runtime-1",
  };
  const agent = { id: "codex", name: "Codex" };
  const lifecycle = createProviderLifecycle({
    createRuntime: async (input: any) => {
      calls.push(`create:${input.sessionId}:${input.agent.id}`);
      return runtime as any;
    },
    cleanupDraftRuntime: async (inputRuntime: any, inputAgent: any) => {
      calls.push(`cleanup:${inputRuntime.runtimeSessionId}:${inputAgent.id}`);
      return { kind: "unsupported", message: "noop" } as any;
    },
  });

  const created = await lifecycle.createRuntime({
    sessionId: "session-1",
    worktree: { name: "main", path: "D:/repo" } as any,
    agent: agent as any,
    onEvent: () => undefined,
  });
  const cleanup = await lifecycle.cleanupDraftRuntime(created, agent as any);

  assert.equal(created, runtime);
  assert.deepEqual(cleanup, { kind: "unsupported", message: "noop" });
  assert.deepEqual(calls, ["create:session-1:codex", "cleanup:runtime-1:codex"]);
});
