import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentMessage, AgentToolCall, SessionTimelineEntry } from "@tiller/shared";
import { createSqliteSessionTimelineStore } from "./timeline-store";
import { createSqliteTimelineBlockStore } from "./timeline-block-store";

const BASE_TIME = "2026-06-01T00:00:00.000Z";
const { DatabaseSync } = createRequire(import.meta.url)(
  "node:sqlite",
) as typeof import("node:sqlite");

function at(seconds: number) {
  return new Date(Date.parse(BASE_TIME) + seconds * 1000).toISOString();
}

function assistantEntry(index: number): SessionTimelineEntry {
  return {
    id: `assistant-${index}`,
    kind: "assistant_message",
    chunks: [{ id: `assistant-${index}:content`, kind: "content", text: `message ${index}`, timestamp: at(index), timelineSequence: index }],
    timestamp: at(index),
    updatedAt: at(index),
    timelineSequence: index,
  };
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

function withStore(run: (params: { store: ReturnType<typeof createSqliteTimelineBlockStore>; dbPath: string; blockRootPath: string }) => void) {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-timeline-block-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const blockRootPath = join(tempDir, "timeline-blocks");
  const store = createSqliteTimelineBlockStore({
    dbPath,
    blockRootPath,
    maxBlockBytes: 4096,
    maxBlockEntries: 2,
  });
  try {
    run({ store, dbPath, blockRootPath });
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
}

test("timeline block store appends into per-session blocks and seals by entry threshold", () => {
  withStore(({ store, dbPath, blockRootPath }) => {
    store.append("session-1", assistantEntry(0));
    store.append("session-1", assistantEntry(1));
    store.append("session-1", assistantEntry(2));

    assert.deepEqual(store.list("session-1").map((entry) => entry.id), ["assistant-0", "assistant-1", "assistant-2"]);
    assert.equal(existsSync(join(blockRootPath, encodeURIComponent("session-1"))), true);

    const db = new DatabaseSync(dbPath);
    try {
      const rows = db.prepare("SELECT state, first_position, last_position FROM session_timeline_blocks WHERE session_id = ? ORDER BY first_position ASC").all("session-1") as Array<{ state: string; first_position: number; last_position: number }>;
      assert.deepEqual(rows.map((row) => ({
        state: row.state,
        first_position: row.first_position,
        last_position: row.last_position,
      })), [
        { state: "sealed", first_position: 0, last_position: 1 },
        { state: "open", first_position: 2, last_position: 2 },
      ]);
    } finally {
      db.close();
    }
  });
});

test("timeline block store seals by byte threshold", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-timeline-block-bytes-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const store = createSqliteTimelineBlockStore({
    dbPath,
    blockRootPath: join(tempDir, "timeline-blocks"),
    maxBlockBytes: 1,
    maxBlockEntries: 100,
  });

  try {
    store.append("session-1", assistantEntry(0));
    store.append("session-1", assistantEntry(1));

    const db = new DatabaseSync(dbPath);
    try {
      const rows = db.prepare("SELECT state, first_position, last_position FROM session_timeline_blocks WHERE session_id = ? ORDER BY first_position ASC").all("session-1") as Array<{ state: string; first_position: number; last_position: number }>;
      assert.deepEqual(rows.map((row) => ({ state: row.state, first_position: row.first_position, last_position: row.last_position })), [
        { state: "sealed", first_position: 0, last_position: 0 },
        { state: "open", first_position: 1, last_position: 1 },
      ]);
    } finally {
      db.close();
    }
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("timeline block store updates an existing entry without duplicating or moving it", () => {
  withStore(({ store }) => {
    store.append("session-1", assistantEntry(0));
    store.append("session-1", assistantEntry(1));
    const updated: SessionTimelineEntry = {
      id: "assistant-0",
      kind: "assistant_message",
      chunks: [{ id: "assistant-0:content", kind: "content", text: "updated", timestamp: at(99), timelineSequence: 99 }],
      timestamp: at(99),
      updatedAt: at(99),
      timelineSequence: 99,
    };
    store.append("session-1", updated);

    const entries = store.list("session-1");
    assert.deepEqual(entries.map((entry) => entry.id), ["assistant-0", "assistant-1"]);
    assert.equal(entries[0]?.kind === "assistant_message" ? entries[0].chunks[0]?.text : undefined, "updated");
  });
});

test("timeline block store paginates newest-first across block boundaries", () => {
  withStore(({ store }) => {
    for (let index = 0; index < 5; index += 1) {
      store.append("session-1", assistantEntry(index));
    }

    const latest = store.listPage("session-1", { limit: 2 });
    const older = store.listPage("session-1", { limit: 2, before: latest.nextCursor });
    const oldest = store.listPage("session-1", { limit: 2, before: older.nextCursor });

    assert.deepEqual(latest.entries.map((entry) => entry.id), ["assistant-3", "assistant-4"]);
    assert.equal(latest.hasMore, true);
    assert.deepEqual(older.entries.map((entry) => entry.id), ["assistant-1", "assistant-2"]);
    assert.equal(older.hasMore, true);
    assert.deepEqual(oldest.entries.map((entry) => entry.id), ["assistant-0"]);
    assert.equal(oldest.hasMore, false);
  });
});

test("timeline block store paginates older entries within the same block", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-timeline-block-same-block-"));
  const store = createSqliteTimelineBlockStore({
    dbPath: join(tempDir, "sessions.sqlite"),
    blockRootPath: join(tempDir, "timeline-blocks"),
    maxBlockBytes: 4096,
    maxBlockEntries: 10,
  });

  try {
    for (let index = 0; index < 5; index += 1) {
      store.append("session-1", assistantEntry(index));
    }

    const latest = store.listPage("session-1", { limit: 2 });
    const older = store.listPage("session-1", { limit: 2, before: latest.nextCursor });
    const oldest = store.listPage("session-1", { limit: 2, before: older.nextCursor });

    assert.deepEqual(latest.entries.map((entry) => entry.id), ["assistant-3", "assistant-4"]);
    assert.equal(latest.nextCursor, "order\t3\tassistant-3");
    assert.deepEqual(older.entries.map((entry) => entry.id), ["assistant-1", "assistant-2"]);
    assert.equal(older.nextCursor, "order\t1\tassistant-1");
    assert.deepEqual(oldest.entries.map((entry) => entry.id), ["assistant-0"]);
    assert.equal(oldest.hasMore, false);
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("timeline block store upsertToolCall merges thinking into an assistant entry", () => {
  withStore(({ store }) => {
    store.upsertMessage("session-1", message({ id: "assistant-1", role: "assistant", text: "done", timelineSequence: 2 }));
    store.upsertToolCall("session-1", toolCall({
      id: "assistant-1:thinking",
      commandId: "assistant-1:thinking",
      kind: "think",
      output: "reasoning",
      status: "completed",
      title: "Thinking",
      timelineSequence: 1,
    }));

    const entries = store.list("session-1");
    assert.equal(entries.length, 1);
    assert.deepEqual(
      entries[0]?.kind === "assistant_message"
        ? entries[0].chunks.map((chunk) => chunk.kind)
        : [],
      ["thinking", "content"],
    );
  });
});

test("timeline block store replace is scoped to one session", () => {
  withStore(({ store }) => {
    store.replace("session-1", [assistantEntry(0), assistantEntry(1)]);
    store.replace("session-2", [assistantEntry(10)]);
    store.replace("session-1", [assistantEntry(2)]);

    assert.deepEqual(store.list("session-1").map((entry) => entry.id), ["assistant-2"]);
    assert.deepEqual(store.list("session-2").map((entry) => entry.id), ["assistant-10"]);
  });
});

test("timeline block store recovers when an indexed block file is missing", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-timeline-block-missing-file-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const blockRootPath = join(tempDir, "timeline-blocks");
  const store = createSqliteTimelineBlockStore({
    dbPath,
    blockRootPath,
    maxBlockBytes: 4096,
    maxBlockEntries: 2,
  });

  try {
    store.upsertMessage("session-1", message({ id: "assistant-1", role: "assistant", text: "first", timelineSequence: 1 }));
    const db = new DatabaseSync(dbPath);
    try {
      const row = db.prepare("SELECT storage_key FROM session_timeline_blocks WHERE session_id = ? LIMIT 1").get("session-1") as { storage_key: string };
      unlinkSync(join(blockRootPath, row.storage_key));
    } finally {
      db.close();
    }

    store.upsertMessage("session-1", message({ id: "assistant-1", role: "assistant", text: "recovered", timelineSequence: 2 }));

    const entries = store.list("session-1");
    assert.deepEqual(entries.map((entry) => entry.id), ["assistant-1"]);
    assert.equal(entries[0]?.kind === "assistant_message" ? entries[0].chunks[0]?.text : undefined, "recovered");
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("timeline block store keeps previous session data when replace fails while writing temp blocks", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-timeline-block-atomic-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const blockRootPath = join(tempDir, "timeline-blocks");
  const store = createSqliteTimelineBlockStore({
    dbPath,
    blockRootPath,
    maxBlockBytes: 4096,
    maxBlockEntries: 1,
  });

  try {
    store.replace("session-1", [assistantEntry(0)]);
    store.close();

    const failingStore = createSqliteTimelineBlockStore({
      dbPath,
      blockRootPath,
      maxBlockBytes: 4096,
      maxBlockEntries: 1,
      testFailureAfterTempBlockWrites: 1,
    });
    try {
      assert.throws(
        () => failingStore.replace("session-1", [assistantEntry(1), assistantEntry(2)]),
        /Injected timeline block replace failure/u,
      );
      assert.deepEqual(failingStore.list("session-1").map((entry) => entry.id), ["assistant-0"]);
      assert.deepEqual(
        readdirSync(blockRootPath).filter((name) => name.includes(".tmp-") || name.includes(".bak-")),
        [],
      );
    } finally {
      failingStore.close();
    }
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("timeline block store matches sqlite row store page contract", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-timeline-block-contract-"));
  const rowStore = createSqliteSessionTimelineStore(join(tempDir, "rows.sqlite"));
  const blockStore = createSqliteTimelineBlockStore({
    dbPath: join(tempDir, "blocks.sqlite"),
    blockRootPath: join(tempDir, "timeline-blocks"),
    maxBlockBytes: 4096,
    maxBlockEntries: 2,
  });

  try {
    const entries = Array.from({ length: 5 }, (_, index) => assistantEntry(index));
    rowStore.replace("session-1", entries);
    blockStore.replace("session-1", entries);

    const rowLatest = rowStore.listPage("session-1", { limit: 2 });
    const blockLatest = blockStore.listPage("session-1", { limit: 2 });
    const rowOlder = rowStore.listPage("session-1", { before: rowLatest.nextCursor, limit: 2 });
    const blockOlder = blockStore.listPage("session-1", { before: blockLatest.nextCursor, limit: 2 });

    assert.deepEqual(blockLatest.entries, rowLatest.entries);
    assert.equal(blockLatest.hasMore, rowLatest.hasMore);
    assert.deepEqual(blockOlder.entries, rowOlder.entries);
    assert.equal(blockOlder.hasMore, rowOlder.hasMore);
  } finally {
    rowStore.close();
    blockStore.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});
