import assert from "node:assert/strict";
import test from "node:test";
import { createSessionLifecycle } from "./lifecycle.js";

test("createSessionLifecycle persists the created session through ports", async () => {
  const calls: string[] = [];
  const lifecycle = createSessionLifecycle({
    resolveProject: async (projectId) => {
      calls.push(`resolveProject:${projectId}`);
      return {
        id: projectId,
        name: "Project",
        helmId: "helm-1",
        worktrees: [{ path: "D:/repo", name: "main" }],
      };
    },
    resolveAgent: async (agentId) => {
      calls.push(`resolveAgent:${agentId}`);
      return {
        id: agentId,
        name: "Codex",
        command: "codex",
        transport: "stdio",
        protocol: "acp",
      };
    },
    createRuntime: async () => {
      calls.push("createRuntime");
      return {
        runtimeSessionId: "runtime-1",
        sessionConfigState: {},
        sessionConfigOptions: [],
        sessionModelState: {},
        sessionCapabilities: {},
      };
    },
    persistSession: async () => {
      calls.push("persistSession");
    },
    now: () => new Date("2026-05-28T00:00:00.000Z"),
  });

  const result = await lifecycle.createSession({
    sessionId: "session-1",
    projectId: "project-1",
    agentId: "codex",
    cwd: "D:/repo",
  });

  assert.equal(result.session.id, "session-1");
  assert.equal(result.session.projectName, "Project");
  assert.equal(result.session.agentName, "Codex");
  assert.equal(result.session.runtimeSessionId, "runtime-1");
  assert.deepEqual(calls, [
    "resolveProject:project-1",
    "resolveAgent:codex",
    "createRuntime",
    "persistSession",
  ]);
});
