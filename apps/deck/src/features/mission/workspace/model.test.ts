import assert from "node:assert/strict";
import test from "node:test";
import { buildMissionWorktreeModel } from "./model.js";

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
    selectedMissionDisplayTabId: "graph",
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

test("worktree model keeps ACP restoration separate from model loading", () => {
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
    draftModelLoading: false,
  }));

  assert.equal(model.composerModelLoading, false);
  assert.equal(model.composerSessionRestoring, true);
});


test("worktree model allows sending once restored to same-process runtime", () => {
  const model = buildMissionWorktreeModel(baseInput());

  assert.equal(model.canSend, true);
  assert.equal(model.activeSessionRestoreGate.canChat, true);
});

test("worktree model keeps composer send enabled for a focused idle session even if another session is restoring", () => {
  const active = {
    ...baseInput().activeSession,
    id: "session-1",
    status: "idle",
    resume: {
      state: "resume-available",
      mode: "reconnect",
      restoreMethod: "session/load",
    },
  };
  const focused = {
    ...baseInput().activeSession,
    id: "session-2",
    status: "idle",
    resume: {
      state: "resume-available",
      mode: "same-process",
      restoreMethod: "client-reconnect",
    },
  };
  const model = buildMissionWorktreeModel(baseInput({
    activeSessionId: active.id,
    activeSession: active,
    composerSession: focused,
    statuses: {
      [active.id]: "idle",
      [focused.id]: "idle",
    },
    resumeStartRequestsRef: { current: new Set([active.id]) },
  }));

  assert.equal(model.canSend, true);
});

test("worktree model does not expose cancel-only composer state for a focused idle session", () => {
  const active = {
    ...baseInput().activeSession,
    id: "session-1",
    status: "running",
  };
  const focused = {
    ...baseInput().activeSession,
    id: "session-2",
    status: "idle",
  };
  const model = buildMissionWorktreeModel(baseInput({
    activeSessionId: active.id,
    activeSession: active,
    composerSession: focused,
    statuses: {
      [active.id]: "running",
      [focused.id]: "idle",
    },
  }));

  assert.equal(model.sessionExecutionPending, false);
});

test("worktree model blocks new-session sends while draft runtime is still prewarming", () => {
  const model = buildMissionWorktreeModel(baseInput({
    activeSession: null,
    activeSessionId: null,
    draftModelLoading: true,
  }));

  assert.equal(model.canSend, false);
});

test("worktree model allows new-session sends before draft runtime is ready", () => {
  const model = buildMissionWorktreeModel(baseInput({
    activeSession: null,
    activeSessionId: null,
    draftModelLoading: false,
    agentModelOptions: {},
  }));

  assert.equal(model.canSend, true);
});

test("worktree model allows new-session sends once draft runtime is ready", () => {
  const model = buildMissionWorktreeModel(baseInput({
    activeSession: null,
    activeSessionId: null,
    draftModelLoading: false,
    agentModelOptions: {
      "codex::D:/repo::project-1": {
        loading: false,
        warmed: true,
        draftId: "draft-codex-1",
        runtimeSessionId: "runtime-1",
        modelOptions: [],
        configOptions: [],
        state: {},
      },
    },
  }));

  assert.equal(model.canSend, true);
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

test("worktree model uses the active session project worktrees for inspector scope", () => {
  const activeSessionProject = {
    id: "project-1",
    name: "Tiller",
    helmId: "local",
    path: "D:/repo",
    worktrees: [
      { name: "main", path: "D:/repo" },
      { name: "test-worktree", path: "D:/repo/.worktrees/test-worktree" },
    ],
  };
  const model = buildMissionWorktreeModel(baseInput({
    selectedProjectId: "project-stale",
    activeSession: {
      ...baseInput().activeSession,
      projectId: "project-1",
      cwd: "D:/repo/.worktrees/test-worktree",
    },
    activeSessionProjectId: "project-1",
    activeSessionProject,
    missionProjects: [
      activeSessionProject,
      {
        id: "project-stale",
        name: "Other",
        helmId: "local",
        path: "D:/other",
        worktrees: [{ name: "other", path: "D:/other/.worktrees/other" }],
      },
    ],
  }));

  assert.deepEqual(
    model.filteredWorktrees.map((worktree: { name: string }) => worktree.name),
    ["main", "test-worktree"],
  );
});

test("worktree model merges canonical timeline history with live tool activity", () => {
  const model = buildMissionWorktreeModel(baseInput({
    activeSession: {
      ...baseInput().activeSession,
      status: "running",
    },
    statuses: {
      "session-1": "running",
    },
    sessionTimeline: {
      "session-1": [
        {
          id: "tool:call-1",
          kind: "tool_call",
          toolCall: {
            id: "call-1",
            kind: "read",
            title: "Read",
            status: "completed",
            timestamp: "2026-07-09T10:00:01.000Z",
            updatedAt: "2026-07-09T10:00:01.000Z",
            sequence: 1,
          },
          timestamp: "2026-07-09T10:00:01.000Z",
          updatedAt: "2026-07-09T10:00:01.000Z",
          sequence: 1,
        },
        {
          id: "output:call-1:2",
          kind: "command_output",
          commandId: "call-1",
          output: {
            id: "output-1",
            commandId: "call-1",
            stream: "stdout",
            text: "historical stdout",
            timestamp: "2026-07-09T10:00:02.000Z",
            sequence: 2,
          },
          timestamp: "2026-07-09T10:00:02.000Z",
          updatedAt: "2026-07-09T10:00:02.000Z",
          sequence: 2,
        },
      ],
    },
    toolCalls: {
      "session-1": [
        {
          id: "call-2",
          kind: "shell",
          title: "Shell",
          status: "running",
          timestamp: "2026-07-09T10:00:03.000Z",
          updatedAt: "2026-07-09T10:00:03.000Z",
          sequence: 3,
        },
      ],
    },
    outputs: {
      "session-1": [
        {
          id: "output-2",
          commandId: "call-2",
          stream: "stdout",
          text: "live stdout",
          timestamp: "2026-07-09T10:00:04.000Z",
          sequence: 4,
        },
      ],
    },
  }));

  assert.deepEqual(
    model.activeToolCalls.map((toolCall: { id: string; status: string }) => [toolCall.id, toolCall.status]),
    [
      ["call-1", "completed"],
      ["call-2", "running"],
    ],
  );
  assert.deepEqual(
    model.activeOutputs.map((output: { id: string }) => output.id),
    ["output-1", "output-2"],
  );
});

test("worktree model tolerates missing session-scoped maps", () => {
  assert.doesNotThrow(() =>
    buildMissionWorktreeModel(baseInput({
      diffs: undefined,
      outputs: undefined,
      toolCalls: undefined,
      statuses: undefined,
    })),
  );
});
