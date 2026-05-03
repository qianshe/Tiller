import assert from "node:assert/strict";
import test from "node:test";
import type { HelmSummary, ProjectSummary, SessionSummary } from "@tiller/shared";
import {
  applySessionListSnapshot,
  resolveActiveSessionId,
  resolveDraftSelectionId,
  resolveMissionHelms,
  resolveProjectFilesScope,
  resolveModelOptionsFromConfig,
  resolvePromptPlaceholder,
  resolveSessionProjectId,
  resolveSessionTitle,
  toggleExpandedIdSet,
  resolveMissionSelectedProjectId,
} from "./sessions.js";

function buildSession(id: string, updatedAt: string): SessionSummary {
  return {
    id,
    projectId: "project-1",
    projectName: "Tiller",
    helmId: "helm-1",
    workspaceId: "workspace-1",
    workspaceName: "Tiller Workspace",
    agentId: "agent-1",
    agentName: "OpenCode",
    status: "idle",
    createdAt: updatedAt,
    updatedAt,
    messageCount: 0,
  };
}

test("applySessionListSnapshot removes stale session state when daemon returns an empty list", () => {
  const stale = buildSession("session-stale", "2026-04-27T10:00:00.000Z");
  const next = applySessionListSnapshot(
    {
      activeSessionId: stale.id,
      maps: {
        statuses: { [stale.id]: stale.status },
        messages: { [stale.id]: [{ id: "msg-1", role: "assistant", text: "hello", timestamp: stale.updatedAt }] },
        permissionRequests: { [stale.id]: null },
        outputs: { [stale.id]: [{ id: "out-1", commandId: "cmd-1", stream: "stdout", text: "done", timestamp: stale.updatedAt }] },
        diffs: { [stale.id]: [{ path: "apps/deck/src/App.tsx", status: "modified", additions: 1, deletions: 0 }] },
      },
    },
    [],
  );

  assert.deepEqual(next.sessions, []);
  assert.equal(next.activeSessionId, null);
  assert.deepEqual(next.maps.statuses, {});
  assert.deepEqual(next.maps.messages, {});
  assert.deepEqual(next.maps.permissionRequests, {});
  assert.deepEqual(next.maps.outputs, {});
  assert.deepEqual(next.maps.diffs, {});
});

test("applySessionListSnapshot keeps live sessions and prunes only stale records", () => {
  const stale = buildSession("session-stale", "2026-04-27T10:00:00.000Z");
  const live = buildSession("session-live", "2026-04-27T11:00:00.000Z");
  const next = applySessionListSnapshot(
    {
      activeSessionId: stale.id,
      maps: {
        statuses: { [stale.id]: stale.status, [live.id]: "running" },
        messages: {
          [stale.id]: [{ id: "msg-stale", role: "assistant", text: "old", timestamp: stale.updatedAt }],
          [live.id]: [{ id: "msg-live", role: "assistant", text: "new", timestamp: live.updatedAt }],
        },
        permissionRequests: { [stale.id]: null, [live.id]: null },
        outputs: {
          [stale.id]: [{ id: "out-stale", commandId: "cmd-stale", stream: "stdout", text: "old", timestamp: stale.updatedAt }],
          [live.id]: [{ id: "out-live", commandId: "cmd-live", stream: "stdout", text: "new", timestamp: live.updatedAt }],
        },
        diffs: {
          [stale.id]: [{ path: "stale.ts", status: "modified", additions: 1, deletions: 0 }],
          [live.id]: [{ path: "live.ts", status: "modified", additions: 2, deletions: 1 }],
        },
      },
    },
    [live],
  );

  assert.deepEqual(next.sessions, [live]);
  assert.equal(next.activeSessionId, null);
  assert.deepEqual(next.maps.statuses, { [live.id]: live.status });
  assert.deepEqual(next.maps.messages, {
    [live.id]: [{ id: "msg-live", role: "assistant", text: "new", timestamp: live.updatedAt }],
  });
  assert.deepEqual(next.maps.permissionRequests, { [live.id]: null });
  assert.deepEqual(next.maps.outputs, {
    [live.id]: [{ id: "out-live", commandId: "cmd-live", stream: "stdout", text: "new", timestamp: live.updatedAt }],
  });
  assert.deepEqual(next.maps.diffs, {
    [live.id]: [{ path: "live.ts", status: "modified", additions: 2, deletions: 1 }],
  });
});

test("resolveActiveSessionId preserves only an explicitly open live session", () => {
  const live = buildSession("session-live", "2026-04-27T11:00:00.000Z");

  assert.equal(resolveActiveSessionId(live.id, [live]), live.id);
  assert.equal(resolveActiveSessionId(null, [live]), null);
  assert.equal(resolveActiveSessionId("missing", [live]), null);
});

test("resolveSessionProjectId keeps the session project binding authoritative", () => {
  const session = {
    ...buildSession("session-authoritative", "2026-04-27T10:00:00.000Z"),
    projectId: "project-alpha",
    projectName: "Alpha",
    workspaceId: "workspace-shared",
  };
  const projects: ProjectSummary[] = [
    { id: "project-alpha", name: "Alpha", helmId: "helm-1", workspaceIds: ["workspace-alpha"] },
    { id: "project-beta", name: "Beta", helmId: "helm-1", workspaceIds: ["workspace-shared"] },
  ];

  assert.equal(resolveSessionProjectId(session, projects), "project-alpha");
});

test("resolveSessionProjectId falls back for legacy sessions with unknown project ids", () => {
  const session = {
    ...buildSession("session-legacy", "2026-04-27T10:00:00.000Z"),
    projectId: "legacy-project",
    projectName: "Beta",
    workspaceId: "workspace-beta",
  };
  const projects: ProjectSummary[] = [
    { id: "project-alpha", name: "Alpha", helmId: "helm-1", workspaceIds: ["workspace-alpha"] },
    { id: "project-beta", name: "Beta", helmId: "helm-1", workspaceIds: ["workspace-beta"] },
  ];

  assert.equal(resolveSessionProjectId(session, projects), "project-beta");
});

test("toggleExpandedIdSet changes only expanded project folder membership", () => {
  const current = new Set(["project-alpha", "project-gamma"]);

  assert.deepEqual([...toggleExpandedIdSet(current, "project-alpha")].sort(), ["project-gamma"]);
  assert.deepEqual([...toggleExpandedIdSet(current, "project-beta")].sort(), ["project-alpha", "project-beta", "project-gamma"]);
  assert.deepEqual([...current].sort(), ["project-alpha", "project-gamma"]);
});

test("resolveSessionTitle uses the first meaningful 5 chars of the user prompt preview", () => {
  assert.equal(resolveSessionTitle(buildSession("session-1", "2026-04-27T10:00:00.000Z"), "【紧急】修复 session.message 日志"), "紧急修复s");
  assert.equal(resolveSessionTitle(buildSession("session-2", "2026-04-27T10:00:00.000Z"), "  你好！！！  "), "你好");
});

test("resolveSessionTitle falls back to project task name when preview has no readable characters", () => {
  assert.equal(resolveSessionTitle(buildSession("session-1", "2026-04-27T10:00:00.000Z"), "!!! ---"), "Tiller 任务");
});

test("resolveDraftSelectionId preserves a valid manual selection instead of forcing the project default", () => {
  const available = [
    { id: "opencode" },
    { id: "codex" },
  ];

  assert.equal(resolveDraftSelectionId("codex", available, "opencode"), "codex");
  assert.equal(resolveDraftSelectionId("missing", available, "opencode"), "opencode");
  assert.equal(resolveDraftSelectionId(null, available, "missing"), "opencode");
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
  const options = resolveModelOptionsFromConfig("legacy/default", [
    {
      id: "model-picker",
      category: "model",
      currentValue: "openai/gpt-5.4",
      options: [
        { value: "openai/gpt-5.4", label: "GPT 5.4" },
        { value: "openai/gpt-5.4/high", label: "GPT 5.4 · High" },
      ],
    },
  ], [
    { id: "legacy/default", name: "Legacy Default" },
  ]);

  assert.deepEqual(options, ["openai/gpt-5.4", "openai/gpt-5.4/high"]);
});

test("resolveModelOptionsFromConfig falls back to current model when no option list is available", () => {
  const options = resolveModelOptionsFromConfig("gpt-5.5", [], []);

  assert.deepEqual(options, ["gpt-5.5"]);
});


test("resolveMissionHelms keeps configured helms even when they have no projects", () => {
  const connectedHelm: HelmSummary = { id: "local-helm", name: "Local Helm", host: "127.0.0.1", port: 47631 };
  const remoteHelm: HelmSummary = { id: "remote-helm", name: "Remote Helm", host: "127.0.0.2", port: 47632 };
  assert.deepEqual(resolveMissionHelms([connectedHelm, remoteHelm], connectedHelm.id), [connectedHelm, remoteHelm]);
});

test("resolveProjectFilesScope uses active session scope when a session is open", () => {
  const activeSession = { ...buildSession("session-1", "2026-04-27T10:00:00.000Z"), projectId: "session-project", workspaceId: "session-workspace" };

  assert.deepEqual(resolveProjectFilesScope({ activeSession, activeSessionProjectId: "resolved-session-project" }), {
    projectId: "resolved-session-project",
    workspaceId: "session-workspace",
  });
});

test("resolveProjectFilesScope ignores draft project before a session starts", () => {
  assert.deepEqual(resolveProjectFilesScope({ activeSession: null, activeSessionProjectId: null }), {
    projectId: null,
    workspaceId: null,
  });
});

test("resolveMissionSelectedProjectId prefers the active session project over stale draft selection", () => {
  assert.equal(resolveMissionSelectedProjectId({ activeSessionProjectId: "session-project", selectedProjectId: "draft-project" }), "session-project");
});

test("resolveMissionSelectedProjectId falls back to the draft project before a session starts", () => {
  assert.equal(resolveMissionSelectedProjectId({ activeSessionProjectId: null, selectedProjectId: "draft-project" }), "draft-project");
});


test("resolvePromptPlaceholder uses the selected ACP command as empty-editor hint", () => {
  assert.equal(resolvePromptPlaceholder({ command: "codex-acp" }), "向 codex-acp 下达指令；@ 引用上下文，/ 调用命令");
  assert.equal(resolvePromptPlaceholder({ command: "opencode", args: ["acp", "--pure"] }), "向 opencode acp --pure 下达指令；@ 引用上下文，/ 调用命令");
});
