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
