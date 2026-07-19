import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolCall } from "@tiller/shared";
import { createClaudePlanUpdateProjector } from "./plan-events";

function update(
  id: string,
  title: string,
  input: Record<string, unknown>,
  updatedAt: string,
) {
  return {
    sessionId: "runtime-plan-1",
    updateType: "tool_call" as const,
    update: {
      toolCall: {
        id,
        title,
        rawInput: input,
      },
    },
    text: null,
    now: updatedAt,
  };
}

function taskUpdate(status: string, updatedAt: string): AgentToolCall {
  return {
    id: `task-update-${status}`,
    kind: "think",
    title: "TaskUpdate",
    status: "completed",
    input: JSON.stringify({ taskId: "1", status }),
    timestamp: updatedAt,
    updatedAt,
  };
}

test("Claude plan reconciliation closes a final task from transcript state", () => {
  const projector = createClaudePlanUpdateProjector();
  const initial = projector.mapUpdate(
    update("task-create-1", "TaskCreate", { taskId: "1", subject: "完成计划" }, "2026-07-19T10:00:00.000Z"),
  );
  assert.equal(initial && "type" in initial ? initial.type : null, "plan-update");

  const reconciled = projector.reconcileTaskUpdates("runtime-plan-1", [
    taskUpdate("completed", "2026-07-19T10:00:03.000Z"),
  ]);
  assert.deepEqual(reconciled, {
    entries: [{ content: "完成计划", priority: "medium", status: "completed" }],
    updatedAt: "2026-07-19T10:00:03.000Z",
  });
});

test("Claude plan reconciliation restores the latest task batch when live create was missed", () => {
  const projector = createClaudePlanUpdateProjector();
  const reconciled = projector.reconcileTaskUpdates("runtime-plan-2", [
    {
      id: "task-create-1",
      kind: "think",
      title: "TaskCreate",
      status: "completed",
      input: JSON.stringify({ taskId: "1", subject: "恢复计划" }),
      timestamp: "2026-07-19T10:01:00.000Z",
      updatedAt: "2026-07-19T10:01:00.000Z",
    },
    taskUpdate("completed", "2026-07-19T10:01:03.000Z"),
  ]);
  assert.deepEqual(reconciled?.entries, [
    { content: "恢复计划", priority: "medium", status: "completed" },
  ]);
});
