import assert from "node:assert/strict";
import test from "node:test";
import { handleConfigRpcRequest } from "./rpc";

test("config RPC lists helms and updates context cache", async () => {
  let cached: unknown[] = [];
  const helms = [{ id: "local", name: "Local", url: "ws://127.0.0.1" }];

  const result = await handleConfigRpcRequest("helm/list", {}, {
    loadAvailableHelms: () => helms,
    setHelms: (items: unknown[]) => {
      cached = items;
    },
  } as any);

  assert.deepEqual(result, { helms });
  assert.equal(cached, helms);
});

test("config RPC lists projects and updates context cache", async () => {
  let cached: unknown[] = [];
  const projects = [{ id: "p1", name: "Project", helmId: "local" }];

  const result = await handleConfigRpcRequest("project/list", {}, {
    loadAvailableProjectsWithSemanticSummaries: async () => projects,
    setProjects: (items: unknown[]) => {
      cached = items;
    },
  } as any);

  assert.deepEqual(result, { projects });
  assert.equal(cached, projects);
});

test("config RPC reconnects an agent provider without prewarming a session", async () => {
  let reconnectCalled = false;
  const provider = { id: "codex", name: "Codex", command: "codex-acp" };
  const workspace = { id: "main", name: "main", path: "D:/repo" };
  const result = await handleConfigRpcRequest(
    "agent/reconnect",
    { providerId: "codex", workspaceId: "main" },
    {
      getAgents: () => [provider],
      getWorkspaces: () => [workspace],
      getProjects: () => [],
      resolveProviderById: (id: string) => (id === "codex" ? provider : undefined),
      reconnectAcpConnection: async () => {
        reconnectCalled = true;
        return {
          inventory: () => ({ runtimeConnectionId: "conn-1" }),
        };
      },
      logInfo: () => undefined,
      logError: () => undefined,
    } as any,
  );

  assert.equal(reconnectCalled, true);
  assert.deepEqual(result, {
    ok: true,
    providerId: "codex",
    workspaceId: "main",
    runtimeConnectionId: "conn-1",
    message: "ACP provider reconnected.",
  });
});
