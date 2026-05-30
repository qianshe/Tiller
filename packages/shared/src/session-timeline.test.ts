import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentToolCall } from "./types";
import { buildSessionTimelineFromLegacy } from "./session-timeline";

const BASE_TIME = "2026-05-30T10:00:00.000Z";

function at(seconds: number) {
  return new Date(Date.parse(BASE_TIME) + seconds * 1000).toISOString();
}

function message(overrides: Partial<AgentMessage> & Pick<AgentMessage, "id" | "role" | "text" | "timelineSequence">): AgentMessage {
  return {
    timestamp: at(overrides.timelineSequence ?? 0),
    ...overrides,
  };
}

function toolCall(
  overrides: Partial<AgentToolCall> & Pick<AgentToolCall, "id" | "kind" | "status" | "title" | "timelineSequence">,
): AgentToolCall {
  return {
    timestamp: at(overrides.timelineSequence ?? 0),
    updatedAt: at(overrides.timelineSequence ?? 0),
    ...overrides,
  };
}

test("buildSessionTimelineFromLegacy nests assistant content and thinking chunks in sequence order while keeping tool calls independent", () => {
  const timeline = buildSessionTimelineFromLegacy({
    messages: [
      message({ id: "user-1", role: "user", text: "Start", timelineSequence: 1 }),
      message({ id: "assistant-1", role: "assistant", text: "Final answer", timelineSequence: 3 }),
    ],
    toolCalls: [
      toolCall({
        id: "assistant-1:thinking",
        commandId: "assistant-1:thinking",
        kind: "think",
        output: "Plan first",
        status: "completed",
        title: "Thinking",
        timelineSequence: 2,
      }),
      toolCall({
        id: "tool-1",
        commandId: "tool-1",
        kind: "search",
        output: "Search result",
        status: "completed",
        title: "Search",
        timelineSequence: 4,
      }),
    ],
    outputs: [],
  });

  assert.deepEqual(
    timeline.map((entry) => entry.kind),
    ["user_message", "assistant_message", "tool_call"],
  );
  assert.equal(timeline[1]?.id, "assistant-1");
  assert.deepEqual(
    timeline[1]?.kind === "assistant_message"
      ? timeline[1].chunks.map((chunk) => chunk.kind)
      : [],
    ["thinking", "content"],
  );
  assert.equal(
    timeline[2]?.kind === "tool_call" ? timeline[2].toolCall.kind : undefined,
    "search",
  );
});
