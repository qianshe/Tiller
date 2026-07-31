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

test("sortAgentMessagesByTimeline preserves notification order despite timestamps", () => {
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
    ["msg-c", "msg-b", "msg-a"],
  );
});

test("sortAgentMessagesByTimeline preserves source order when a legacy row has no sequence", () => {
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
      sequence: 2,
    },
  ];

  assert.deepEqual(
    sortAgentMessagesByTimeline(messages).map((message) => message.id),
    ["legacy-user", "provider-assistant"],
  );
});

test("buildConversationTimeline preserves source order when no sequence is available", () => {
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

  assert.equal(timeline[0]?.kind, "message");
  assert.equal(timeline[1]?.kind, "tool");
});

test("buildConversationTimeline preserves runtime event order when timestamps collide", () => {
  const timestamp = "2026-05-24T08:00:00.000Z";
  const message = {
    ...baseMessage,
    id: "msg-seq-3",
    text: "具体回复",
    timestamp,
    sequence: 3,
  } as AgentMessage;
  const earlyTool = {
    id: "think-seq-1",
    kind: "tool" as const,
    title: "Thinking",
    status: "completed" as const,
    output: "先思考",
    timestamp,
    updatedAt: timestamp,
    sequence: 1,
  } as AgentToolCall;
  const toolCall = {
    id: "tool-seq-2",
    kind: "shell" as const,
    title: "Run tests",
    status: "completed" as const,
    output: "PASS",
    timestamp,
    updatedAt: timestamp,
    sequence: 2,
  } as AgentToolCall;

  const timeline = buildConversationTimeline([message], [], [toolCall, earlyTool]);

  assert.deepEqual(
    timeline.map((item) => item.kind === "message" ? item.message.text : item.toolKind),
    ["tool", "shell", "具体回复"],
  );
});

test("buildConversationTimeline preserves source order for mixed sequence legacy prompts", () => {
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
    sequence: 2,
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

test("groupToolCalls keeps the first arrival metadata for timeline placement", () => {
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

test("mergeToolCallHistory treats tools titled Thinking like ordinary tools", () => {
  const merged = mergeToolCallHistory(
    [
      {
        id: "think-1",
        kind: "tool",
        title: "Thinking",
        status: "running",
        commandId: "think-1",
        output: "A",
        timestamp: "2026-04-28T10:00:01.000Z",
        updatedAt: "2026-04-28T10:00:01.000Z",
      },
    ],
    [
      {
        id: "think-1",
        kind: "tool",
        title: "Thinking",
        status: "running",
        commandId: "think-1",
        output: "B",
        timestamp: "2026-04-28T10:00:02.000Z",
        updatedAt: "2026-04-28T10:00:02.000Z",
      },
    ],
  );

  assert.equal(merged[0]?.output, "AB");
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

test("mergeToolCallHistory keeps the first arrival timestamp across replay merges", () => {
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

test("mergeToolCallHistory preserves source order instead of timestamps", () => {
  const merged = mergeToolCallHistory(
    [
      {
        id: "tool-arrived-first",
        kind: "read",
        title: "Read later timestamp",
        status: "completed",
        timestamp: "2026-05-29T10:00:05.000Z",
        updatedAt: "2026-05-29T10:00:10.000Z",
      },
    ],
    [
      {
        id: "tool-arrived-second",
        kind: "shell",
        title: "Run earlier timestamp",
        status: "completed",
        timestamp: "2026-05-29T10:00:00.000Z",
        updatedAt: "2026-05-29T10:00:06.000Z",
      },
    ],
  );

  assert.deepEqual(
    merged.map((toolCall) => toolCall.id),
    ["tool-arrived-first", "tool-arrived-second"],
  );
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
  assert.equal(grouped[0]?.title, "Grep: composer");
});

test("mergeToolCallHistory repairs an early shell classification for structured Grep payloads", () => {
  const current: AgentToolCall[] = [
    {
      id: "toolu_01Grep",
      kind: "shell",
      title: "Shell",
      status: "completed",
      input: JSON.stringify({ pattern: "Tiller", glob: "**/README.md", output_mode: "files_with_matches" }),
      output: "Found 2 files",
      timestamp: "2026-07-07T08:06:52.322Z",
      updatedAt: "2026-07-07T08:06:52.900Z",
    },
  ];
  const incoming: AgentToolCall[] = [
    {
      id: "toolu_01Grep",
      kind: "search",
      title: "Grep",
      status: "completed",
      input: JSON.stringify({ pattern: "Tiller", glob: "**/README.md", output_mode: "files_with_matches" }),
      output: "Found 2 files",
      timestamp: "2026-07-07T08:06:52.322Z",
      updatedAt: "2026-07-07T08:06:53.266Z",
    },
  ];

  const merged = mergeToolCallHistory(current, incoming);

  assert.equal(merged[0]?.kind, "search");
  assert.equal(merged[0]?.title, "Grep");
});

test("groupToolCalls keeps the first classified search display when later shell-shaped updates reuse the same command", () => {
  const grouped = groupToolCalls([
    {
      id: "toolu_01Grep",
      commandId: "toolu_01Grep",
      kind: "search",
      title: "Grep",
      status: "running",
      input: JSON.stringify({
        pattern: "Tiller",
        glob: "**/README.md",
        output_mode: "files_with_matches",
      }),
      timestamp: "2026-07-07T08:06:52.322Z",
      updatedAt: "2026-07-07T08:06:52.322Z",
    },
    {
      id: "toolu_01Grep",
      commandId: "toolu_01Grep",
      kind: "shell",
      title: "Shell",
      status: "completed",
      input: JSON.stringify({
        pattern: "Tiller",
        glob: "**/README.md",
        output_mode: "files_with_matches",
      }),
      output: "Found 2 files",
      timestamp: "2026-07-07T08:06:52.322Z",
      updatedAt: "2026-07-07T08:06:53.266Z",
    },
  ]);

  assert.equal(grouped[0]?.toolKind, "search");
  assert.equal(grouped[0]?.title, "Grep: Tiller");
});
