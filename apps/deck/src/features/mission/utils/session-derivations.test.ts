import assert from "node:assert/strict";
import test from "node:test";
import type {
  HelmSummary,
  ProjectSummary,
  SessionSummary,
} from "@tiller/shared";
import {
  resolveActiveSessionId,
  resolveDefaultMissionSessionId,
  resolveDraftSelectionId,
  resolveMissionHelms,
  resolveProjectFilesScope,
  resolveModelOptionsFromConfig,
  resolvePromptPlaceholder,
  resolveSessionProjectId,
  resolveSessionTitle,
  toggleExpandedIdSet,
  resolveMissionSelectedProjectId,
} from "./session-derivations.js";

function buildSession(id: string, updatedAt: string): SessionSummary {
  return {
    id,
    projectId: "project-1",
    projectName: "Tiller",
    helmId: "helm-1",
    cwd: "D:/repo",
    worktreeName: "Tiller Worktree",
    agentId: "agent-1",
    agentName: "OpenCode",
    status: "idle",
    createdAt: updatedAt,
    updatedAt,
    messageCount: 0,
  };
}

test("resolveActiveSessionId preserves only an explicitly open live session", () => {
  const live = buildSession("session-live", "2026-04-27T11:00:00.000Z");

  assert.equal(resolveActiveSessionId(live.id, [live]), live.id);
  assert.equal(resolveActiveSessionId(null, [live]), null);
  assert.equal(resolveActiveSessionId("missing", [live]), null);
});

test("resolveDefaultMissionSessionId prefers a running session waiting for review", () => {
  const firstRunning = {
    ...buildSession("session-running", "2026-04-27T11:00:00.000Z"),
    status: "running" as const,
  };
  const pendingReview = {
    ...buildSession("session-review", "2026-04-27T10:00:00.000Z"),
    status: "waiting_for_permission" as const,
  };

  assert.equal(
    resolveDefaultMissionSessionId(null, [firstRunning, pendingReview]),
    "session-review",
  );
});

test("resolveDefaultMissionSessionId selects the first running session when no review is pending", () => {
  const idle = buildSession("session-idle", "2026-04-27T09:00:00.000Z");
  const firstRunning = {
    ...buildSession("session-running-1", "2026-04-27T10:00:00.000Z"),
    status: "running" as const,
  };
  const secondRunning = {
    ...buildSession("session-running-2", "2026-04-27T11:00:00.000Z"),
    status: "starting" as const,
  };

  assert.equal(
    resolveDefaultMissionSessionId(null, [idle, firstRunning, secondRunning]),
    "session-running-1",
  );
});

test("resolveDefaultMissionSessionId keeps a live explicit session and ignores idle-only lists", () => {
  const idle = buildSession("session-idle", "2026-04-27T09:00:00.000Z");
  const running = {
    ...buildSession("session-running", "2026-04-27T10:00:00.000Z"),
    status: "running" as const,
  };

  assert.equal(resolveDefaultMissionSessionId(idle.id, [idle, running]), idle.id);
  assert.equal(resolveDefaultMissionSessionId(null, [idle]), null);
});

test("resolveSessionProjectId keeps the session project binding authoritative", () => {
  const session = {
    ...buildSession("session-authoritative", "2026-04-27T10:00:00.000Z"),
    projectId: "project-alpha",
    projectName: "Alpha",
    cwd: "D:/shared",
  };
  const projects: ProjectSummary[] = [
    {
      id: "project-alpha",
      name: "Alpha",
      helmId: "helm-1",
      worktrees: [{ name: "alpha", path: "D:/alpha" }],
    },
    {
      id: "project-beta",
      name: "Beta",
      helmId: "helm-1",
      worktrees: [{ name: "shared", path: "D:/shared" }],
    },
  ];

  assert.equal(resolveSessionProjectId(session, projects), "project-alpha");
});

test("resolveSessionProjectId falls back for legacy sessions with unknown project ids", () => {
  const session = {
    ...buildSession("session-legacy", "2026-04-27T10:00:00.000Z"),
    projectId: "legacy-project",
    projectName: "Beta",
    cwd: "D:/beta",
  };
  const projects: ProjectSummary[] = [
    {
      id: "project-alpha",
      name: "Alpha",
      helmId: "helm-1",
      worktrees: [{ name: "alpha", path: "D:/alpha" }],
    },
    {
      id: "project-beta",
      name: "Beta",
      helmId: "helm-1",
      worktrees: [{ name: "beta", path: "D:/beta" }],
    },
  ];

  assert.equal(resolveSessionProjectId(session, projects), "project-beta");
});

test("toggleExpandedIdSet changes only expanded project folder membership", () => {
  const current = new Set(["project-alpha", "project-gamma"]);

  assert.deepEqual([...toggleExpandedIdSet(current, "project-alpha")].sort(), [
    "project-gamma",
  ]);
  assert.deepEqual([...toggleExpandedIdSet(current, "project-beta")].sort(), [
    "project-alpha",
    "project-beta",
    "project-gamma",
  ]);
  assert.deepEqual([...current].sort(), ["project-alpha", "project-gamma"]);
});

test("resolveSessionTitle uses the first meaningful 5 chars of the user prompt preview", () => {
  assert.equal(
    resolveSessionTitle(
      buildSession("session-1", "2026-04-27T10:00:00.000Z"),
      "【紧急】修复 session.message 日志",
    ),
    "紧急修复s",
  );
  assert.equal(
    resolveSessionTitle(
      buildSession("session-2", "2026-04-27T10:00:00.000Z"),
      "  你好！！！  ",
    ),
    "你好",
  );
});

test("resolveSessionTitle falls back to project task name when preview has no readable characters", () => {
  assert.equal(
    resolveSessionTitle(
      buildSession("session-1", "2026-04-27T10:00:00.000Z"),
      "!!! ---",
    ),
    "Tiller 任务",
  );
});

test("resolveDraftSelectionId preserves a valid manual selection instead of forcing the project default", () => {
  const available = [{ path: "D:/opencode" }, { path: "D:/codex" }];

  assert.equal(
    resolveDraftSelectionId("D:/codex", available, "D:/opencode"),
    "D:/codex",
  );
  assert.equal(
    resolveDraftSelectionId("missing", available, "D:/opencode"),
    "D:/opencode",
  );
  assert.equal(resolveDraftSelectionId(null, available, "missing"), "D:/opencode");
});

test("resolveModelOptionsFromConfig reads concrete ACP model choices from config options", () => {
  const options = resolveModelOptionsFromConfig("openai/gpt-5.4", [
    {
      id: "model-picker",
      category: "model",
      currentValue: "openai/gpt-5.4",
      options: [
        { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4" },
        { value: "openai/gpt-5.4", label: "GPT 5.4" },
      ],
    },
  ]);

  assert.deepEqual(options, ["anthropic/claude-sonnet-4", "openai/gpt-5.4"]);
});

test("resolveModelOptionsFromConfig prefers ACP config options over legacy model state", () => {
  const options = resolveModelOptionsFromConfig(
    "legacy/default",
    [
      {
        id: "model-picker",
        category: "model",
        currentValue: "openai/gpt-5.4",
        options: [
          { value: "openai/gpt-5.4", label: "GPT 5.4" },
          { value: "openai/gpt-5.4/high", label: "GPT 5.4 · High" },
        ],
      },
    ],
    [{ id: "legacy/default", name: "Legacy Default" }],
  );

  assert.deepEqual(options, ["openai/gpt-5.4", "openai/gpt-5.4/high"]);
});

test("resolveModelOptionsFromConfig falls back to current model when no option list is available", () => {
  const options = resolveModelOptionsFromConfig("gpt-5.5", [], []);

  assert.deepEqual(options, ["gpt-5.5"]);
});

test("resolveMissionHelms keeps configured helms even when they have no projects", () => {
  const connectedHelm: HelmSummary = {
    id: "local-helm",
    name: "Local Helm",
    host: "127.0.0.1",
    port: 47631,
  };
  const remoteHelm: HelmSummary = {
    id: "remote-helm",
    name: "Remote Helm",
    host: "127.0.0.2",
    port: 47632,
  };
  assert.deepEqual(
    resolveMissionHelms([connectedHelm, remoteHelm], connectedHelm.id),
    [connectedHelm, remoteHelm],
  );
});

test("resolveProjectFilesScope uses active session scope when a session is open", () => {
  const activeSession = {
    ...buildSession("session-1", "2026-04-27T10:00:00.000Z"),
    projectId: "session-project",
    cwd: "D:/session-worktree",
  };

  assert.deepEqual(
    resolveProjectFilesScope({
      activeSession,
      activeSessionProjectId: "resolved-session-project",
    }),
    {
      projectId: "resolved-session-project",
      cwd: "D:/session-worktree",
    },
  );
});

test("resolveProjectFilesScope ignores draft project before a session starts", () => {
  assert.deepEqual(
    resolveProjectFilesScope({
      activeSession: null,
      activeSessionProjectId: null,
    }),
    {
      projectId: null,
      cwd: null,
    },
  );
});

test("resolveMissionSelectedProjectId prefers the active session project over stale draft selection", () => {
  assert.equal(
    resolveMissionSelectedProjectId({
      activeSessionProjectId: "session-project",
      selectedProjectId: "draft-project",
    }),
    "session-project",
  );
});

test("resolveMissionSelectedProjectId highlights the draft project before a session starts", () => {
  assert.equal(
    resolveMissionSelectedProjectId({
      activeSessionProjectId: null,
      selectedProjectId: "draft-project",
    }),
    "draft-project",
  );
});

test("resolvePromptPlaceholder uses the selected ACP command as empty-editor hint", () => {
  assert.equal(
    resolvePromptPlaceholder({ command: "codex-acp" }),
    "向 codex-acp 下达指令；/ 调用命令",
  );
  assert.equal(
    resolvePromptPlaceholder({ command: "opencode", args: ["acp", "--pure"] }),
    "向 opencode acp --pure 下达指令；/ 调用命令",
  );
});
