import assert from "node:assert/strict";
import test from "node:test";
import { buildMissionWorktreeModel } from "./workspace-model.js";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    prompt: "继续",
    promptImages: [],
    socketRef: { current: {} },
    activeSessionId: "session-1",
    selectedProjectId: "project-1",
    selectedCwd: "D:/repo",
    selectedAgentId: "codex",
    activeSession: {
      id: "session-1",
      status: "idle",
      projectId: "project-1",
      cwd: "D:/repo",
      worktreeName: "main",
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
    selectedWorktree: { name: "main", path: "D:/repo" },
    selectedDraftAgent: { id: "codex", name: "Codex" },
    activeSessionMessages: [],
    pendingPermission: null,
    missionHelms: [],
    effectiveMissionHelmId: "local",
    activeHelm: null,
    missionProjects: [{ id: "project-1", helmId: "local" }],
    worktrees: [{ name: "main", path: "D:/repo" }],
    resumeStartRequestsRef: { current: new Set<string>() },
    ...overrides,
  } as any;
}

test("worktree model blocks sending while historical session is restoring", () => {
  const model = buildMissionWorktreeModel(baseInput({
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

test("worktree model allows sending once restored to same-process runtime", () => {
  const model = buildMissionWorktreeModel(baseInput());

  assert.equal(model.canSend, true);
  assert.equal(model.activeSessionRestoreGate.canChat, true);
});

test("worktree model blocks new-session sends while draft runtime is still prewarming", () => {
  const model = buildMissionWorktreeModel(baseInput({
    activeSession: null,
    activeSessionId: null,
    draftModelLoading: true,
  }));

  assert.equal(model.canSend, false);
});

test("worktree model prefers matching cwd worktree over stale session worktree name", () => {
  const model = buildMissionWorktreeModel(baseInput({
    activeSession: {
      ...baseInput().activeSession,
      worktreeName: "main",
      cwd: "D:/repo",
    },
    worktrees: [
      {
        name: "codex/acp-session-performance-optimization",
        path: "D:/repo",
      },
    ],
  }));

  assert.equal(model.overviewWorktreeName, "codex/acp-session-performance-optimization");
});
