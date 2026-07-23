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

  assert.equal(items[0]?.id, "acp:codex");
  assert.equal(items[0]?.label, "Codex");
  assert.equal(items[0]?.status, "已连接");
  assert.equal(items[0]?.runtimeSessionId, "1 个会话");
  assert.equal(items[0]?.children?.[0]?.projectName, "Repo");
  assert.equal(items[0]?.children?.[0]?.status, "1 个会话");
});

test("buildRuntimeOverviewItems merges one ACP agent across project worktrees", () => {
  const items = buildRuntimeOverviewItems({
    agentConnectionInventory: [
      {
        providerId: "codex",
        cwd: "D:/repo",
        status: "ready",
        activeSessionCount: 1,
        pendingSessionCount: 0,
        sessions: [
          { tillerSessionId: "s1", status: "running" },
          { tillerSessionId: "s2", status: "idle" },
        ],
      },
      {
        providerId: "codex",
        cwd: "D:/repo/.worktrees/feature",
        status: "ready",
        activeSessionCount: 1,
        pendingSessionCount: 0,
        sessions: [{ tillerSessionId: "s3", status: "running" }],
      },
    ],
    agents: [{ id: "codex", name: "Codex" }],
    worktrees: [
      { path: "D:/repo", name: "main" },
      { path: "D:/repo/.worktrees/feature", name: "feature" },
    ],
    sessions: [
      { id: "s1", projectId: "p1", projectName: "Repo", status: "running", worktreeName: "main" },
      { id: "s2", projectId: "p1", projectName: "Repo", status: "idle", worktreeName: "main" },
      { id: "s3", projectId: "p2", projectName: "Sandbox", status: "running", worktreeName: "feature" },
    ],
    projects: [
      { id: "p1", name: "Repo" },
      { id: "p2", name: "Sandbox" },
    ],
    statuses: { s1: "running", s2: "idle", s3: "running" },
    statusLabels: { running: "运行中", idle: "空闲" },
    pendingAcpReconnects: {},
    activeSession: {
      id: "s1",
      agentId: "codex",
      agentName: "Codex",
      cwd: "D:/repo",
      projectId: "p1",
      projectName: "Repo",
      status: "running",
      worktreeName: "main",
    },
    activeSessionRestoreGate: { canChat: true },
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, "acp:codex");
  assert.equal(items[0]?.meta, "2 个项目");
  assert.equal(items[0]?.runtimeSessionId, "3 个会话 · 2 活跃");
  assert.deepEqual(
    items[0]?.children?.map((child: any) => ({
      projectName: child.projectName,
      sessionCount: child.sessionCount,
      activeSessionCount: child.activeSessionCount,
      status: child.status,
    })),
    [
      { projectName: "Repo", sessionCount: 2, activeSessionCount: 1, status: "2 个会话 · 1 活跃" },
      { projectName: "Sandbox", sessionCount: 1, activeSessionCount: 1, status: "1 个会话" },
    ],
  );
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

test("buildRuntimeOverviewItems marks failed ACP restore as disconnected", () => {
  const items = buildRuntimeOverviewItems({
    agentConnectionInventory: [],
    agents: [{ id: "codex", name: "Codex" }],
    worktrees: [],
    sessions: [],
    projects: [],
    statuses: {},
    statusLabels: {},
    pendingAcpReconnects: {},
    activeSession: {
      id: "session-1",
      agentId: "codex",
      agentName: "Codex",
      cwd: "D:/repo",
      status: "idle",
    },
    activeSessionRestoreGate: { canChat: false, state: "failed" },
  });

  assert.equal(items[0]?.status, "未连接");
  assert.equal(items[0]?.canReconnect, true);
});

test("buildRuntimeOverviewItems marks a ready connection without the failed session as disconnected", () => {
  const items = buildRuntimeOverviewItems({
    agentConnectionInventory: [{
      providerId: "codex",
      cwd: "D:/repo",
      status: "ready",
      activeSessionCount: 0,
      sessions: [],
    }],
    agents: [{ id: "codex", name: "Codex" }],
    worktrees: [],
    sessions: [],
    projects: [],
    statuses: {},
    statusLabels: {},
    pendingAcpReconnects: {},
    activeSession: {
      id: "session-1",
      agentId: "codex",
      agentName: "Codex",
      cwd: "D:/repo",
      status: "idle",
    },
    activeSessionRestoreGate: { canChat: false, state: "failed" },
  });

  assert.equal(items[0]?.status, "未连接");
  assert.equal(items[0]?.canReconnect, true);
});
