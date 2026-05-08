import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@tiller/shared";
import {
  buildConversationTimeline,
  mergeAgentMessages,
  mergeMessageHistory,
} from "./timeline.js";

test("mergeAgentMessages collapses duplicate assistant text with different markdown bullet formatting", () => {
  const merged = [
    {
      id: "assistant-combined",
      role: "assistant",
      text: "我可以帮你：- 🚀 实现功能 - 添加新特性🐛 调试问题 - 排查异常",
      timestamp: "2026-05-07T08:00:00.000Z",
    },
    {
      id: "assistant-markdown",
      role: "assistant",
      text: "我可以帮你：\n\n- 🚀 **实现功能** - 添加新特性\n- 🐛 **调试问题** - 排查异常",
      timestamp: "2026-05-07T08:00:01.000Z",
    },
  ].reduce<AgentMessage[]>(
    (items, message) => mergeAgentMessages(items, message as AgentMessage),
    [],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, "assistant-combined");
});

test("mergeAgentMessages skips provider paragraph chunks already covered by a combined stream message", () => {
  const merged = [
    {
      id: "provider-message-1",
      role: "assistant",
      text: "你好！我可以帮你：- 实现功能",
      timestamp: "2026-05-07T08:00:00.000Z",
    },
    {
      id: "provider-message-1#p0",
      role: "assistant",
      text: "你好！",
      timestamp: "2026-05-07T08:00:01.000Z",
    },
    {
      id: "provider-message-1#p1",
      role: "assistant",
      text: "我可以帮你：",
      timestamp: "2026-05-07T08:00:02.000Z",
    },
    {
      id: "provider-message-1#p2",
      role: "assistant",
      text: "- 实现功能",
      timestamp: "2026-05-07T08:00:03.000Z",
    },
  ].reduce<AgentMessage[]>(
    (items, message) => mergeAgentMessages(items, message as AgentMessage),
    [],
  );

  assert.deepEqual(
    merged.map((message) => [message.id, message.text]),
    [["provider-message-1", "你好！我可以帮你：- 实现功能"]],
  );
});

test("mergeAgentMessages replaces provider paragraph chunks with a later combined stream message", () => {
  const merged = [
    {
      id: "provider-message-1#p0",
      role: "assistant",
      text: "你好！",
      timestamp: "2026-05-07T08:00:00.000Z",
    },
    {
      id: "provider-message-1#p1",
      role: "assistant",
      text: "我可以帮你：",
      timestamp: "2026-05-07T08:00:01.000Z",
    },
    {
      id: "provider-message-1",
      role: "assistant",
      text: "你好！我可以帮你：",
      timestamp: "2026-05-07T08:00:02.000Z",
    },
  ].reduce<AgentMessage[]>(
    (items, message) => mergeAgentMessages(items, message as AgentMessage),
    [],
  );

  assert.deepEqual(
    merged.map((message) => [message.id, message.text]),
    [["provider-message-1", "你好！我可以帮你："]],
  );
});

test("mergeAgentMessages merges provider paragraph chunks from the same ACP stream segment", () => {
  const merged = [
    {
      id: "provider-message-1#p0",
      role: "assistant",
      text: "你好！",
      timestamp: "2026-05-07T08:00:00.000Z",
    },
    {
      id: "provider-message-1#p1",
      role: "assistant",
      text: "我可以帮你：",
      timestamp: "2026-05-07T08:00:01.000Z",
    },
    {
      id: "provider-message-1#p2",
      role: "assistant",
      text: "- 实现功能",
      timestamp: "2026-05-07T08:00:02.000Z",
    },
  ].reduce<AgentMessage[]>(
    (items, message) => mergeAgentMessages(items, message as AgentMessage),
    [],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.text, "你好！我可以帮你：- 实现功能");
  assert.equal(merged[0]?.id, "provider-message-1#p0");
});

test("mergeAgentMessages splits provider paragraph chunks at tool boundaries", () => {
  const boundary = Date.parse("2026-05-07T08:00:01.500Z");
  const merged = [
    {
      id: "provider-message-1#p0",
      role: "assistant",
      text: "工具前说明",
      timestamp: "2026-05-07T08:00:01.000Z",
    },
    {
      id: "provider-message-1#p1",
      role: "assistant",
      text: "工具后继续",
      timestamp: "2026-05-07T08:00:02.000Z",
    },
  ].reduce<AgentMessage[]>(
    (items, message) => mergeAgentMessages(items, message as AgentMessage, [boundary]),
    [],
  );

  assert.deepEqual(
    merged.map((message) => message.text),
    ["工具前说明", "工具后继续"],
  );
});

test("mergeMessageHistory collapses accumulated assistant chunks when history returns the same stream segment", () => {
  const current: AgentMessage[] = [
    {
      id: "provider-message-1#p0",
      role: "assistant",
      text: "你好！",
      timestamp: "2026-05-07T08:00:00.000Z",
    },
    {
      id: "provider-message-1#p1",
      role: "assistant",
      text: "我可以帮你：",
      timestamp: "2026-05-07T08:00:01.000Z",
    },
    {
      id: "provider-message-1#p2",
      role: "assistant",
      text: "- 实现功能",
      timestamp: "2026-05-07T08:00:02.000Z",
    },
  ];

  const merged = mergeMessageHistory(current, [
    {
      id: "provider-message-1",
      role: "assistant",
      text: "你好！我可以帮你：- 实现功能",
      timestamp: "2026-05-07T08:00:00.000Z",
    },
  ]);

  assert.deepEqual(
    merged.map((message) => [message.id, message.text]),
    [["provider-message-1", "你好！我可以帮你：- 实现功能"]],
  );
});

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

test("mergeAgentMessages collapses replayed assistant text without line breaks", () => {
  const replayedText =
    "我会使用 `superpowers:systematic-debugging` 来先定位根因，再做最小修复喵~[🌳木] 目标：定位并修复 mission 页左侧项目展开/收起失效的根因；验收是能通过代码/类型检查，并给出可复核的交互点。先读取项目上下文与相关代码喵~";

  const replayHead = replayedText.slice(0, 55);
  const replayTail = replayedText.slice(55);
  const merged = [
    {
      id: "session-1-msg-1000",
      role: "assistant",
      text: replayHead,
      timestamp: "2026-04-28T10:00:01.000Z",
    },
    {
      id: "session-1-msg-1001",
      role: "assistant",
      text: replayTail,
      timestamp: "2026-04-28T10:00:02.000Z",
    },
    {
      id: "session-1-msg-1002",
      role: "assistant",
      text: replayHead,
      timestamp: "2026-04-28T10:00:03.000Z",
    },
    {
      id: "session-1-msg-1003",
      role: "assistant",
      text: replayTail,
      timestamp: "2026-04-28T10:00:04.000Z",
    },
  ].reduce<AgentMessage[]>(
    (items, message) => mergeAgentMessages(items, message as AgentMessage),
    [],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.text, replayedText);
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

test("mergeAgentMessages merges stable alphanumeric runtime assistant chunks", () => {
  const merged = [
    {
      id: "019dfc94-a921-7112-8980-8d57cd537787-msg-11jmeuu",
      role: "assistant",
      text: "具体",
      timestamp: "2026-05-06T12:06:32.267Z",
    },
    {
      id: "019dfc94-a921-7112-8980-8d57cd537787-msg-13ipn7f",
      role: "assistant",
      text: "消息内容",
      timestamp: "2026-05-06T12:06:32.275Z",
    },
  ].reduce<AgentMessage[]>(
    (items, message) => mergeAgentMessages(items, message as AgentMessage),
    [],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.text, "具体消息内容");
});

test("mergeAgentMessages keeps non-runtime assistant ids separate", () => {
  const merged = mergeAgentMessages(
    [
      {
        id: "assistant-msg-alpha",
        role: "assistant",
        text: "第一条",
        timestamp: "2026-05-06T12:06:32.267Z",
      },
    ],
    {
      id: "assistant-msg-beta",
      role: "assistant",
      text: "第二条",
      timestamp: "2026-05-06T12:06:32.275Z",
    },
  );

  assert.deepEqual(
    merged.map((message) => message.text),
    ["第一条", "第二条"],
  );
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
