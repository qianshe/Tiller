import assert from "node:assert/strict";
import test from "node:test";
import * as agentReconnect from "./reconnect";

test("agent/reconnect reconnects provider with optional project workspace context", () => {
  assert.equal(agentReconnect.method, "agent/reconnect");
  agentReconnect.ParamsSchema.parse({
    providerId: "codex",
    projectId: "project-1",
    workspaceId: "main",
  });
  agentReconnect.ResultSchema.parse({
    ok: true,
    providerId: "codex",
    workspaceId: "main",
    runtimeConnectionId: "conn-1",
    message: "ACP provider reconnected.",
  });
});
