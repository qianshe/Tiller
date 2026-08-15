import assert from "node:assert/strict";
import test from "node:test";
import { resolveTaskBoardColumn, TASK_BOARD_COLUMNS } from "./board-model";

const baseSession = {
  id: "session-1",
  title: "Task",
  agentId: "codex",
  agentName: "Codex",
  runtimeSessionId: "runtime-1",
};

test("task board separates runtime and attention states", () => {
  assert.equal(resolveTaskBoardColumn({ ...baseSession, status: "starting" }), "running");
  assert.equal(resolveTaskBoardColumn({ ...baseSession, status: "running" }), "running");
  assert.equal(resolveTaskBoardColumn({ ...baseSession, status: "waiting_for_permission" }), "attention");
  assert.equal(resolveTaskBoardColumn({ ...baseSession, status: "error" }), "attention");
});

test("task board places idle work after attention items", () => {
  assert.deepEqual(
    TASK_BOARD_COLUMNS.map((column) => column.id),
    ["ready", "running", "completed", "attention", "idle"],
  );
});

test("only unread completed sessions enter the completed column", () => {
  assert.equal(resolveTaskBoardColumn({ ...baseSession, status: "idle" }), "idle");
  assert.equal(
    resolveTaskBoardColumn({ ...baseSession, status: "idle", completedUnread: true }),
    "completed",
  );
  assert.equal(resolveTaskBoardColumn({ ...baseSession, status: "completed" }), "idle");
  assert.equal(resolveTaskBoardColumn({ ...baseSession, status: "cancelled" }), "idle");
  assert.equal(resolveTaskBoardColumn({ ...baseSession, status: "canceled" }), "idle");
});

test("only explicit preparation records enter the ready column", () => {
  assert.equal(
    resolveTaskBoardColumn({ ...baseSession, agentId: null, agentName: null, status: "idle" }),
    "idle",
  );
  assert.equal(
    resolveTaskBoardColumn({ ...baseSession, agentId: null, agentName: "旧 Agent 名称", status: "idle" }),
    "idle",
  );
  assert.equal(
    resolveTaskBoardColumn({ ...baseSession, runtimeSessionId: undefined, status: "idle" }),
    "idle",
  );
  assert.equal(resolveTaskBoardColumn({ ...baseSession, preparationId: "preparation-1" }), "ready");
});
