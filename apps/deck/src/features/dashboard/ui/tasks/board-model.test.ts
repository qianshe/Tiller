import assert from "node:assert/strict";
import test from "node:test";
import { resolveTaskBoardColumn, TASK_BOARD_COLUMNS } from "./board-model";

const baseSession = {
  id: "session-1",
  title: "Task",
  agentName: "Codex",
};

test("task board separates runtime and attention states", () => {
  assert.equal(resolveTaskBoardColumn({ ...baseSession, status: "starting" }), "running");
  assert.equal(resolveTaskBoardColumn({ ...baseSession, status: "running" }), "running");
  assert.equal(resolveTaskBoardColumn({ ...baseSession, status: "waiting_for_permission" }), "attention");
  assert.equal(resolveTaskBoardColumn({ ...baseSession, status: "error" }), "attention");
});

test("task board places idle work before attention items", () => {
  assert.deepEqual(
    TASK_BOARD_COLUMNS.map((column) => column.id),
    ["ready", "running", "idle", "attention"],
  );
});

test("idle and completed sessions share the idle column", () => {
  assert.equal(resolveTaskBoardColumn({ ...baseSession, status: "idle" }), "idle");
  assert.equal(resolveTaskBoardColumn({ ...baseSession, status: "completed" }), "idle");
});

test("unassigned inactive sessions are prepared work", () => {
  assert.equal(
    resolveTaskBoardColumn({ ...baseSession, agentName: null, status: "idle" }),
    "ready",
  );
  assert.equal(resolveTaskBoardColumn({ ...baseSession, status: "cancelled" }), "attention");
});
