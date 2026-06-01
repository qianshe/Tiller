import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openSessionDatabase } from "./core";
import { createSqliteTimelineBlockIndex, type TimelineBlockEntryRecord, type TimelineBlockRecord } from "./timeline-block-index";

function withIndex(run: (index: ReturnType<typeof createSqliteTimelineBlockIndex>) => void) {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-timeline-block-index-"));
  const db = openSessionDatabase(join(tempDir, "sessions.sqlite"));
  try {
    run(createSqliteTimelineBlockIndex(db));
  } finally {
    db.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
}

function block(overrides: Partial<TimelineBlockRecord> & Pick<TimelineBlockRecord, "id" | "sessionId" | "firstPosition" | "lastPosition" | "state">): TimelineBlockRecord {
  return {
    entryCount: overrides.lastPosition - overrides.firstPosition + 1,
    byteSize: 128,
    storageKey: `timeline-blocks/${overrides.sessionId}/${overrides.id}.jsonl`,
    createdAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function entry(overrides: TimelineBlockEntryRecord): TimelineBlockEntryRecord {
  return overrides;
}

test("timeline block index lists newest blocks for one session only", () => {
  withIndex((index) => {
    index.upsertBlock(block({ id: "a-1", sessionId: "a", firstPosition: 0, lastPosition: 9, state: "sealed" }));
    index.upsertBlock(block({ id: "a-2", sessionId: "a", firstPosition: 10, lastPosition: 19, state: "open" }));
    index.upsertBlock(block({ id: "b-1", sessionId: "b", firstPosition: 0, lastPosition: 99, state: "open" }));

    assert.deepEqual(
      index.listNewestBlocks("a").map((item) => item.id),
      ["a-2", "a-1"],
    );
    assert.deepEqual(
      index.listNewestBlocks("a", 12).map((item) => item.id),
      ["a-2", "a-1"],
    );
    assert.deepEqual(
      index.listNewestBlocks("a", 10).map((item) => item.id),
      ["a-1"],
    );
  });
});

test("timeline block index tracks the open block and entry locations", () => {
  withIndex((index) => {
    index.upsertBlock(block({ id: "session-1-block-1", sessionId: "session-1", firstPosition: 0, lastPosition: 1, state: "sealed" }));
    index.upsertBlock(block({ id: "session-1-block-2", sessionId: "session-1", firstPosition: 2, lastPosition: 3, state: "open" }));
    index.replaceBlockEntries("session-1-block-2", [
      entry({ sessionId: "session-1", entryId: "assistant-2", blockId: "session-1-block-2", position: 2 }),
      entry({ sessionId: "session-1", entryId: "tool-1", blockId: "session-1-block-2", position: 3 }),
    ]);

    assert.equal(index.getOpenBlock("session-1")?.id, "session-1-block-2");
    assert.deepEqual(index.getEntryLocation("session-1", "tool-1"), {
      sessionId: "session-1",
      entryId: "tool-1",
      blockId: "session-1-block-2",
      position: 3,
    });
  });
});

test("timeline block index replaces and removes one session without touching others", () => {
  withIndex((index) => {
    index.replaceBlocks("session-1", [
      block({ id: "s1-b1", sessionId: "session-1", firstPosition: 0, lastPosition: 4, state: "sealed" }),
    ], [entry({ sessionId: "session-1", entryId: "entry-1", blockId: "s1-b1", position: 0 })]);
    index.replaceBlocks("session-2", [
      block({ id: "s2-b1", sessionId: "session-2", firstPosition: 0, lastPosition: 4, state: "open" }),
    ], [entry({ sessionId: "session-2", entryId: "entry-2", blockId: "s2-b1", position: 0 })]);
    index.replaceBlocks("session-1", [
      block({ id: "s1-b2", sessionId: "session-1", firstPosition: 5, lastPosition: 9, state: "open" }),
    ], [entry({ sessionId: "session-1", entryId: "entry-3", blockId: "s1-b2", position: 5 })]);

    assert.deepEqual(index.listNewestBlocks("session-1").map((item) => item.id), ["s1-b2"]);
    assert.deepEqual(index.listNewestBlocks("session-2").map((item) => item.id), ["s2-b1"]);
    assert.equal(index.getEntryLocation("session-1", "entry-1"), undefined);
    assert.equal(index.getEntryLocation("session-1", "entry-3")?.blockId, "s1-b2");

    index.removeSession("session-1");

    assert.deepEqual(index.listNewestBlocks("session-1"), []);
    assert.deepEqual(index.listNewestBlocks("session-2").map((item) => item.id), ["s2-b1"]);
  });
});
