import assert from "node:assert/strict";
import test from "node:test";
import {
  formatLogValue,
  isProviderDiagnosticAssistantText,
  isRuntimeGeneratedMessageId,
  mergeAssistantStreamText,
  resolveBroadcastToolCall,
  shouldStartNewRuntimeAssistantSegment,
} from "./event-normalizer";

test("assistant stream text merges cumulative and suffix chunks without duplication", () => {
  assert.equal(mergeAssistantStreamText("hello", "hello world"), "hello world");
  assert.equal(mergeAssistantStreamText("hello world", "world"), "hello world");
  assert.equal(mergeAssistantStreamText("hello", " world"), "hello world");
});

test("assistant segment starts when provider diagnostic state changes", () => {
  assert.equal(isProviderDiagnosticAssistantText("Model metadata for `gpt-5.5` not found."), true);
  assert.equal(shouldStartNewRuntimeAssistantSegment("Model metadata for x", "正常回复"), true);
  assert.equal(shouldStartNewRuntimeAssistantSegment("hello", "hello world"), false);
});

test("runtime generated message ids are detected", () => {
  assert.equal(isRuntimeGeneratedMessageId("session-abc-msg-s0"), true);
  assert.equal(isRuntimeGeneratedMessageId("123e4567-e89b-12d3-a456-426614174000-msg-123456-123456-pa"), true);
  assert.equal(isRuntimeGeneratedMessageId("provider-message-1"), false);
});

test("broadcast tool call upgrades kind and title from higher-confidence live metadata", () => {
  const merged = resolveBroadcastToolCall(
    {
      id: "tool-1",
      kind: "mcp",
      title: "New title",
      status: "completed",
      updatedAt: "2026-05-24T00:00:02.000Z",
      output: "done",
    },
    {
      id: "tool-1",
      kind: "tool",
      title: "Tool call tool-1",
      status: "running",
      updatedAt: "2026-05-24T00:00:01.000Z",
      input: { command: "pnpm test" },
    },
  );

  assert.equal(merged.kind, "mcp");
  assert.equal(merged.title, "New title");
  assert.equal(merged.status, "completed");
  assert.equal(merged.output, "done");
  assert.deepEqual(merged.input, { command: "pnpm test" });
});

test("broadcast tool call keeps persisted informative title when live title is fallback", () => {
  const merged = resolveBroadcastToolCall(
    {
      id: "tool-1",
      kind: "tool",
      title: "Tool call tool-1",
      status: "completed",
      updatedAt: "2026-05-24T00:00:02.000Z",
    },
    {
      id: "tool-1",
      kind: "shell",
      title: "grep README",
      status: "running",
      updatedAt: "2026-05-24T00:00:01.000Z",
    },
  );

  assert.equal(merged.kind, "shell");
  assert.equal(merged.title, "grep README");
});

test("broadcast tool call prefers repaired search kind over stale shell metadata", () => {
  const merged = resolveBroadcastToolCall(
    {
      id: "tool-find",
      kind: "search",
      title: "Find `**/AGENTS.md`",
      status: "completed",
      updatedAt: "2026-07-07T14:42:02.458Z",
      input: "{\"pattern\":\"**/AGENTS.md\"}",
    },
    {
      id: "tool-find",
      kind: "shell",
      title: "Find",
      status: "running",
      updatedAt: "2026-07-07T14:42:00.952Z",
      input: "{}",
    },
  );

  assert.equal(merged.kind, "search");
  assert.equal(merged.title, "Find `**/AGENTS.md`");
});

test("formatLogValue compacts strings and JSON values", () => {
  assert.equal(formatLogValue(" hello\nworld "), "hello world");
  assert.equal(formatLogValue({ ok: true }), "{\"ok\":true}");
});
