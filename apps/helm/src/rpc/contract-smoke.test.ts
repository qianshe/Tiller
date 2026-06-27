import assert from "node:assert/strict";
import test from "node:test";
import type { AcpAgentProvider, HelmSummary, ProjectSummary, SessionSummary } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import { handleHelmRpcRequest } from "./router";

function createProviderFreeContext(): HelmHandlerContext {
  const helms: HelmSummary[] = [{ id: "local", name: "Local Helm", host: "127.0.0.1", port: 0 }];
  const projects: ProjectSummary[] = [{ id: "project-1", name: "Tiller", helmId: "local", worktrees: [] }];
  const agents: AcpAgentProvider[] = [
    { id: "codex", name: "Codex", command: "codex", args: [], transport: "stdio", protocol: "acp" },
  ];
  const sessions: SessionSummary[] = [
    {
      id: "session-1",
      projectId: "project-1",
      projectName: "Tiller",
      helmId: "local",
      cwd: "D:/repo",
      worktreeName: "main",
      agentId: "codex",
      agentName: "Codex",
      status: "idle",
      createdAt: "2026-05-27T00:00:00.000Z",
      updatedAt: "2026-05-27T00:00:00.000Z",
      messageCount: 0,
    },
  ];

  return {
    loadAvailableHelms: () => helms,
    setHelms: () => undefined,
    loadAvailableProjectsWithSemanticSummaries: async () => projects,
    setProjects: () => undefined,
    loadAvailableWorktrees: () => [],
    setWorktrees: () => undefined,
    loadAvailableAgents: () => agents,
    setAgents: () => undefined,
    sessionStore: { list: () => sessions },
    migrateStoredSessionSummary: (summary: SessionSummary) => summary,
    logInfo: () => undefined,
  } as unknown as HelmHandlerContext;
}

test("provider-free RPC contract smoke returns inventory envelopes", async () => {
  const context = createProviderFreeContext();

  assert.deepEqual(await handleHelmRpcRequest("helm/list", {}, context), {
    helms: [{ id: "local", name: "Local Helm", host: "127.0.0.1", port: 0 }],
  });
  assert.deepEqual(await handleHelmRpcRequest("project/list", {}, context), {
    projects: [{ id: "project-1", name: "Tiller", helmId: "local", worktrees: [] }],
  });
  assert.deepEqual(await handleHelmRpcRequest("agent/list", {}, context), {
    agents: [
      { id: "codex", name: "Codex", command: "codex", args: [], transport: "stdio", protocol: "acp" },
    ],
  });
  assert.deepEqual(await handleHelmRpcRequest("session/list", {}, context), {
    sessions: [
      {
        id: "session-1",
        projectId: "project-1",
        projectName: "Tiller",
        helmId: "local",
        cwd: "D:/repo",
        worktreeName: "main",
        agentId: "codex",
        agentName: "Codex",
        status: "idle",
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:00:00.000Z",
        messageCount: 0,
      },
    ],
    nextCursor: undefined,
    hasMore: false,
    before: undefined,
  });
});
