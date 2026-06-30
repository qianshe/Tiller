import assert from "node:assert/strict";
import test from "node:test";
import type { SessionTimelineEntry } from "@tiller/shared";
import { projectLegacySessionHistoryFromTimeline } from "./legacy-projection.js";

test("projectLegacySessionHistoryFromTimeline rebuilds legacy messages tools and outputs", () => {
  const entries: SessionTimelineEntry[] = [
    {
      id: "user-1",
      kind: "user_message",
      message: {
        id: "user-1",
        role: "user",
        text: "开始",
        timestamp: "2026-06-30T10:00:00.000Z",
        sequence: 1,
      },
      timestamp: "2026-06-30T10:00:00.000Z",
      updatedAt: "2026-06-30T10:00:00.000Z",
      sequence: 1,
    },
    {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-1:thinking",
          kind: "thinking",
          text: "先想一下",
          title: "Thinking",
          status: "completed",
          timestamp: "2026-06-30T10:00:01.000Z",
          updatedAt: "2026-06-30T10:00:01.000Z",
          sequence: 2,
        },
        {
          id: "assistant-1:content",
          kind: "content",
          text: "已经处理",
          timestamp: "2026-06-30T10:00:02.000Z",
          sequence: 3,
        },
      ],
      timestamp: "2026-06-30T10:00:01.000Z",
      updatedAt: "2026-06-30T10:00:02.000Z",
      sequence: 2,
    },
    {
      id: "tool:cmd-1",
      kind: "tool_call",
      toolCall: {
        id: "cmd-1",
        commandId: "cmd-1",
        kind: "shell",
        title: "Shell",
        status: "completed",
        output: "ok",
        stream: "stderr",
        timestamp: "2026-06-30T10:00:03.000Z",
        updatedAt: "2026-06-30T10:00:04.000Z",
        sequence: 4,
      },
      timestamp: "2026-06-30T10:00:03.000Z",
      updatedAt: "2026-06-30T10:00:04.000Z",
      sequence: 4,
    },
  ];

  const projected = projectLegacySessionHistoryFromTimeline(entries);

  assert.deepEqual(
    projected.messages.map((message) => [message.id, message.role, message.text]),
    [
      ["user-1", "user", "开始"],
      ["assistant-1", "assistant", "已经处理"],
    ],
  );
  assert.deepEqual(
    projected.toolCalls.map((toolCall) => [toolCall.id, toolCall.kind, toolCall.output]),
    [
      ["assistant-1:thinking", "think", "先想一下"],
      ["cmd-1", "shell", "ok"],
    ],
  );
  assert.deepEqual(projected.outputs, [{
    id: "timeline-output:cmd-1",
    commandId: "cmd-1",
    text: "ok",
    stream: "stderr",
    timestamp: "2026-06-30T10:00:04.000Z",
    sequence: 4,
  }]);
});
