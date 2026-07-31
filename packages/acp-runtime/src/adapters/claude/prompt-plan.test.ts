import assert from "node:assert/strict";
import test from "node:test";
import { createClaudePromptPlanObserver } from "./prompt-plan";

const context = {
  runtimeSessionId: "runtime-claude-plan-1",
  cwd: "D:/repo",
};

test("Claude prompt plan observer publishes a changed transcript plan once", () => {
  let revision = "in-progress";
  const observer = createClaudePromptPlanObserver(
    (_context, toolCalls) => toolCalls.length
      ? {
          entries: [{ content: "最后一项", priority: "medium", status: "completed" }],
          updatedAt: "2026-07-19T10:02:00.000Z",
        }
      : null,
    {
      read: () => ({
        revision,
        toolCalls: revision === "in-progress" ? [] : [{
          id: "task-update-1",
          kind: "todo",
          title: "TaskUpdate",
          status: "completed",
          input: JSON.stringify({ taskId: "1", status: "completed" }),
          timestamp: "2026-07-19T10:02:00.000Z",
          updatedAt: "2026-07-19T10:02:00.000Z",
        }],
      }),
    },
  );

  assert.deepEqual(observer.poll(context), []);
  revision = "completed";
  assert.deepEqual(observer.poll(context), [{
    type: "plan-update",
    plan: {
      entries: [{ content: "最后一项", priority: "medium", status: "completed" }],
      updatedAt: "2026-07-19T10:02:00.000Z",
    },
  }]);
  assert.deepEqual(observer.poll(context), []);
});
