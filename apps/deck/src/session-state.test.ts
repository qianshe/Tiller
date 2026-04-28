import assert from "node:assert/strict";
import test from "node:test";
import type { SessionSummary } from "@tiller/shared";
import { applySessionListSnapshot, resolveDraftSelectionId, resolveModelOptionsFromConfig, resolvePromptPlaceholder } from "./session-state.js";

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
  assert.equal(next.activeSessionId, live.id);
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

  assert.deepEqual(options.slice(0, 3), ["openai/gpt-5.4", "anthropic/claude-sonnet-4", "provider-default"]);
});


test("resolvePromptPlaceholder uses the selected ACP command as empty-editor hint", () => {
  assert.equal(resolvePromptPlaceholder({ command: "codex-acp" }), "向 codex-acp 下达指令；@ 引用上下文，/ 调用命令");
  assert.equal(resolvePromptPlaceholder({ command: "opencode", args: ["acp", "--pure"] }), "向 opencode acp --pure 下达指令；@ 引用上下文，/ 调用命令");
});
