import assert from "node:assert/strict";
import test from "node:test";
import { buildRuntimeOverviewItems } from "./runtime-overview";

test("buildRuntimeOverviewItems maps ACP connections with runtime sessions", () => {
  const items = buildRuntimeOverviewItems({
    agentConnectionInventory: [
      {
        providerId: "codex",
        cwd: "D:/repo",
        status: "ready",
        activeSessionCount: 2,
        pendingSessionCount: 1,
        sessions: [{ tillerSessionId: "s1", status: "running", model: "gpt", reasoningEffort: "high" }],
      },
    ],
    agents: [{ id: "codex", name: "Codex" }],
    worktrees: [{ path: "D:/repo", name: "feature/a" }],
    sessions: [{ id: "s1", projectId: "p1", projectName: "Repo", status: "running", worktreeName: "feature/a" }],
    projects: [{ id: "p1", name: "Repo" }],
    statuses: { s1: "running" },
    statusLabels: { running: "运行中" },
    pendingAcpReconnects: {},
  });

  assert.equal(items[0]?.id, "acp:codex:D:/repo");
  assert.equal(items[0]?.label, "Codex");
  assert.equal(items[0]?.status, "已连接");
  assert.equal(items[0]?.runtimeSessionId, "2 个会话 · 1 活跃");
  assert.equal(items[0]?.children?.[0]?.status, "运行中");
});

test("buildRuntimeOverviewItems adds disconnected agents as connectable", () => {
  const items = buildRuntimeOverviewItems({
    agentConnectionInventory: [],
    agents: [{ id: "codex", name: "Codex" }],
    worktrees: [],
    sessions: [],
    projects: [],
    statuses: {},
    statusLabels: {},
    pendingAcpReconnects: {},
    selectedCwd: "D:/repo",
    selectedProjectId: "p1",
  });

  assert.deepEqual(items, [
    {
      id: "acp:codex",
      agentId: "codex",
      projectId: "p1",
      cwd: "D:/repo",
      label: "Codex",
      meta: "暂无连接",
      status: "未连接",
      runtimeSessionId: "暂无连接",
      canConnect: true,
      canReconnect: false,
    },
  ]);
});
