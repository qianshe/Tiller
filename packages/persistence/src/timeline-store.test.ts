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

function message(overrides: Partial<AgentMessage> & Pick<AgentMessage, "id" | "role" | "text" | "sequence">): AgentMessage {
  return {
    timestamp: at(overrides.sequence ?? 0),
    ...overrides,
  };
}

function toolCall(
  overrides: Partial<AgentToolCall> & Pick<AgentToolCall, "id" | "kind" | "status" | "title" | "sequence">,
): AgentToolCall {
  return {
    timestamp: at(overrides.sequence ?? 0),
    updatedAt: at(overrides.sequence ?? 0),
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
      message: message({ id: "user-1", role: "user", text: "start", sequence: 1 }),
      timestamp: at(1),
      updatedAt: at(1),
      sequence: 1,
    });
    store.append("session-1", {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [{ id: "assistant-1:content", kind: "content", text: "done", timestamp: at(2), sequence: 2 }],
      timestamp: at(2),
      updatedAt: at(2),
      sequence: 2,
    });
    store.append("session-1", {
      id: "user-1",
      kind: "user_message",
      message: message({ id: "user-1", role: "user", text: "start edited", sequence: 99, timestamp: at(99) }),
      timestamp: at(99),
      updatedAt: at(99),
      sequence: 99,
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

test("sqlite timeline upsertMessage updates one entry without moving its persisted position", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-timeline-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const store = createSqliteSessionTimelineStore(dbPath);

  try {
    store.upsertMessage("session-1", message({ id: "assistant-1", role: "assistant", text: "first", sequence: 1 }));
    store.upsertMessage("session-1", message({ id: "user-1", role: "user", text: "next", sequence: 2 }));
    const updated = store.upsertMessage(
      "session-1",
      message({ id: "assistant-1", role: "assistant", text: "first updated", sequence: 99, timestamp: at(99) }),
    );

    assert.equal(updated?.id, "assistant-1");
    const persisted = store.list("session-1");
    assert.deepEqual(persisted.map((entry) => entry.id), ["assistant-1", "user-1"]);
    assert.equal(
      persisted[0]?.kind === "assistant_message" ? persisted[0].chunks[0]?.text : undefined,
      "first updated",
    );

    const db = new DatabaseSync(dbPath);
    try {
      const rows = db
        .prepare("SELECT id, position FROM session_timeline_entries WHERE session_id = ? ORDER BY position ASC")
        .all("session-1") as Array<{ id: string; position: number }>;
      assert.deepEqual(rows.map((row) => ({ id: row.id, position: row.position })), [
        { id: "assistant-1", position: 0 },
        { id: "user-1", position: 1 },
      ]);
    } finally {
      db.close();
    }
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("sqlite timeline upsertMessage updates one entry in a 20k-entry fixture", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-timeline-store-large-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const store = createSqliteSessionTimelineStore(dbPath);

  try {
    const entries: SessionTimelineEntry[] = Array.from({ length: 20_000 }, (_, index) => ({
      id: `assistant-${index}`,
      kind: "assistant_message" as const,
      chunks: [{
        id: `assistant-${index}:content`,
        kind: "content" as const,
        text: `message ${index}`,
        timestamp: at(index),
        sequence: index,
      }],
      timestamp: at(index),
      updatedAt: at(index),
      sequence: index,
    }));
    store.replace("session-1", entries);

    store.upsertMessage(
      "session-1",
      message({ id: "assistant-10000", role: "assistant", text: "large fixture updated", sequence: 30_000, timestamp: at(30_000) }),
    );

    const db = new DatabaseSync(dbPath);
    try {
      const count = db.prepare("SELECT COUNT(*) AS count FROM session_timeline_entries WHERE session_id = ?").get("session-1") as { count: number };
      const row = db
        .prepare("SELECT position, payload_json FROM session_timeline_entries WHERE session_id = ? AND id = ?")
        .get("session-1", "assistant-10000") as { position: number; payload_json: string };
      const payload = JSON.parse(row.payload_json) as SessionTimelineEntry;

      assert.equal(count.count, 20_000);
      assert.equal(row.position, 10_000);
      assert.equal(payload.kind === "assistant_message" ? payload.chunks[0]?.text.includes("large fixture updated") : false, true);
    } finally {
      db.close();
    }
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("sqlite timeline upsertToolCall merges thinking into one assistant entry", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-timeline-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const store = createSqliteSessionTimelineStore(dbPath);

  try {
    store.upsertMessage("session-1", message({ id: "assistant-1", role: "assistant", text: "done", sequence: 2 }));
    const updated = store.upsertToolCall("session-1", toolCall({
      id: "assistant-1:thinking",
      commandId: "assistant-1:thinking",
      kind: "think",
      output: "reasoning",
      status: "completed",
      title: "Thinking",
      sequence: 1,
    }));

    assert.equal(updated?.id, "assistant-1");
    const persisted = store.list("session-1");
    assert.equal(persisted.length, 1);
    assert.deepEqual(
      persisted[0]?.kind === "assistant_message"
        ? persisted[0].chunks.map((chunk) => chunk.kind)
        : [],
      ["thinking", "content"],
    );
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("pageSessionTimeline drops later replay duplicates with reset-or-equal sequences", () => {
  const entries: SessionTimelineEntry[] = [
    {
      id: "session-1-user-1",
      kind: "user_message",
      message: message({
        id: "session-1-user-1",
        role: "user",
        text: "我需要验证下面内容的实际效果",
        sequence: 1,
        timestamp: "2026-06-28T12:42:37.488Z",
      }),
      timestamp: "2026-06-28T12:42:37.488Z",
      updatedAt: "2026-06-28T12:42:37.488Z",
      sequence: 1,
    },
    {
      id: "provider-user-1",
      kind: "user_message",
      message: message({
        id: "provider-user-1",
        role: "user",
        text: "我需要验证下面内容的实际效果",
        sequence: 1,
        timestamp: "2026-06-28T12:44:23.969Z",
      }),
      timestamp: "2026-06-28T12:44:23.969Z",
      updatedAt: "2026-06-28T12:44:23.969Z",
      sequence: 1,
    },
    {
      id: "provider-assistant-1",
      kind: "assistant_message",
      chunks: [{
        id: "provider-assistant-1:content",
        kind: "content",
        text: "我来看看项目结构和相关代码。",
        timestamp: "2026-06-28T12:44:23.973Z",
        sequence: 3,
      }],
      timestamp: "2026-06-28T12:44:23.973Z",
      updatedAt: "2026-06-28T12:44:23.973Z",
      sequence: 3,
    },
    {
      id: "session-1-msg-000001",
      kind: "assistant_message",
      chunks: [{
        id: "session-1-msg-000001:content",
        kind: "content",
        text: "我来看看项目结构和相关代码。",
        timestamp: "2026-06-28T12:42:44.452Z",
        sequence: 40,
      }],
      timestamp: "2026-06-28T12:42:44.452Z",
      updatedAt: "2026-06-28T12:42:44.452Z",
      sequence: 40,
    },
  ];

  const page = pageSessionTimeline(entries, { limit: 20 });

  assert.deepEqual(
    page.entries.map((entry) => [entry.kind, entry.id]),
    [
      ["user_message", "session-1-user-1"],
      ["assistant_message", "session-1-msg-000001"],
    ],
  );
});

test("sqlite timeline upsertMessage splits assistant entries across tool boundaries", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-timeline-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const store = createSqliteSessionTimelineStore(dbPath);

  try {
    store.upsertMessage("session-1", message({ id: "assistant-1", role: "assistant", text: "先说明。", sequence: 1 }));
    store.upsertToolCall("session-1", toolCall({
      id: "tool-1",
      kind: "read",
      status: "completed",
      title: "Read",
      sequence: 2,
    }));
    const updated = store.upsertMessage(
      "session-1",
      message({ id: "assistant-1", role: "assistant", text: "先说明。工具后继续。", sequence: 3 }),
    );

    assert.equal(updated?.id, "assistant-1#p1");
    const persisted = store.list("session-1");
    assert.deepEqual(
      persisted.map((entry) => [entry.kind, entry.id]),
      [
        ["assistant_message", "assistant-1"],
        ["tool_call", "tool:tool-1"],
        ["assistant_message", "assistant-1#p1"],
      ],
    );
    assert.deepEqual(
      persisted.map((entry) =>
        entry.kind === "assistant_message"
          ? entry.chunks.map((chunk) => chunk.kind === "content" ? chunk.text : chunk.kind)
          : entry.id
      ),
      [
        ["先说明。"],
        "tool:tool-1",
        ["工具后继续。"],
      ],
    );
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
        sequence: index,
      }],
      timestamp: at(index),
      updatedAt: at(index),
      sequence: index,
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
        message({ id: "assistant-1", role: "assistant", text: "Done", sequence: 3 }),
        message({ id: "user-1", role: "user", text: "Start", sequence: 1 }),
      ],
      toolCalls: [
        toolCall({
          id: "assistant-1:thinking",
          commandId: "assistant-1:thinking",
          kind: "think",
          output: "Reasoning",
          status: "completed",
          title: "Thinking",
          sequence: 2,
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
      message({ id: "assistant-intro", role: "assistant", text: "intro", sequence: 1 }),
      message({ id: "assistant-final", role: "assistant", text: "final", sequence: 6 }),
    ],
    toolCalls: Array.from({ length: 4 }, (_, index) =>
      toolCall({
        id: `tool-${index}`,
        kind: "read",
        status: "completed",
        title: `Read ${index}`,
        sequence: index + 2,
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
      message({ id: "assistant-intro", role: "assistant", text: "intro", sequence: 1 }),
      message({ id: "assistant-final", role: "assistant", text: "final", sequence: 142 }),
    ],
    toolCalls: Array.from({ length: 140 }, (_, index) =>
      toolCall({
        id: `tool-${index}`,
        kind: "read",
        status: "completed",
        title: `Read ${index}`,
        sequence: index + 2,
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
      message({ id: "user-latest", role: "user", text: "继续", sequence: 1 }),
      ...Array.from({ length: 30 }, (_, index) =>
        message({
          id: `assistant-final#p${index}`,
          role: "assistant" as const,
          text: `段落 ${index}`,
          sequence: index + 2,
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
      message: message({ id: "user-1", role: "user", text: "start", sequence: 1, timestamp: at(30) }),
      timestamp: at(30),
      updatedAt: at(30),
      sequence: 1,
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
        sequence: 2,
      }],
      timestamp: at(40),
      updatedAt: at(40),
      sequence: 2,
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
      message: message({ id: "user-1", role: "user", text: "start", sequence: 1, timestamp: at(30) }),
      timestamp: at(30),
      updatedAt: at(30),
      sequence: 1,
    },
    {
      id: "assistant-1#p0",
      kind: "assistant_message",
      chunks: [{
        id: "assistant-1#p0:content",
        kind: "content",
        text: "done",
        timestamp: at(40),
        sequence: 2,
      }],
      timestamp: at(40),
      updatedAt: at(40),
      sequence: 2,
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
