import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthoritativeHistoryFromEvents } from "./history-events.js";

test("buildAuthoritativeHistoryFromEvents assembles messages tools and results in event order", () => {
  const history = buildAuthoritativeHistoryFromEvents([
    {
      kind: "message",
      id: "user-1",
      role: "user",
      text: "看这张图",
      timestamp: "2026-05-31T00:00:00.000Z",
      attachments: [{ type: "image", data: "png", mimeType: "image/png", name: "screen.png" }],
    },
    {
      kind: "thinking",
      id: "think-1",
      text: "先分析",
      timestamp: "2026-05-31T00:00:01.000Z",
    },
    {
      kind: "tool_call",
      id: "call-1",
      title: "Read",
      toolKind: "read",
      input: "{\"path\":\"a.ts\"}",
      timestamp: "2026-05-31T00:00:02.000Z",
    },
    {
      kind: "tool_result",
      id: "call-1",
      output: "ok",
      timestamp: "2026-05-31T00:00:03.000Z",
    },
    {
      kind: "message",
      id: "assistant-1",
      role: "assistant",
      text: "完成",
      timestamp: "2026-05-31T00:00:04.000Z",
    },
  ]);

  assert.deepEqual(
    history.messages.map((message) => [message.id, message.timelineSequence]),
    [
      ["user-1", 1],
      ["assistant-1", 4],
    ],
  );
  assert.deepEqual(
    history.toolCalls.map((tool) => [tool.id, tool.kind, tool.status, tool.timelineSequence]),
    [
      ["think-1", "think", "completed", 2],
      ["call-1", "read", "completed", 3],
    ],
  );
  assert.equal(history.toolCalls[1]?.output, "ok");
});

test("buildAuthoritativeHistoryFromEvents uses image fallback for image-only messages", () => {
  const history = buildAuthoritativeHistoryFromEvents([
    {
      kind: "message",
      id: "user-image",
      role: "user",
      timestamp: "2026-05-31T00:00:00.000Z",
      attachments: [{ type: "image", data: "webp", mimeType: "image/webp" }],
    },
  ]);

  assert.equal(history.messages[0]?.text, "图片 1 张");
});

test("buildAuthoritativeHistoryFromEvents can coalesce repeated thinking events", () => {
  const history = buildAuthoritativeHistoryFromEvents(
    [
      {
        kind: "thinking",
        id: "msg:thinking",
        text: "first",
        timestamp: "2026-05-31T00:00:01.000Z",
        updatedAt: "2026-05-31T00:00:02.000Z",
      },
      {
        kind: "thinking",
        id: "msg:thinking",
        text: "second",
        timestamp: "2026-05-31T00:00:03.000Z",
        updatedAt: "2026-05-31T00:00:04.000Z",
      },
    ],
    { coalesceThinking: true },
  );

  assert.equal(history.toolCalls.length, 1);
  assert.equal(history.toolCalls[0]?.output, "first\n\nsecond");
  assert.equal(history.toolCalls[0]?.timelineSequence, 1);
  assert.equal(history.toolCalls[0]?.updatedAt, "2026-05-31T00:00:04.000Z");
});
