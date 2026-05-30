import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentMessage, AgentToolCall } from "@tiller/shared";
import { buildSessionTimelineFromLegacy } from "@tiller/shared";
import { createSqliteSessionTimelineStore } from "./sqlite/timeline-store";
import { pageSessionTimeline } from "./timeline-store";

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

test("sqlite timeline store persists ordered unified entries", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-timeline-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const store = createSqliteSessionTimelineStore(dbPath);

  try {
    const entries = buildSessionTimelineFromLegacy({
      messages: [
        message({ id: "assistant-1", role: "assistant", text: "Done", timelineSequence: 3 }),
        message({ id: "user-1", role: "user", text: "Start", timelineSequence: 1 }),
      ],
      toolCalls: [
        toolCall({
          id: "assistant-1:thinking",
          commandId: "assistant-1:thinking",
          kind: "think",
          output: "Reasoning",
          status: "completed",
          title: "Thinking",
          timelineSequence: 2,
        }),
      ],
      outputs: [],
    });

    store.replace("session-1", entries);

    const persisted = store.list("session-1");
    assert.deepEqual(
      persisted.map((entry) => entry.kind),
      ["user_message", "assistant_message"],
    );
    assert.deepEqual(
      persisted[1]?.kind === "assistant_message"
        ? persisted[1].chunks.map((chunk) => chunk.kind)
        : [],
      ["thinking", "content"],
    );
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("timeline message window pagination includes tool entries between the latest content messages", () => {
  const entries = buildSessionTimelineFromLegacy({
    messages: [
      message({ id: "assistant-intro", role: "assistant", text: "intro", timelineSequence: 1 }),
      message({ id: "assistant-final", role: "assistant", text: "final", timelineSequence: 6 }),
    ],
    toolCalls: Array.from({ length: 4 }, (_, index) =>
      toolCall({
        id: `tool-${index}`,
        kind: "read",
        status: "completed",
        title: `Read ${index}`,
        timelineSequence: index + 2,
      }),
    ),
  });

  const page = pageSessionTimeline(entries, {
    limit: 2,
    window: "message",
  });

  assert.deepEqual(
    page.entries.map((entry) => entry.id),
    [
      "assistant-intro",
      "tool:tool-0",
      "tool:tool-1",
      "tool:tool-2",
      "tool:tool-3",
      "assistant-final",
    ],
  );
  assert.equal(page.hasMore, false);
});

test("timeline message window pagination counts coalesced provider paragraphs as one message block", () => {
  const entries = buildSessionTimelineFromLegacy({
    messages: [
      message({ id: "user-latest", role: "user", text: "继续", timelineSequence: 1 }),
      ...Array.from({ length: 30 }, (_, index) =>
        message({
          id: `assistant-final#p${index}`,
          role: "assistant" as const,
          text: `段落 ${index}`,
          timelineSequence: index + 2,
        }),
      ),
    ],
  });

  const page = pageSessionTimeline(entries, {
    limit: 20,
    window: "message",
  });

  assert.equal(page.entries[0]?.id, "user-latest");
  assert.equal(page.entries.at(-1)?.id, "assistant-final#p29");
  assert.equal(page.hasMore, false);
});
