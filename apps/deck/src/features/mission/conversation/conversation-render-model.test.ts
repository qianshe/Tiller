import assert from "node:assert/strict";
import test from "node:test";
import type { SessionTimelineEntry } from "@tiller/shared";
import { buildConversationRenderItems } from "./conversation-render-model";

test("continuous ordinary tool_call entries project into one tool-group while subagent stays separate", () => {
  const items = buildConversationRenderItems([
    {
      kind: "tool_call",
      id: "tool:1",
      toolCall: { id: "1", kind: "read", title: "Read", status: "completed", timestamp: "2026-06-29T10:00:01.000Z", updatedAt: "2026-06-29T10:00:01.000Z", sequence: 1 },
      timestamp: "2026-06-29T10:00:01.000Z",
      updatedAt: "2026-06-29T10:00:01.000Z",
      sequence: 1,
    },
    {
      kind: "tool_call",
      id: "tool:2",
      toolCall: { id: "2", kind: "write", title: "Write", status: "completed", timestamp: "2026-06-29T10:00:02.000Z", updatedAt: "2026-06-29T10:00:02.000Z", sequence: 2 },
      timestamp: "2026-06-29T10:00:02.000Z",
      updatedAt: "2026-06-29T10:00:02.000Z",
      sequence: 2,
    },
    {
      kind: "tool_call",
      id: "tool:3",
      toolCall: { id: "3", kind: "subagent", title: "Task", status: "completed", timestamp: "2026-06-29T10:00:03.000Z", updatedAt: "2026-06-29T10:00:03.000Z", sequence: 3 },
      timestamp: "2026-06-29T10:00:03.000Z",
      updatedAt: "2026-06-29T10:00:03.000Z",
      sequence: 3,
    },
  ] as SessionTimelineEntry[]);

  assert.deepEqual(items.map((item) => item.kind), ["tool-group", "subagent"]);
});

test("assistant message chunks project as message render items", () => {
  const items = buildConversationRenderItems([
    {
      kind: "assistant_message",
      id: "assistant-1",
      chunks: [
        { id: "assistant-1:content", kind: "content", text: "Hello world", timestamp: "2026-06-29T10:00:01.000Z", sequence: 1 },
      ],
      timestamp: "2026-06-29T10:00:01.000Z",
      updatedAt: "2026-06-29T10:00:01.000Z",
      sequence: 1,
    },
  ] as SessionTimelineEntry[]);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.kind, "message");
  if (items[0]?.kind === "message") {
    assert.equal(items[0].role, "assistant");
    assert.equal(items[0].text, "Hello world");
  }
});

test("thinking chunks project as thinking render items", () => {
  const items = buildConversationRenderItems([
    {
      kind: "assistant_message",
      id: "assistant-1",
      chunks: [
        { id: "think-1", kind: "thinking", text: "Planning...", title: "Thinking", status: "completed", timestamp: "2026-06-29T10:00:01.000Z", updatedAt: "2026-06-29T10:00:01.000Z", sequence: 1 },
        { id: "assistant-1:content", kind: "content", text: "Done.", timestamp: "2026-06-29T10:00:02.000Z", sequence: 2 },
      ],
      timestamp: "2026-06-29T10:00:01.000Z",
      updatedAt: "2026-06-29T10:00:02.000Z",
      sequence: 1,
    },
  ] as SessionTimelineEntry[]);

  assert.deepEqual(items.map((item) => item.kind), ["thinking", "message"]);
});

test("context_compaction and session_resumed project as distinct items", () => {
  const items = buildConversationRenderItems([
    {
      kind: "context_compaction",
      id: "compaction-1",
      summaryText: "Session compacted.",
      timestamp: "2026-06-29T10:00:01.000Z",
      updatedAt: "2026-06-29T10:00:01.000Z",
      replayCompleteness: "compacted",
    },
    {
      kind: "session_resumed",
      id: "resume-1",
      restoreMethod: "session/load",
      timestamp: "2026-06-29T10:00:02.000Z",
      updatedAt: "2026-06-29T10:00:02.000Z",
      replayCompleteness: "compacted",
    },
  ] as SessionTimelineEntry[]);

  assert.deepEqual(items.map((item) => item.kind), ["context-compaction", "session-resumed"]);
});
