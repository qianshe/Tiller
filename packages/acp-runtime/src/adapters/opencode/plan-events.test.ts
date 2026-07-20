import assert from "node:assert/strict";
import test from "node:test";
import { SUPPRESS_SESSION_UPDATE } from "../types";
import { extractOpenCodePlanFromToolCall, mapOpenCodePlanUpdate } from "./plan-events";

test("mapOpenCodePlanUpdate converts todowrite tool calls into plan updates", () => {
  const event = mapOpenCodePlanUpdate({
    sessionId: "session-opencode-plan",
    updateType: "tool_call_update",
    text: null,
    update: {
      toolCall: {
        id: "call-todo",
        tool: "todowrite",
        status: "completed",
        state: {
          input: {
            todos: [
              { content: "检查 ACP plan", status: "completed" },
              { content: "渲染抽屉", status: "in_progress" },
              { content: "跑测试", status: "pending" },
            ],
          },
        },
      },
    },
    now: "2026-06-02T00:00:00.000Z",
  });

  assert.deepEqual(event, {
    type: "plan-update",
    plan: {
      updatedAt: "2026-06-02T00:00:00.000Z",
      entries: [
        { content: "检查 ACP plan", priority: "medium", status: "completed" },
        { content: "渲染抽屉", priority: "medium", status: "in_progress" },
        { content: "跑测试", priority: "medium", status: "pending" },
      ],
    },
  });
});

test("mapOpenCodePlanUpdate ignores non-todo tool calls", () => {
  const event = mapOpenCodePlanUpdate({
    sessionId: "session-opencode-plan",
    updateType: "tool_call_update",
    text: null,
    update: {
      toolCall: {
        id: "call-read",
        tool: "read",
        input: { path: "README.md" },
      },
    },
    now: "2026-06-02T00:00:00.000Z",
  });

  assert.equal(event, null);
});

test("mapOpenCodePlanUpdate suppresses count-only todo tool calls", () => {
  const event = mapOpenCodePlanUpdate({
    sessionId: "session-opencode-plan",
    updateType: "tool_call_update",
    text: null,
    update: {
      toolCall: {
        id: "call-todo-count",
        tool: "todowrite",
        title: "1 todos",
        status: "completed",
      },
    },
    now: "2026-06-02T00:00:00.000Z",
  });

  assert.equal(event, SUPPRESS_SESSION_UPDATE);
});

test("mapOpenCodePlanUpdate suppresses title-only todowrite frames without todo payload", () => {
  const event = mapOpenCodePlanUpdate({
    sessionId: "session-opencode-plan",
    updateType: "tool_call_update",
    text: null,
    update: {
      toolCall: {
        id: "call-todo-empty-frame",
        title: "todowrite",
        kind: "write",
        input: "{}",
        status: "completed",
      },
    },
    now: "2026-06-02T00:00:00.000Z",
  });

  assert.equal(event, SUPPRESS_SESSION_UPDATE);
});

test("mapOpenCodePlanUpdate projects title-only todo updates when rawInput carries the todo list", () => {
  const event = mapOpenCodePlanUpdate({
    sessionId: "session-opencode-plan",
    updateType: "tool_call_update",
    text: null,
    update: {
      toolCall: {
        id: "call-todo-count-with-payload",
        title: "3 todos",
        kind: "write",
        rawInput: {
          todos: [
            { content: "读文件", status: "completed" },
            { content: "AST 搜索", status: "in_progress" },
            { content: "写总结", status: "pending" },
          ],
        },
      },
    },
    now: "2026-06-02T00:00:00.000Z",
  });

  assert.deepEqual(event, {
    type: "plan-update",
    plan: {
      updatedAt: "2026-06-02T00:00:00.000Z",
      entries: [
        { content: "读文件", priority: "medium", status: "completed" },
        { content: "AST 搜索", priority: "medium", status: "in_progress" },
        { content: "写总结", priority: "medium", status: "pending" },
      ],
    },
  });
});

test("mapOpenCodePlanUpdate reads completed todo snapshots from ACP rawOutput metadata", () => {
  const event = mapOpenCodePlanUpdate({
    sessionId: "session-opencode-plan",
    updateType: "tool_call_update",
    text: null,
    update: {
      toolCallId: "call-todo-completed",
      title: "1 todos",
      status: "completed",
      rawOutput: {
        output: "[]",
        metadata: {
          todos: [{ content: "完成写入", status: "completed", priority: "high" }],
        },
      },
    },
    now: "2026-07-20T00:00:00.000Z",
  });

  assert.deepEqual(event, {
    type: "plan-update",
    plan: {
      updatedAt: "2026-07-20T00:00:00.000Z",
      entries: [{ content: "完成写入", priority: "high", status: "completed" }],
    },
  });
});

test("extractOpenCodePlanFromToolCall tolerates replayed non-todo kinds when payload still carries todos", () => {
  const plan = extractOpenCodePlanFromToolCall({
    id: "call-replayed-todo",
    kind: "write",
    title: "2 todos",
    status: "completed",
    input: JSON.stringify({
      todos: [
        { content: "第一步", status: "completed" },
        { content: "第二步", status: "pending" },
      ],
    }),
    timestamp: "2026-07-07T14:55:27.626Z",
    updatedAt: "2026-07-07T14:55:28.195Z",
  });

  assert.deepEqual(plan, {
    updatedAt: "2026-07-07T14:55:28.195Z",
    entries: [
      { content: "第一步", priority: "medium", status: "completed" },
      { content: "第二步", priority: "medium", status: "pending" },
    ],
  });
});
