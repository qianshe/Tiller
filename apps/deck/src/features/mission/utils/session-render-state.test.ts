import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentMessage,
  AgentToolCall,
  PermissionRequest,
  ProjectFileSummary,
} from "@tiller/shared";
import {
  buildMissionPanelPages,
  resolveMissionActivityLoading,
  resolveVisibleProjectFiles,
} from "./session-render-state.js";

function entry(path: string, kind: ProjectFileSummary["kind"]): ProjectFileSummary {
  return { path, kind } as ProjectFileSummary;
}

function agentMessage(
  id: string,
  role: AgentMessage["role"],
  timestamp: string,
): AgentMessage {
  return {
    id,
    role,
    text: `${role} ${id}`,
    timestamp,
  };
}

function toolCall(status: AgentToolCall["status"]): AgentToolCall {
  return {
    id: `tool-${status}`,
    commandId: `cmd-${status}`,
    kind: "tool",
    title: "mcp_router/search_context",
    status,
    input: "",
    output: "",
    timestamp: "2026-05-08T01:00:00.000Z",
    updatedAt: "2026-05-08T01:01:00.000Z",
  } as AgentToolCall;
}

test("project file tree defaults directories to collapsed", () => {
  const files = [
    entry("README.md", "file"),
    entry("src", "directory"),
    entry("src/app.ts", "file"),
    entry("src/features", "directory"),
    entry("src/features/chat.ts", "file"),
  ];

  assert.deepEqual(
    resolveVisibleProjectFiles(files, "", new Set()).map((file) => file.path),
    ["README.md", "src"],
  );
});

test("project file tree reveals only children of expanded directories", () => {
  const files = [
    entry("src", "directory"),
    entry("src/app.ts", "file"),
    entry("src/features", "directory"),
    entry("src/features/chat.ts", "file"),
  ];

  assert.deepEqual(
    resolveVisibleProjectFiles(files, "", new Set(["src"])).map(
      (file) => file.path,
    ),
    ["src", "src/app.ts", "src/features"],
  );
});

test("project file search ignores collapsed tree state", () => {
  const files = [
    entry("src", "directory"),
    entry("src/features/chat.ts", "file"),
  ];

  assert.deepEqual(
    resolveVisibleProjectFiles(files, "chat", new Set()).map((file) => file.path),
    ["src/features/chat.ts"],
  );
});

test("mission display pages keep the Git diff list out but preserve diff detail", () => {
  assert.deepEqual(
    buildMissionPanelPages(3, 2, [{ id: "custom-1", title: "自定义" }]),
    [
      { id: "overview", title: "概览" },
      { id: "logbook", title: "航行日志 (2)" },
      { id: "diff-detail", title: "Diff 详情" },
      { id: "custom-1", title: "自定义" },
    ],
  );
});

test("mission activity loading hides fallback after latest assistant result", () => {
  const loading = resolveMissionActivityLoading({
    status: "running",
    messages: [
      agentMessage("user-1", "user", "2026-05-08T01:00:00.000Z"),
      agentMessage("assistant-1", "assistant", "2026-05-08T01:02:00.000Z"),
    ],
    toolCalls: [toolCall("completed"), toolCall("failed")],
    pendingPermission: null,
  });

  assert.equal(loading, null);
});

test("mission activity loading shows agent fallback after latest user message", () => {
  const loading = resolveMissionActivityLoading({
    status: "running",
    messages: [agentMessage("user-1", "user", "2026-05-08T01:00:00.000Z")],
    toolCalls: [],
    pendingPermission: null,
  });

  assert.deepEqual(loading, { title: "Agent 响应", status: "running" });
});

test("mission activity loading prioritizes pending tool activity", () => {
  const loading = resolveMissionActivityLoading({
    status: "running",
    messages: [
      agentMessage("user-1", "user", "2026-05-08T01:00:00.000Z"),
      agentMessage("assistant-1", "assistant", "2026-05-08T01:02:00.000Z"),
    ],
    toolCalls: [toolCall("waiting_for_permission")],
    pendingPermission: {} as PermissionRequest,
  });

  assert.equal(loading?.title, "mcp_router/search_context");
  assert.equal(loading?.status, "waiting_for_permission");
});
