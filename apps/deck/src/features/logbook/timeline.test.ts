import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentToolCall, CommandChunk } from "@tiller/shared";
import { buildConversationTimeline, commandChunkToToolCall, groupToolCalls, mergeAgentMessages, mergeMessageHistory, mergeToolCallHistory, resolvePendingToolActivity, sortAgentMessagesByTimeline } from "./timeline.js";

const baseMessage: AgentMessage = {
  id: "msg-1",
  role: "assistant",
  text: "Done",
  timestamp: "2026-04-28T10:00:02.000Z",
};

test("sortAgentMessagesByTimeline orders messages by timestamp and preserves source order for ties", () => {
  const messages: AgentMessage[] = [
    { ...baseMessage, id: "msg-c", text: "third", timestamp: "2026-04-28T10:00:02.000Z" },
    { ...baseMessage, id: "msg-b", text: "first at tied timestamp", timestamp: "2026-04-28T10:00:01.000Z" },
    { ...baseMessage, id: "msg-a", text: "second at tied timestamp", timestamp: "2026-04-28T10:00:01.000Z" },
  ];

  const sorted = sortAgentMessagesByTimeline(messages);

  assert.deepEqual(sorted.map((message) => message.id), ["msg-b", "msg-a", "msg-c"]);
});

test("buildConversationTimeline interleaves messages and tool calls by timestamp", () => {
  const toolCall: AgentToolCall = {
    id: "tool-1",
    kind: "terminal",
    title: "Run tests",
    status: "completed",
    commandId: "cmd-1",
    output: "PASS",
    stream: "stdout",
    timestamp: "2026-04-28T10:00:01.000Z",
    updatedAt: "2026-04-28T10:00:01.000Z",
  };

  const timeline = buildConversationTimeline([baseMessage], [], [toolCall]);

  assert.equal(timeline[0]?.kind, "tool");
  assert.equal(timeline[1]?.kind, "message");
});

test("groupToolCalls merges chunks for the same command id", () => {
  const calls: AgentToolCall[] = [
    { id: "tool-1", kind: "terminal", title: "cmd", status: "running", commandId: "cmd", output: "A", stream: "stdout", timestamp: "2026-04-28T10:00:01.000Z", updatedAt: "2026-04-28T10:00:01.000Z" },
    { id: "tool-1", kind: "terminal", title: "cmd", status: "completed", commandId: "cmd", output: "B", stream: "stderr", timestamp: "2026-04-28T10:00:02.000Z", updatedAt: "2026-04-28T10:00:02.000Z" },
  ];

  const grouped = groupToolCalls(calls);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]?.text, "AB");
  assert.equal(grouped[0]?.status, "completed");
  assert.deepEqual(grouped[0]?.streams, ["stdout", "stderr"]);
});

test("groupToolCalls uses shell command prefix as title and expands only output", () => {
  const grouped = groupToolCalls([
    {
      id: "call-shell",
      kind: "terminal",
      title: "Tool: shell",
      status: "completed",
      input: JSON.stringify({ command: "pnpm --filter @tiller/helm test -- --reporter spec" }),
      output: "PASS",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "pnpm --filter @tiller/helm test -- --reporter spec");
  assert.equal(grouped[0]?.text, "PASS");
});

test("groupToolCalls summarizes Codex rawInput shell command arrays", () => {
  const grouped = groupToolCalls([
    {
      id: "call-shell-raw",
      kind: "terminal",
      title: "call-shell-raw",
      status: "completed",
      input: JSON.stringify({
        command: ["powershell.exe", "-Command", "Get-Content -Raw 'C:/Users/qjq/.codex/skills/foo/SKILL.md'"],
        parsed_cmd: [{ type: "unknown", cmd: "Get-Content -Raw 'C:/Users/qjq/.codex/skills/foo/SKILL.md'" }],
      }),
      output: "skill docs",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Skill: foo");
  assert.equal(grouped[0]?.text, "skill docs");
});

test("groupToolCalls shows SKILL.md shell reads as skill names", () => {
  const grouped = groupToolCalls([
    {
      id: "call-skill-read",
      kind: "terminal",
      title: "Get-Content -Raw 'C:/Users/qjq/.codex/plugins/cache/openai-curated/superpowers/56bcc02e/skills/brainstorming/SKILL.md'",
      status: "completed",
      input: JSON.stringify({ command: "Get-Content -Raw 'C:/Users/qjq/.codex/plugins/cache/openai-curated/superpowers/56bcc02e/skills/brainstorming/SKILL.md'" }),
      output: "skill docs",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Skill: superpowers:brainstorming");
  assert.equal(grouped[0]?.text, "skill docs");
});

test("groupToolCalls extracts skill names from terminal titles without input", () => {
  const grouped = groupToolCalls([
    {
      id: "call-skill-title",
      kind: "terminal",
      title: "Get-Content -Raw 'C:/Users/qjq/.codex/skills/.system/openai-docs/SKILL.md'",
      status: "completed",
      output: "skill docs",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Skill: openai-docs");
});

test("groupToolCalls recognizes OpenCode skill tools from tool stdout payloads", () => {
  const grouped = groupToolCalls([
    {
      id: "tool-opencode-skill",
      kind: "tool",
      title: "Tool: frontend-design",
      status: "completed",
      output: JSON.stringify({ output: "## Skill frontend-design\n\n**Base directory:** C:/Users/qjq/.claude/skills/frontend-design" }),
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Skill: frontend-design");
});

test("groupToolCalls recognizes OpenCode skill tools from plain stdout payloads", () => {
  const grouped = groupToolCalls([
    {
      id: "tool-opencode-plain-skill",
      kind: "tool",
      title: "skill",
      status: "completed",
      output: "Skill: webapp-testing\nloaded",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "Skill: webapp-testing");
});

test("groupToolCalls does not classify Codex terminal output as a skill without a SKILL.md command", () => {
  const grouped = groupToolCalls([
    {
      id: "tool-codex-shell-output",
      kind: "terminal",
      title: "echo docs",
      status: "completed",
      input: JSON.stringify({ command: "echo docs" }),
      output: "## Skill frontend-design\nthis is just stdout",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
  ]);

  assert.equal(grouped[0]?.title, "echo docs");
});

test("groupToolCalls keeps the first timestamp for timeline placement", () => {
  const grouped = groupToolCalls([
    { id: "tool-1", kind: "tool", title: "search", status: "pending", commandId: "cmd", timestamp: "2026-04-30T13:22:46.627Z", updatedAt: "2026-04-30T13:22:46.627Z" },
    { id: "tool-1", kind: "tool", title: "search", status: "completed", commandId: "cmd", output: "ok", timestamp: "2026-04-30T13:22:46.630Z", updatedAt: "2026-04-30T13:22:46.630Z" },
  ]);

  assert.equal(grouped[0]?.timestamp, "2026-04-30T13:22:46.627Z");
  assert.equal(grouped[0]?.status, "completed");
});

test("commandChunkToToolCall provides a terminal fallback for legacy command output", () => {
  const chunk: CommandChunk = {
    id: "chunk-1",
    commandId: "cmd-1",
    text: "ERR",
    stream: "stderr",
    timestamp: "2026-04-28T10:00:01.000Z",
  };

  const call = commandChunkToToolCall(chunk);

  assert.equal(call.kind, "terminal");
  assert.equal(call.status, "failed");
  assert.equal(call.output, "ERR");
});

test("coalesceDisplayMessages collapses repeated assistant snapshots", () => {
  const finalAnswer = "主人，已完成本轮最小改动喵~\n\n| 项目 | 内容 |";
  const bridge = "我会按 `superpowers` 流程做最小定位与修改，并优先用 MCP 搜索/编辑，确保 typecheck 验证喵~";
  const timeline = buildConversationTimeline([
    { id: "msg-1", role: "assistant", text: finalAnswer, timestamp: "2026-04-28T10:00:01.000Z" },
    { id: "msg-1", role: "assistant", text: `${finalAnswer}${bridge}${finalAnswer}`, timestamp: "2026-04-28T10:00:02.000Z" },
  ], [], []);

  assert.equal(timeline.length, 1);
  assert.equal(timeline[0]?.kind, "message");
  if (timeline[0]?.kind === "message") {
    assert.equal(timeline[0].message.text, finalAnswer);
  }
});

test("buildConversationTimeline keeps assistant messages split around inserted tool calls", () => {
  const timeline = buildConversationTimeline(
    [
      { id: "msg-before-tool", role: "assistant", text: "先说明", timestamp: "2026-04-28T10:00:01.000Z" },
      { id: "msg-after-tool", role: "assistant", text: "先说明再继续", timestamp: "2026-04-28T10:00:03.000Z" },
    ],
    [],
    [
      {
        id: "tool-between-messages",
        kind: "tool",
        title: "Skill: frontend-design",
        status: "completed",
        timestamp: "2026-04-28T10:00:02.000Z",
        updatedAt: "2026-04-28T10:00:02.000Z",
      },
    ],
  );

  assert.equal(timeline.length, 3);
  assert.equal(timeline[0]?.kind, "message");
  assert.equal(timeline[1]?.kind, "tool");
  assert.equal(timeline[2]?.kind, "message");
  if (timeline[0]?.kind === "message" && timeline[2]?.kind === "message") {
    assert.equal(timeline[0].message.text, "先说明");
    assert.equal(timeline[2].message.text, "再继续");
  }
});

test("mergeAgentMessages keeps consecutive user messages separate", () => {
  const merged = mergeAgentMessages([
    { id: "user-1", role: "user", text: "第一条", timestamp: "2026-04-28T10:00:01.000Z" },
  ], { id: "user-2", role: "user", text: "第二条", timestamp: "2026-04-28T10:00:02.000Z" });

  assert.deepEqual(merged.map((message) => message.text), ["第一条", "第二条"]);
});

test("mergeAgentMessages keeps distinct assistant messages separate", () => {
  const merged = mergeAgentMessages([
    { id: "assistant-1", role: "assistant", text: "第一段回复", timestamp: "2026-04-28T10:00:01.000Z" },
  ], { id: "assistant-2", role: "assistant", text: "第二段回复", timestamp: "2026-04-28T10:00:02.000Z" });

  assert.deepEqual(merged.map((message) => message.text), ["第一段回复", "第二段回复"]);
});

test("mergeAgentMessages merges chunks for the same assistant message id", () => {
  const merged = mergeAgentMessages([
    { id: "assistant-1", role: "assistant", text: "第一段", timestamp: "2026-04-28T10:00:01.000Z" },
  ], { id: "assistant-1", role: "assistant", text: "回复", timestamp: "2026-04-28T10:00:02.000Z" });

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.text, "第一段回复");
});

test("mergeAgentMessages merges runtime generated assistant chunks without shared ids", () => {
  const merged = mergeAgentMessages([
    { id: "session-1-msg-1000", role: "assistant", text: "流式", timestamp: "2026-04-28T10:00:01.000Z" },
  ], { id: "session-1-msg-1001", role: "assistant", text: "回复", timestamp: "2026-04-28T10:00:02.000Z" });

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.text, "流式回复");
});

test("mergeMessageHistory preserves server order even when timestamps are out of order", () => {
  const merged = mergeMessageHistory([], [
    { id: "assistant-1", role: "assistant", text: "先收到", timestamp: "2026-04-28T10:00:02.000Z" },
    { id: "user-1", role: "user", text: "后展示但时间更早", timestamp: "2026-04-28T10:00:01.000Z" },
  ]);

  assert.deepEqual(merged.map((message) => message.id), ["assistant-1", "user-1"]);
});

test("mergeMessageHistory prepends older pages before current messages", () => {
  const current: AgentMessage[] = [
    { id: "msg-3", role: "user", text: "三", timestamp: "2026-04-28T10:00:03.000Z" },
    { id: "msg-4", role: "assistant", text: "四", timestamp: "2026-04-28T10:00:04.000Z" },
  ];
  const older: AgentMessage[] = [
    { id: "msg-1", role: "user", text: "一", timestamp: "2026-04-28T10:00:01.000Z" },
    { id: "msg-2", role: "assistant", text: "二", timestamp: "2026-04-28T10:00:02.000Z" },
  ];

  const merged = mergeMessageHistory(current, older, { mode: "prepend" });

  assert.deepEqual(merged.map((message) => message.id), ["msg-1", "msg-2", "msg-3", "msg-4"]);
});

test("mergeMessageHistory updates existing messages in place", () => {
  const merged = mergeMessageHistory([
    { id: "msg-1", role: "assistant", text: "你", timestamp: "2026-04-28T10:00:01.000Z" },
    { id: "msg-2", role: "user", text: "继续", timestamp: "2026-04-28T10:00:02.000Z" },
  ], [
    { id: "msg-1", role: "assistant", text: "好", timestamp: "2026-04-28T10:00:03.000Z" },
  ]);

  assert.deepEqual(merged.map((message) => message.id), ["msg-1", "msg-2"]);
  assert.equal(merged[0]?.text, "你好");
  assert.equal(merged[0]?.timestamp, "2026-04-28T10:00:01.000Z");
});

test("resolvePendingToolActivity reports the latest running tool", () => {
  const calls: AgentToolCall[] = [
    { id: "tool-done", kind: "tool", title: "completed", status: "completed", timestamp: "2026-04-30T10:00:00.000Z", updatedAt: "2026-04-30T10:00:01.000Z" },
    { id: "tool-running", kind: "terminal", title: "pnpm test", status: "running", timestamp: "2026-04-30T10:00:02.000Z", updatedAt: "2026-04-30T10:00:03.000Z" },
  ];

  assert.deepEqual(resolvePendingToolActivity(calls), {
    title: "pnpm test",
    status: "running",
  });
  assert.equal(resolvePendingToolActivity([{ ...calls[0]!, status: "failed" }]), null);
});

test("mergeToolCallHistory appends output for existing tool calls", () => {
  const current: AgentToolCall[] = [{ id: "tool-1", kind: "terminal", title: "cmd", status: "running", commandId: "cmd", output: "A", timestamp: "2026-04-28T10:00:01.000Z", updatedAt: "2026-04-28T10:00:01.000Z" }];
  const incoming: AgentToolCall[] = [{ id: "tool-1", kind: "terminal", title: "cmd", status: "completed", commandId: "cmd", output: "B", timestamp: "2026-04-28T10:00:02.000Z", updatedAt: "2026-04-28T10:00:02.000Z" }];

  const merged = mergeToolCallHistory(current, incoming);

  assert.equal(merged[0]?.output, "AB");
  assert.equal(merged[0]?.status, "completed");
});

test("mergeToolCallHistory keeps the earliest start timestamp across replay merges", () => {
  const current: AgentToolCall[] = [{ id: "tool-1", kind: "tool", title: "cmd", status: "completed", output: "A", timestamp: "2026-04-30T10:22:14.142Z", updatedAt: "2026-04-30T10:22:14.240Z" }];
  const incoming: AgentToolCall[] = [{ id: "tool-1", kind: "tool", title: "cmd", status: "completed", output: "B", timestamp: "2026-04-30T13:22:46.672Z", updatedAt: "2026-04-30T13:22:46.678Z" }];

  const merged = mergeToolCallHistory(current, incoming);

  assert.equal(merged[0]?.timestamp, "2026-04-30T10:22:14.142Z");
  assert.equal(merged[0]?.updatedAt, "2026-04-30T13:22:46.678Z");
});
