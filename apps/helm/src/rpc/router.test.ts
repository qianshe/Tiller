import assert from "node:assert/strict";
import test from "node:test";
import { handleHelmRpcRequest } from "./router";

test("router validates params before dispatch", async () => {
  await assert.rejects(() => handleHelmRpcRequest("session/prompt", { sessionId: "s1" }, {} as any));
});

test("router dispatches helm/list to config handler", async () => {
  const result = await handleHelmRpcRequest("helm/list", {}, {
    loadAvailableHelms: () => [],
    setHelms: () => undefined,
  } as any);

  assert.deepEqual(result, { helms: [] });
});
