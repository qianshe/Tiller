import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentToolCall } from "@tiller/shared";
import { buildActivityTimeline } from "./activity-log-panel";

function prompt(sequence: number | undefined, timestamp: string): AgentMessage {
  return {
    id: "prompt-1",
    role: "user",
    text: "Continue",
    timestamp,
    ...(sequence === undefined ? {} : { sequence }),
  };
}

function tool(sequence: number, timestamp: string): AgentToolCall {
  return {
    id: "tool-1",
    kind: "read",
    title: "Read",
    status: "completed",
    timestamp,
    updatedAt: timestamp,
    sequence,
  };
}

function activityIds(items: ReturnType<typeof buildActivityTimeline>) {
  return items.map((item) => item.kind === "prompt" ? item.id : item.item.id);
}

test("activity log orders complete canonical sequences instead of timestamps", () => {
  const items = buildActivityTimeline(
    [tool(2, "2026-07-11T10:00:02.000Z")],
    [],
    [prompt(1, "2026-07-11T10:00:01.000Z")],
  );

  assert.deepEqual(activityIds(items), ["prompt-1", "tool-1"]);
});

test("activity log preserves source order when a sequence is missing", () => {
  const items = buildActivityTimeline(
    [tool(2, "2026-07-11T10:00:02.000Z")],
    [],
    [prompt(undefined, "2026-07-11T10:00:01.000Z")],
  );

  assert.deepEqual(activityIds(items), ["prompt-1", "tool-1"]);
});
