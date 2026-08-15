import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionActivitySummary } from "./activity-summary-rpc.js";

const now = Date.parse("2026-08-09T12:34:56.000Z");

function userEntry(id: string, timestamp: string) {
  return {
    id,
    kind: "user_message" as const,
    message: {},
    timestamp,
    updatedAt: timestamp,
  };
}

function toolEntry(id: string, timestamp: string, entryTimestamp = timestamp) {
  return {
    id: `tool:${id}`,
    kind: "tool_call" as const,
    toolCall: {
      id,
      kind: "tool" as const,
      title: id,
      status: "completed" as const,
      timestamp,
      updatedAt: timestamp,
    },
    timestamp: entryTimestamp,
    updatedAt: timestamp,
  };
}

test("buildSessionActivitySummary scans persisted timelines without opening sessions", () => {
  const summary = buildSessionActivitySummary(
    new Map([
      ["session-1", [
        userEntry("prompt-recent", "2026-08-09T10:00:00.000Z"),
        userEntry("prompt-older", "2026-08-08T11:00:00.000Z"),
        toolEntry("tool-recent", "2026-08-09T11:00:00.000Z"),
        toolEntry("tool-month", "2026-07-11T12:00:00.000Z"),
        toolEntry("tool-old", "2026-06-01T12:00:00.000Z"),
        userEntry("prompt-future", "2026-08-10T10:00:00.000Z"),
      ]],
      ["session-2", []],
    ]) as any,
    now,
  );

  assert.equal(summary.generatedAt, "2026-08-09T12:34:56.000Z");
  assert.equal(summary.promptCount, 1);
  assert.equal(summary.recentToolCallCount, 1);
  assert.equal(summary.toolCallCount, 3);
  assert.deepEqual(summary.activityTrend.find((point) => point.date === "2026-08-09"), {
    date: "2026-08-09",
    promptCount: 1,
    toolCallCount: 1,
  });
  assert.deepEqual(summary.activityTrend.find((point) => point.date === "2026-08-08"), {
    date: "2026-08-08",
    promptCount: 1,
    toolCallCount: 0,
  });
  assert.deepEqual(summary.activityTrend.find((point) => point.date === "2026-07-11"), {
    date: "2026-07-11",
    promptCount: 0,
    toolCallCount: 1,
  });
  assert.deepEqual(summary.activityTrendHourly.at(-2), {
    date: "2026-08-09T11:00:00.000Z",
    promptCount: 0,
    toolCallCount: 1,
  });
});
