import assert from "node:assert/strict";
import test from "node:test";
import type { SessionTimelineEntry } from "@tiller/shared";
import { decodeTimelineBlock, encodeTimelineBlock, type PositionedSessionTimelineEntry } from "./timeline-block-codec";

const BASE_TIME = "2026-06-01T00:00:00.000Z";

function entry(id: string, position: number): PositionedSessionTimelineEntry {
  const payload: SessionTimelineEntry = {
    id,
    kind: "assistant_message",
    chunks: [{ id: `${id}:content`, kind: "content", text: id, timestamp: BASE_TIME, timelineSequence: position }],
    timestamp: BASE_TIME,
    updatedAt: BASE_TIME,
    timelineSequence: position,
  };
  return {
    position,
    id,
    kind: payload.kind,
    timestamp: payload.timestamp,
    payload,
  };
}

test("timeline block codec round-trips positioned timeline entries", () => {
  const entries = [entry("assistant-1", 1), entry("assistant-2", 2)];

  assert.deepEqual(decodeTimelineBlock(encodeTimelineBlock(entries)), entries);
});

test("timeline block codec rejects malformed lines", () => {
  assert.throws(
    () => decodeTimelineBlock("not-json"),
    /Invalid timeline block JSONL/u,
  );
});

test("timeline block codec rejects duplicate and descending positions", () => {
  assert.throws(
    () => encodeTimelineBlock([entry("assistant-1", 1), entry("assistant-duplicate", 1)]),
    /ascending unique positions/u,
  );
  assert.throws(
    () => decodeTimelineBlock(`${JSON.stringify(entry("assistant-2", 2))}\n${JSON.stringify(entry("assistant-1", 1))}`),
    /ascending unique positions/u,
  );
});
