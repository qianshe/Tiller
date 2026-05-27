import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentToolCall, CommandChunk } from "@tiller/shared";
import {
  buildConversationTimeline,
  commandChunkToToolCall,
  groupToolCalls,
  mergeToolCallHistory,
  resolvePendingToolActivity,
  sortAgentMessagesByTimeline,
} from "./timeline.js";

const baseMessage: AgentMessage = {
  id: "msg-1",
  role: "assistant",
  text: "Done",
  timestamp: "2026-04-28T10:00:02.000Z",
};

test("sortAgentMessagesByTimeline orders messages by timestamp and preserves source order for ties", () => {
  const messages: AgentMessage[] = [
    {
      ...baseMessage,
      id: "msg-c",
      text: "third",
      timestamp: "2026-04-28T10:00:02.000Z",
    },
    {
      ...baseMessage,
      id: "msg-b",
      text: "first at tied timestamp",
      timestamp: "2026-04-28T10:00:01.000Z",
    },
    {
      ...baseMessage,
      id: "msg-a",
      text: "second at tied timestamp",
      timestamp: "2026-04-28T10:00:01.000Z",
    },
  ];

  const sorted = sortAgentMessagesByTimeline(messages);

  assert.deepEqual(
    sorted.map((message) => message.id),
    ["msg-b", "msg-a", "msg-c"],
  );
});

test("sortAgentMessagesByTimeline preserves source order for mixed timeline sequences", () => {
  const messages: AgentMessage[] = [
    {
      id: "legacy-user",
      role: "user",
      text: "旧用户提问",
      timestamp: "2026-04-28T10:00:03.000Z",
    },
    {
      ...baseMessage,
      id: "provider-assistant",
      text: "Provider 回复",
      timestamp: "2026-04-28T10:00:01.000Z",
      timelineSequence: 2,
    },
  ];

  assert.deepEqual(
    sortAgentMessagesByTimeline(messages).map((message) => message.id),
    ["legacy-user", "provider-assistant"],
  );
});

test("buildConversationTimeline interleaves messages and tool calls by timestamp", () => {
  const toolCall: AgentToolCall = {
    id: "tool-1",
    kind: "shell",
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

test("buildConversationTimeline preserves runtime event order when timestamps collide", () => {
  const timestamp = "2026-05-24T08:00:00.000Z";
  const message = {
    ...baseMessage,
    id: "msg-seq-3",
    text: "具体回复",
    timestamp,
    timelineSequence: 3,
  } as AgentMessage;
  const thinking = {
    id: "think-seq-1",
    kind: "think" as const,
    title: "Thinking",
    status: "completed" as const,
    output: "先思考",
    timestamp,
    updatedAt: timestamp,
    timelineSequence: 1,
  } as AgentToolCall;
  const toolCall = {
    id: "tool-seq-2",
    kind: "shell" as const,
    title: "Run tests",
    status: "completed" as const,
    output: "PASS",
    timestamp,
    updatedAt: timestamp,
    timelineSequence: 2,
  } as AgentToolCall;

  const timeline = buildConversationTimeline([message], [], [toolCall, thinking]);

  assert.deepEqual(
    timeline.map((item) => item.kind === "message" ? item.message.text : item.toolKind),
    ["think", "shell", "具体回复"],
  );
});

test("buildConversationTimeline preserves mixed sequence source order for legacy user prompts", () => {
  const userMessage: AgentMessage = {
    id: "legacy-user",
    role: "user",
    text: "旧用户提问",
    timestamp: "2026-04-28T10:00:03.000Z",
  };
  const toolCall: AgentToolCall = {
    id: "tool-seq-2",
    kind: "shell",
    title: "Run tests",
    status: "completed",
    commandId: "cmd-seq-2",
    output: "PASS",
    stream: "stdout",
    timestamp: "2026-04-28T10:00:02.000Z",
    updatedAt: "2026-04-28T10:00:02.000Z",
    timelineSequence: 2,
  };

  const timeline = buildConversationTimeline([userMessage], [], [toolCall]);

  assert.deepEqual(
    timeline.map((item) => item.kind === "message" ? item.message.id : item.id),
    ["legacy-user", "tool-seq-2"],
  );
});

test("groupToolCalls merges chunks for the same command id", () => {
  const calls: AgentToolCall[] = [
    {
      id: "tool-1",
      kind: "shell",
      title: "cmd",
      status: "running",
      commandId: "cmd",
      output: "A",
      stream: "stdout",
      timestamp: "2026-04-28T10:00:01.000Z",
      updatedAt: "2026-04-28T10:00:01.000Z",
    },
    {
      id: "tool-1",
      kind: "shell",
      title: "cmd",
      status: "completed",
      commandId: "cmd",
      output: "B",
      stream: "stderr",
      timestamp: "2026-04-28T10:00:02.000Z",
      updatedAt: "2026-04-28T10:00:02.000Z",
    },
  ];

  const grouped = groupToolCalls(calls);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]?.text, "AB");
  assert.equal(grouped[0]?.status, "completed");
  assert.deepEqual(grouped[0]?.streams, ["stdout", "stderr"]);
});

test("groupToolCalls keeps the first timestamp for timeline placement", () => {
  const grouped = groupToolCalls([
    {
      id: "tool-1",
      kind: "tool",
      title: "search",
      status: "pending",
      commandId: "cmd",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.627Z",
    },
    {
      id: "tool-1",
      kind: "tool",
      title: "search",
      status: "completed",
      commandId: "cmd",
      output: "ok",
      timestamp: "2026-04-30T13:22:46.630Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    },
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

  assert.equal(call.kind, "shell");
  assert.equal(call.status, "failed");
  assert.equal(call.output, "ERR");
});

test("resolvePendingToolActivity reports the latest running tool", () => {
  const calls: AgentToolCall[] = [
    {
      id: "tool-done",
      kind: "tool",
      title: "completed",
      status: "completed",
      timestamp: "2026-04-30T10:00:00.000Z",
      updatedAt: "2026-04-30T10:00:01.000Z",
    },
    {
      id: "tool-running",
      kind: "shell",
      title: "pnpm test",
      status: "running",
      timestamp: "2026-04-30T10:00:02.000Z",
      updatedAt: "2026-04-30T10:00:03.000Z",
    },
  ];

  assert.deepEqual(resolvePendingToolActivity(calls), {
    title: "pnpm test",
    status: "running",
  });
  assert.equal(
    resolvePendingToolActivity([{ ...calls[0]!, status: "failed" }]),
    null,
  );
});

test("mergeToolCallHistory appends output for existing tool calls", () => {
  const current: AgentToolCall[] = [
    {
      id: "tool-1",
      kind: "shell",
      title: "cmd",
      status: "running",
      commandId: "cmd",
      output: "A",
      timestamp: "2026-04-28T10:00:01.000Z",
      updatedAt: "2026-04-28T10:00:01.000Z",
    },
  ];
  const incoming: AgentToolCall[] = [
    {
      id: "tool-1",
      kind: "shell",
      title: "cmd",
      status: "completed",
      commandId: "cmd",
      output: "B",
      timestamp: "2026-04-28T10:00:02.000Z",
      updatedAt: "2026-04-28T10:00:02.000Z",
    },
  ];

  const merged = mergeToolCallHistory(current, incoming);

  assert.equal(merged[0]?.output, "AB");
  assert.equal(merged[0]?.status, "completed");
});

test("mergeToolCallHistory replaces duplicate completed tool snapshots", () => {
  const current: AgentToolCall[] = [
    {
      id: "tool-1",
      kind: "shell",
      title: "cmd",
      status: "completed",
      commandId: "cmd",
      output: "old result",
      timestamp: "2026-04-28T10:00:01.000Z",
      updatedAt: "2026-04-28T10:00:01.000Z",
    },
  ];
  const incoming: AgentToolCall[] = [
    {
      id: "tool-1",
      kind: "shell",
      title: "cmd",
      status: "completed",
      commandId: "cmd",
      output: "new result",
      timestamp: "2026-04-28T10:00:01.000Z",
      updatedAt: "2026-04-28T10:00:02.000Z",
    },
  ];

  const merged = mergeToolCallHistory(current, incoming);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.output, "new result");
});

test("mergeToolCallHistory keeps the earliest start timestamp across replay merges", () => {
  const current: AgentToolCall[] = [
    {
      id: "tool-1",
      kind: "tool",
      title: "cmd",
      status: "completed",
      output: "A",
      timestamp: "2026-04-30T10:22:14.142Z",
      updatedAt: "2026-04-30T10:22:14.240Z",
    },
  ];
  const incoming: AgentToolCall[] = [
    {
      id: "tool-1",
      kind: "tool",
      title: "cmd",
      status: "completed",
      output: "B",
      timestamp: "2026-04-30T13:22:46.672Z",
      updatedAt: "2026-04-30T13:22:46.678Z",
    },
  ];

  const merged = mergeToolCallHistory(current, incoming);

  assert.equal(merged[0]?.timestamp, "2026-04-30T10:22:14.142Z");
  assert.equal(merged[0]?.updatedAt, "2026-04-30T13:22:46.678Z");
});

test("mergeToolCallHistory preserves strong metadata when sparse updates arrive", () => {
  const current: AgentToolCall[] = [
    {
      id: "toolu_01Search",
      kind: "search",
      title: "Search",
      status: "running",
      input: JSON.stringify({ pattern: "composer", path: "apps" }),
      timestamp: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:00.000Z",
    },
  ];
  const incoming: AgentToolCall[] = [
    {
      id: "toolu_01Search",
      kind: "tool",
      title: "Tool call toolu_01S...",
      status: "completed",
      output: "found",
      timestamp: "2026-05-17T10:00:01.000Z",
      updatedAt: "2026-05-17T10:00:01.000Z",
    },
  ];

  const merged = mergeToolCallHistory(current, incoming);
  const grouped = groupToolCalls(merged);

  assert.equal(merged[0]?.kind, "search");
  assert.equal(merged[0]?.title, "Search");
  assert.equal(merged[0]?.input, JSON.stringify({ pattern: "composer", path: "apps" }));
  assert.equal(merged[0]?.status, "completed");
  assert.equal(merged[0]?.output, "found");
  assert.equal(grouped[0]?.toolKind, "search");
  assert.equal(grouped[0]?.title, "Search: composer");
});

