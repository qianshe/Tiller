import assert from "node:assert/strict";
import test from "node:test";
import { SUPPRESS_SESSION_UPDATE } from "../types";
import { mapOpenCodePlanUpdate } from "./plan-events";

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
