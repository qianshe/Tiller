import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("config RPC deletes a project and its configured workspaces", async () => {
  const configPath = join(mkdtempSync(join(tmpdir(), "tiller-config-")), "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      helms: [],
      projects: [
        {
          id: "p1",
          name: "Project",
          helmId: "local",
          workspaceIds: ["w1"],
          defaultWorkspaceId: "w1",
        },
      ],
      workspaces: [
        { id: "w1", name: "main", path: "D:/repo" },
        { id: "w2", name: "keep", path: "D:/keep" },
      ],
      agents: [],
    }),
  );
  let cachedProjects: unknown[] = [];
  let cachedWorkspaces: unknown[] = [];

  const result = await handleConfigRpcRequest("project/delete", { projectId: "p1" }, {
    configPath,
    loadAvailableProjectsWithSemanticSummaries: async () => [],
    loadAvailableWorkspaces: () => [{ id: "w2", name: "keep", path: "D:/keep" }],
    setProjects: (items: unknown[]) => {
      cachedProjects = items;
    },
    setWorkspaces: (items: unknown[]) => {
      cachedWorkspaces = items;
    },
  } as any);

  assert.deepEqual(result, {
    ok: true,
    projectId: "p1",
    message: `Deleted project from ${configPath}`,
  });
  assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).projects, []);
  assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).workspaces, [
    { id: "w2", name: "keep", path: "D:/keep" },
  ]);
  assert.deepEqual(cachedProjects, []);
  assert.deepEqual(cachedWorkspaces, [{ id: "w2", name: "keep", path: "D:/keep" }]);
});

test("config RPC deletes an agent and clears project defaults", async () => {
  const configPath = join(mkdtempSync(join(tmpdir(), "tiller-config-")), "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      helms: [],
      projects: [{ id: "p1", name: "Project", helmId: "local", defaultAgentId: "codex" }],
      workspaces: [],
      agents: [
        { id: "codex", name: "Codex", command: "codex", transport: "stdio", protocol: "acp" },
        { id: "keep", name: "Keep", command: "keep", transport: "stdio", protocol: "acp" },
      ],
    }),
  );
  let cachedAgents: unknown[] = [];
  let cachedProjects: unknown[] = [];

  const result = await handleConfigRpcRequest("agent/delete", { providerId: "codex" }, {
    configPath,
    loadAvailableAgents: () => [
      { id: "keep", name: "Keep", command: "keep", transport: "stdio", protocol: "acp" },
    ],
    loadAvailableProjectsWithSemanticSummaries: async () => [
      { id: "p1", name: "Project", helmId: "local" },
    ],
    setAgents: (items: unknown[]) => {
      cachedAgents = items;
    },
    setProjects: (items: unknown[]) => {
      cachedProjects = items;
    },
  } as any);

  assert.deepEqual(result, {
    ok: true,
    providerId: "codex",
    message: `Deleted provider from ${configPath}`,
  });
  assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).agents.map((agent: any) => agent.id), [
    "keep",
  ]);
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).projects[0].defaultAgentId, undefined);
  assert.deepEqual(cachedAgents.map((agent: any) => agent.id), ["keep"]);
  assert.deepEqual(cachedProjects, [{ id: "p1", name: "Project", helmId: "local" }]);
});
