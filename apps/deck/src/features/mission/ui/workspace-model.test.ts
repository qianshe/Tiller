import assert from "node:assert/strict";
import test from "node:test";
import { buildMissionWorkspaceModel } from "./workspace-model.js";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    prompt: "继续",
    promptImages: [],
    socketRef: { current: {} },
    activeSessionId: "session-1",
    selectedProjectId: "project-1",
    selectedWorkspaceId: "workspace-1",
    selectedAgentId: "codex",
    activeSession: {
      id: "session-1",
      status: "idle",
      projectId: "project-1",
      workspaceId: "workspace-1",
      workspaceName: "main",
      agentId: "codex",
      agentName: "Codex",
      resume: {
        state: "resume-available",
        mode: "same-process",
        restoreMethod: "client-reconnect",
      },
    },
    diffs: {},
    outputs: {},
    toolCalls: {},
    statuses: {},
    copy: {
      status: {
        idle: "空闲",
        starting: "启动中",
        running: "运行中",
        waiting_for_permission: "等待权限",
        error: "错误",
        cancelled: "已取消",
      },
    },
    customMissionPanelPages: [],
    selectedMissionPanelPageId: "overview",
    activeSessionProjectId: "project-1",
    activeSessionProject: { id: "project-1", name: "Tiller", helmId: "local" },
    draftProject: null,
    selectedWorkspace: { id: "workspace-1", name: "main", path: "D:/repo" },
    selectedDraftAgent: { id: "codex", name: "Codex" },
    activeSessionMessages: [],
    pendingPermission: null,
    missionHelms: [],
    effectiveMissionHelmId: "local",
    activeHelm: null,
    missionProjects: [{ id: "project-1", helmId: "local" }],
    workspaces: [{ id: "workspace-1", name: "main", path: "D:/repo" }],
    resumeStartRequestsRef: { current: new Set<string>() },
    ...overrides,
  } as any;
}

test("workspace model blocks sending while historical session is restoring", () => {
  const model = buildMissionWorkspaceModel(baseInput({
    activeSession: {
      ...baseInput().activeSession,
      resume: {
        state: "resume-available",
        mode: "reconnect",
        restoreMethod: "session/load",
      },
    },
    resumeStartRequestsRef: { current: new Set(["session-1"]) },
  }));

  assert.equal(model.canSend, false);
  assert.equal(model.activeSessionRestoreGate.state, "restoring");
  assert.match(model.activeSessionRestoreGate.message, /正在恢复 ACP 会话/);
});

test("workspace model allows sending once restored to same-process runtime", () => {
  const model = buildMissionWorkspaceModel(baseInput());

  assert.equal(model.canSend, true);
  assert.equal(model.activeSessionRestoreGate.canChat, true);
});

test("workspace model prefers matching cwd workspace over stale session worktree name", () => {
  const model = buildMissionWorkspaceModel(baseInput({
    activeSession: {
      ...baseInput().activeSession,
      workspaceId: "main",
      workspaceName: "main",
      workspacePath: "D:/repo",
    },
    workspaces: [
      {
        id: "codex/acp-session-performance-optimization",
        name: "codex/acp-session-performance-optimization",
        path: "D:/repo",
      },
    ],
  }));

  assert.equal(model.overviewWorkspaceName, "codex/acp-session-performance-optimization");
});
