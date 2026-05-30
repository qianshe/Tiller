import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentMessage, AgentToolCall } from "@tiller/shared";
import { buildSessionTimelineFromLegacy } from "@tiller/shared";
import { createSqliteSessionTimelineStore } from "./sqlite/timeline-store";

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
