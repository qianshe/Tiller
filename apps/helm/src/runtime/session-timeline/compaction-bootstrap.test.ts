import assert from "node:assert/strict";
import test from "node:test";
import type { SessionTimelineEntry } from "@tiller/shared";
import { repairCompactionBootstrapTimeline } from "./compaction-bootstrap";

function at(base: string, offsetMs: number) {
  return new Date(Date.parse(base) + offsetMs).toISOString();
}

test("repairCompactionBootstrapTimeline reanchors a trailing compaction using timeline entries when legacy messages are absent", () => {
  const base = "2026-06-24T09:31:29.089Z";
  const result = repairCompactionBootstrapTimeline({
    sessionId: "session-1",
    messages: [],
    timeline: [
      {
        id: "assistant-1",
        kind: "assistant_message",
        chunks: [{
          id: "assistant-1:content",
          kind: "content",
          text: "older answer",
          timestamp: at(base, 0),
          sequence: 1,
        }],
        timestamp: at(base, 0),
        updatedAt: at(base, 0),
        sequence: 1,
      },
      {
        id: "tool:1",
        kind: "tool_call",
        toolCall: {
          id: "tool-1",
          kind: "read",
          title: "Read",
          status: "completed",
          timestamp: at(base, 2),
          updatedAt: at(base, 2),
          sequence: 2,
        },
        timestamp: at(base, 2),
        updatedAt: at(base, 2),
        sequence: 2,
      },
      {
        id: "compaction:session-1:summary-1",
        kind: "context_compaction",
        phase: "completed",
        source: "heuristic",
        summaryMessageId: "summary-1",
        summaryText: "continued from previous conversation",
        timestamp: "2026-07-03T08:55:31.981Z",
        updatedAt: "2026-07-03T08:55:31.981Z",
        replayCompleteness: "compacted",
      },
    ] satisfies SessionTimelineEntry[],
  });

  assert.ok(result);
  assert.deepEqual(
    result.entries.map((entry) => entry.id),
    ["compaction:session-1:summary-1", "assistant-1", "tool:1"],
  );
  assert.equal(result.synthesizedBoundary, false);
});

test("repairCompactionBootstrapTimeline moves a trailing compaction cluster ahead of the first replay entry", () => {
  const base = "2026-06-27T08:26:37.048Z";
  const result = repairCompactionBootstrapTimeline({
    sessionId: "session-2",
    messages: [],
    timeline: [
      {
        id: "assistant-1",
        kind: "assistant_message",
        chunks: [{
          id: "assistant-1:content",
          kind: "content",
          text: "first replay answer",
          timestamp: at(base, 0),
          sequence: 1,
        }],
        timestamp: at(base, 0),
        updatedAt: at(base, 0),
        sequence: 1,
      },
      {
        id: "user-1",
        kind: "user_message",
        message: {
          id: "user-1",
          role: "user",
          text: "continue",
          timestamp: at(base, 2),
          sequence: 2,
        },
        timestamp: at(base, 2),
        updatedAt: at(base, 2),
        sequence: 2,
      },
      {
        id: "compaction:session-2:summary-1",
        kind: "context_compaction",
        phase: "completed",
        source: "heuristic",
        summaryMessageId: "summary-1",
        summaryText: "older summary",
        timestamp: "2026-07-03T08:55:06.254Z",
        updatedAt: "2026-07-03T08:55:06.254Z",
        replayCompleteness: "compacted",
      },
      {
        id: "compaction:session-2:summary-2",
        kind: "context_compaction",
        phase: "completed",
        source: "heuristic",
        summaryMessageId: "summary-2",
        summaryText: "newer summary",
        timestamp: "2026-07-03T08:55:06.349Z",
        updatedAt: "2026-07-03T08:55:06.349Z",
        replayCompleteness: "compacted",
      },
    ] satisfies SessionTimelineEntry[],
  });

  assert.ok(result);
  assert.deepEqual(
    result.entries.map((entry) => entry.id),
    [
      "compaction:session-2:summary-1",
      "compaction:session-2:summary-2",
      "assistant-1",
      "user-1",
    ],
  );
  assert.equal(result.entries[0]?.timestamp < result.entries[2]?.timestamp, true);
  assert.equal(result.entries[1]?.timestamp < result.entries[2]?.timestamp, true);
});
