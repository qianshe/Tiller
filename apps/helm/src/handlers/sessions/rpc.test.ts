import assert from "node:assert/strict";
import test from "node:test";
import { handleSessionRpcNotification, handleSessionRpcRequest } from "./rpc";

test("session RPC lists paged sessions", async () => {
  const sessions = [{ id: "s1", updatedAt: "2026-05-06T00:00:00.000Z" }];
  const result = await handleSessionRpcRequest("session/list", { limit: 20 }, {
    sessionStore: { list: () => sessions },
    migrateStoredSessionSummary: (item: unknown) => item,
    logInfo: () => undefined,
  } as any);

  assert.deepEqual(result, {
    sessions,
    nextCursor: undefined,
    hasMore: false,
    before: undefined,
  });
});

test("session RPC notification cancels active runtime", async () => {
  let cancelled = false;
  const handled = await handleSessionRpcNotification("session/cancel", { sessionId: "s1" }, {
    sessions: new Map([["s1", { runtime: { cancel: () => { cancelled = true; } } }]]),
  } as any);

  assert.equal(handled, true);
  assert.equal(cancelled, true);
});

test("session/new waits for in-flight prewarmed runtime before creating a runtime", async () => {
  const project = {
    id: "project-1",
    name: "Tiller",
    helmId: "local-helm",
    workspaceIds: ["workspace-1"],
  };
  const workspace = {
    id: "workspace-1",
    name: "main",
    path: "D:/repo",
  };
  const agent = {
    id: "codex",
    name: "Codex",
  };
  const helm = {
    id: "local-helm",
    name: "Local Helm",
  };
  let createRuntimeCalled = false;
  let attachedSessionId: string | undefined;
  const runtime = {
    runtimeSessionId: "runtime-prewarmed",
    sessionConfigState: { model: "gpt-5.5" },
    sessionModelState: { options: [{ id: "gpt-5.5", name: "GPT-5.5" }] },
    sessionCapabilities: { sessionLoad: true },
  };
  const storedSessions: unknown[] = [];

  const result = await handleSessionRpcRequest("session/new", {
    projectId: project.id,
    workspaceId: workspace.id,
    agentId: agent.id,
    model: "gpt-5.5",
  }, {
    loadAvailableHelms: () => [helm],
    loadAvailableWorkspaces: () => [workspace],
    loadAvailableAgents: () => [agent],
    loadAvailableProjectsWithSemanticSummaries: async () => [project],
    setHelms: () => undefined,
    setWorkspaces: () => undefined,
    setAgents: () => undefined,
    setProjects: () => undefined,
    resolveProjectById: (id: string, projects: typeof project[]) => projects.find((item) => item.id === id),
    resolveProviderById: (id: string, agents: typeof agent[]) => agents.find((item) => item.id === id),
    resolveHelmById: (id: string, helms: typeof helm[]) => helms.find((item) => item.id === id),
    buildResumeInfo: () => ({ supported: false }),
    sessionStore: {
      upsert: (summary: unknown) => { storedSessions.push(summary); },
      list: () => storedSessions,
    },
    persistRuntimeDescriptor: () => undefined,
    broadcastNotification: () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
    takePrewarmedRuntime: async () => ({
      runtime,
      attach: (sessionId: string) => { attachedSessionId = sessionId; },
      cancel: () => undefined,
      expiresTimer: setTimeout(() => undefined, 1_000),
    }),
    createRuntime: async () => {
      createRuntimeCalled = true;
      throw new Error("session/new should reuse the in-flight prewarmed runtime");
    },
    hydrateSessionSummary: (summary: unknown) => summary,
    updateSessionSummary: () => undefined,
    sessions: new Map(),
  } as any) as { session: { id: string; runtimeSessionId: string; model?: string; status: string } };

  assert.equal(createRuntimeCalled, false);
  assert.equal(result.session.runtimeSessionId, "runtime-prewarmed");
  assert.equal(result.session.model, "gpt-5.5");
  assert.equal(result.session.status, "idle");
  assert.equal(attachedSessionId, result.session.id);
});
