import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentMessage, AgentToolCall, SessionTimelineEntry } from "@tiller/shared";
import { buildSessionTimelineFromLegacy } from "@tiller/shared";
import { createSqliteSessionTimelineStore } from "./sqlite/timeline-store";
import { pageSessionTimeline } from "./timeline-store";

const BASE_TIME = "2026-05-30T10:00:00.000Z";
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

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

test("sqlite timeline append updates an existing entry without moving its persisted position", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-timeline-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const store = createSqliteSessionTimelineStore(dbPath);

  try {
    store.append("session-1", {
      id: "user-1",
      kind: "user_message",
      message: message({ id: "user-1", role: "user", text: "start", timelineSequence: 1 }),
      timestamp: at(1),
      updatedAt: at(1),
      timelineSequence: 1,
    });
    store.append("session-1", {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [{ id: "assistant-1:content", kind: "content", text: "done", timestamp: at(2), timelineSequence: 2 }],
      timestamp: at(2),
      updatedAt: at(2),
      timelineSequence: 2,
    });
    store.append("session-1", {
      id: "user-1",
      kind: "user_message",
      message: message({ id: "user-1", role: "user", text: "start edited", timelineSequence: 99, timestamp: at(99) }),
      timestamp: at(99),
      updatedAt: at(99),
      timelineSequence: 99,
    });

    const db = new DatabaseSync(dbPath);
    try {
      const rows = db
        .prepare("SELECT id, position FROM session_timeline_entries WHERE session_id = ? ORDER BY position ASC")
        .all("session-1") as Array<{ id: string; position: number }>;
      assert.deepEqual(rows.map((row) => ({ id: row.id, position: row.position })), [
        { id: "user-1", position: 0 },
        { id: "assistant-1", position: 1 },
      ]);
    } finally {
      db.close();
    }
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("sqlite timeline listPage returns the newest page in display order with a position cursor", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-timeline-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const store = createSqliteSessionTimelineStore(dbPath);

  try {
    const entries: SessionTimelineEntry[] = Array.from({ length: 5 }, (_, index) => ({
      id: `assistant-${index}`,
      kind: "assistant_message" as const,
      chunks: [{
        id: `assistant-${index}:content`,
        kind: "content" as const,
        text: `message ${index}`,
        timestamp: at(index),
        timelineSequence: index,
      }],
      timestamp: at(index),
      updatedAt: at(index),
      timelineSequence: index,
    }));
    store.replace("session-1", entries);

    const latest = store.listPage("session-1", { limit: 2 });
    const older = store.listPage("session-1", { limit: 2, before: latest.nextCursor });

    assert.deepEqual(latest.entries.map((entry) => entry.id), ["assistant-3", "assistant-4"]);
    assert.equal(latest.nextCursor, "order\t3\tassistant-3");
    assert.equal(latest.hasMore, true);
    assert.deepEqual(older.entries.map((entry) => entry.id), ["assistant-1", "assistant-2"]);
    assert.equal(older.nextCursor, "order\t1\tassistant-1");
    assert.equal(older.hasMore, true);
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});

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

test("timeline message window pagination caps dense entry pages", () => {
  const entries = buildSessionTimelineFromLegacy({
    messages: [
      message({ id: "assistant-intro", role: "assistant", text: "intro", timelineSequence: 1 }),
      message({ id: "assistant-final", role: "assistant", text: "final", timelineSequence: 142 }),
    ],
    toolCalls: Array.from({ length: 140 }, (_, index) =>
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
    entryLimit: 50,
    limit: 2,
    window: "message",
  });
  const olderPage = pageSessionTimeline(entries, {
    before: page.nextCursor,
    entryLimit: 50,
    limit: 2,
    window: "message",
  });

  assert.equal(page.entries.length, 50);
  assert.equal(page.entries[0]?.id, "tool:tool-91");
  assert.equal(page.entries.at(-1)?.id, "assistant-final");
  assert.equal(page.hasMore, true);
  assert.equal(olderPage.entries.length, 50);
  assert.equal(olderPage.entries[0]?.id, "tool:tool-41");
  assert.equal(olderPage.entries.at(-1)?.id, "tool:tool-90");
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

test("timeline pagination preserves persisted order with partial sequence data", () => {
  const entries: SessionTimelineEntry[] = [
    {
      id: "user-1",
      kind: "user_message",
      message: message({ id: "user-1", role: "user", text: "start", timelineSequence: 1, timestamp: at(30) }),
      timestamp: at(30),
      updatedAt: at(30),
      timelineSequence: 1,
    },
    {
      id: "assistant-1:thinking",
      kind: "assistant_message",
      chunks: [{
        id: "assistant-1:thinking",
        kind: "thinking",
        text: "reasoning",
        title: "Thinking",
        status: "completed",
        timestamp: at(10),
        updatedAt: at(10),
      }],
      timestamp: at(10),
      updatedAt: at(10),
    },
    {
      id: "tool:tool-1",
      kind: "tool_call",
      toolCall: {
        id: "tool-1",
        kind: "read",
        status: "completed",
        title: "Read",
        timestamp: at(20),
        updatedAt: at(20),
      },
      timestamp: at(20),
      updatedAt: at(20),
    },
    {
      id: "assistant-1#p0",
      kind: "assistant_message",
      chunks: [{
        id: "assistant-1#p0:content",
        kind: "content",
        text: "done",
        timestamp: at(40),
        timelineSequence: 2,
      }],
      timestamp: at(40),
      updatedAt: at(40),
      timelineSequence: 2,
    },
  ];

  const page = pageSessionTimeline(entries, {
    limit: 10,
    window: "message",
  });

  assert.deepEqual(
    page.entries.map((entry) => entry.id),
    ["user-1", "assistant-1:thinking", "tool:tool-1", "assistant-1#p0"],
  );
});

test("timeline message window includes leading tool entries when anchors fit within limit", () => {
  const entries: SessionTimelineEntry[] = [
    {
      id: "assistant-1:thinking",
      kind: "assistant_message",
      chunks: [{
        id: "assistant-1:thinking",
        kind: "thinking",
        text: "reasoning",
        title: "Thinking",
        status: "completed",
        timestamp: at(10),
        updatedAt: at(10),
      }],
      timestamp: at(10),
      updatedAt: at(10),
    },
    {
      id: "tool:tool-1",
      kind: "tool_call",
      toolCall: {
        id: "tool-1",
        kind: "read",
        status: "completed",
        title: "Read",
        timestamp: at(20),
        updatedAt: at(20),
      },
      timestamp: at(20),
      updatedAt: at(20),
    },
    {
      id: "user-1",
      kind: "user_message",
      message: message({ id: "user-1", role: "user", text: "start", timelineSequence: 1, timestamp: at(30) }),
      timestamp: at(30),
      updatedAt: at(30),
      timelineSequence: 1,
    },
    {
      id: "assistant-1#p0",
      kind: "assistant_message",
      chunks: [{
        id: "assistant-1#p0:content",
        kind: "content",
        text: "done",
        timestamp: at(40),
        timelineSequence: 2,
      }],
      timestamp: at(40),
      updatedAt: at(40),
      timelineSequence: 2,
    },
  ];

  const page = pageSessionTimeline(entries, {
    limit: 10,
    window: "message",
  });

  assert.deepEqual(
    page.entries.map((entry) => entry.id),
    ["assistant-1:thinking", "tool:tool-1", "user-1", "assistant-1#p0"],
  );
});
