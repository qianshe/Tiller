import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@tiller/shared";
import {
  buildConversationTimeline,
  mergeAgentMessages,
  mergeMessageHistory,
} from "./timeline.js";

test("coalesceDisplayMessages collapses repeated assistant snapshots", () => {
  const finalAnswer = "主人，已完成本轮最小改动喵~\n\n| 项目 | 内容 |";
  const bridge =
    "我会按 `superpowers` 流程做最小定位与修改，并优先用 MCP 搜索/编辑，确保 typecheck 验证喵~";
  const timeline = buildConversationTimeline(
    [
      {
        id: "msg-1",
        role: "assistant",
        text: finalAnswer,
        timestamp: "2026-04-28T10:00:01.000Z",
      },
      {
        id: "msg-1",
        role: "assistant",
        text: `${finalAnswer}${bridge}${finalAnswer}`,
        timestamp: "2026-04-28T10:00:02.000Z",
      },
    ],
    [],
    [],
  );

  assert.equal(timeline.length, 1);
  assert.equal(timeline[0]?.kind, "message");
  if (timeline[0]?.kind === "message") {
    assert.equal(timeline[0].message.text, finalAnswer);
  }
});

test("buildConversationTimeline keeps assistant messages split around inserted tool calls", () => {
  const timeline = buildConversationTimeline(
    [
      {
        id: "msg-before-tool",
        role: "assistant",
        text: "先说明",
        timestamp: "2026-04-28T10:00:01.000Z",
      },
      {
        id: "msg-after-tool",
        role: "assistant",
        text: "先说明再继续",
        timestamp: "2026-04-28T10:00:03.000Z",
      },
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

test("buildConversationTimeline splits runtime assistant chunks across tool boundaries", () => {
  const timeline = buildConversationTimeline(
    [
      {
        id: "session-1-msg-1000",
        role: "assistant",
        text: "先说明",
        timestamp: "2026-04-28T10:00:01.000Z",
      },
      {
        id: "session-1-msg-1001",
        role: "assistant",
        text: "再继续",
        timestamp: "2026-04-28T10:00:03.000Z",
      },
    ],
    [],
    [
      {
        id: "tool-between-runtime-chunks",
        kind: "tool",
        title: "Tool: mcp_router/search_context",
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
  const merged = mergeAgentMessages(
    [
      {
        id: "user-1",
        role: "user",
        text: "第一条",
        timestamp: "2026-04-28T10:00:01.000Z",
      },
    ],
    {
      id: "user-2",
      role: "user",
      text: "第二条",
      timestamp: "2026-04-28T10:00:02.000Z",
    },
  );

  assert.deepEqual(
    merged.map((message) => message.text),
    ["第一条", "第二条"],
  );
});

test("mergeAgentMessages keeps distinct assistant messages separate", () => {
  const merged = mergeAgentMessages(
    [
      {
        id: "assistant-1",
        role: "assistant",
        text: "第一段回复",
        timestamp: "2026-04-28T10:00:01.000Z",
      },
    ],
    {
      id: "assistant-2",
      role: "assistant",
      text: "第二段回复",
      timestamp: "2026-04-28T10:00:02.000Z",
    },
  );

  assert.deepEqual(
    merged.map((message) => message.text),
    ["第一段回复", "第二段回复"],
  );
});

test("mergeAgentMessages merges chunks for the same assistant message id", () => {
  const merged = mergeAgentMessages(
    [
      {
        id: "assistant-1",
        role: "assistant",
        text: "第一段",
        timestamp: "2026-04-28T10:00:01.000Z",
      },
    ],
    {
      id: "assistant-1",
      role: "assistant",
      text: "回复",
      timestamp: "2026-04-28T10:00:02.000Z",
    },
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.text, "第一段回复");
});

test("mergeAgentMessages merges runtime generated assistant chunks without shared ids", () => {
  const merged = mergeAgentMessages(
    [
      {
        id: "session-1-msg-1000",
        role: "assistant",
        text: "流式",
        timestamp: "2026-04-28T10:00:01.000Z",
      },
    ],
    {
      id: "session-1-msg-1001",
      role: "assistant",
      text: "回复",
      timestamp: "2026-04-28T10:00:02.000Z",
    },
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.text, "流式回复");
});

test("mergeMessageHistory preserves server order even when timestamps are out of order", () => {
  const merged = mergeMessageHistory(
    [],
    [
      {
        id: "assistant-1",
        role: "assistant",
        text: "先收到",
        timestamp: "2026-04-28T10:00:02.000Z",
      },
      {
        id: "user-1",
        role: "user",
        text: "后展示但时间更早",
        timestamp: "2026-04-28T10:00:01.000Z",
      },
    ],
  );

  assert.deepEqual(
    merged.map((message) => message.id),
    ["assistant-1", "user-1"],
  );
});

test("mergeMessageHistory prepends older pages before current messages", () => {
  const current: AgentMessage[] = [
    {
      id: "msg-3",
      role: "user",
      text: "三",
      timestamp: "2026-04-28T10:00:03.000Z",
    },
    {
      id: "msg-4",
      role: "assistant",
      text: "四",
      timestamp: "2026-04-28T10:00:04.000Z",
    },
  ];
  const older: AgentMessage[] = [
    {
      id: "msg-1",
      role: "user",
      text: "一",
      timestamp: "2026-04-28T10:00:01.000Z",
    },
    {
      id: "msg-2",
      role: "assistant",
      text: "二",
      timestamp: "2026-04-28T10:00:02.000Z",
    },
  ];

  const merged = mergeMessageHistory(current, older, { mode: "prepend" });

  assert.deepEqual(
    merged.map((message) => message.id),
    ["msg-1", "msg-2", "msg-3", "msg-4"],
  );
});

test("mergeMessageHistory updates existing messages in place", () => {
  const merged = mergeMessageHistory(
    [
      {
        id: "msg-1",
        role: "assistant",
        text: "你",
        timestamp: "2026-04-28T10:00:01.000Z",
      },
      {
        id: "msg-2",
        role: "user",
        text: "继续",
        timestamp: "2026-04-28T10:00:02.000Z",
      },
    ],
    [
      {
        id: "msg-1",
        role: "assistant",
        text: "好",
        timestamp: "2026-04-28T10:00:03.000Z",
      },
    ],
  );

  assert.deepEqual(
    merged.map((message) => message.id),
    ["msg-1", "msg-2"],
  );
  assert.equal(merged[0]?.text, "你好");
  assert.equal(merged[0]?.timestamp, "2026-04-28T10:00:01.000Z");
});
