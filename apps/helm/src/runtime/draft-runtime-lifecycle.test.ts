import assert from "node:assert/strict";
import test from "node:test";
import { performDraftRuntimeCleanup } from "./draft-runtime-lifecycle";

test("performDraftRuntimeCleanup delegates provider cleanup once and logs ownership details", async () => {
  const calls: string[] = [];
  const logs: string[] = [];
  const draft = {
    draftId: "draft-1",
    deckClientId: "deck-1",
    runtime: { runtimeSessionId: "runtime-1" },
    agent: { id: "codex" },
  } as never;

  const cleanup = await performDraftRuntimeCleanup({
    draft,
    reason: "user",
    activeDrafts: 0,
    cleanupDraftRuntime: async (runtime: any, agent: any) => {
      calls.push(`${runtime.runtimeSessionId}:${agent.id}`);
      return { kind: "success", message: "deleted" };
    },
    logInfo: (message) => logs.push(message),
  });

  assert.deepEqual(cleanup, { kind: "success", message: "deleted" });
  assert.deepEqual(calls, ["runtime-1:codex"]);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /draft\.discard draft=draft-1/);
  assert.match(logs[0], /cleanup=success/);
});
