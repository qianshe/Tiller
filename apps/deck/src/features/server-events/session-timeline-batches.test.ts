import assert from "node:assert/strict";
import test from "node:test";
import {
  applySessionTimelineBatch,
  createEmptyAppliedTimelineState,
} from "./session-timeline-batches";

test("Deck applies a SessionTimelineBatch by generic replace-or-append, not by semantic transcript merge", () => {
  const current = createEmptyAppliedTimelineState();
  const next = applySessionTimelineBatch(current, {
    replace: false,
    deliverySequence: 2,
    lastSequence: 2,
    entries: [
      { id: "assistant-1", kind: "assistant_message", chunks: [], timestamp: "2026-06-29T10:00:01.000Z", updatedAt: "2026-06-29T10:00:01.000Z", sequence: 1 },
      { id: "tool:1", kind: "tool_call", toolCall: { id: "1", kind: "read", title: "Read", status: "completed", timestamp: "2026-06-29T10:00:02.000Z", updatedAt: "2026-06-29T10:00:02.000Z", sequence: 2 }, timestamp: "2026-06-29T10:00:02.000Z", updatedAt: "2026-06-29T10:00:02.000Z", sequence: 2 },
    ],
  });

  assert.deepEqual(next.entries.map((entry) => entry.id), ["assistant-1", "tool:1"]);
  assert.equal(next.latestDeliverySequence, 2);
  assert.equal(next.reloadRequired, false);
});

test("stale batch is rejected", () => {
  const current = { entries: [], latestDeliverySequence: 5, reloadRequired: false };
  const next = applySessionTimelineBatch(current, {
    replace: false,
    deliverySequence: 3,
    lastSequence: 3,
    entries: [{ id: "x", kind: "assistant_message", chunks: [], timestamp: "2026-06-29T10:00:01.000Z", updatedAt: "2026-06-29T10:00:01.000Z", sequence: 1 }],
  });

  assert.equal(next.entries.length, 0);
  assert.equal(next.latestDeliverySequence, 5);
});

test("gap in deliverySequence triggers reload flag", () => {
  const current = { entries: [], latestDeliverySequence: 1, reloadRequired: false };
  const next = applySessionTimelineBatch(current, {
    replace: false,
    deliverySequence: 5,
    lastSequence: 5,
    entries: [{ id: "x", kind: "assistant_message", chunks: [], timestamp: "2026-06-29T10:00:01.000Z", updatedAt: "2026-06-29T10:00:01.000Z", sequence: 5 }],
  });

  assert.equal(next.reloadRequired, true);
  assert.equal(next.latestDeliverySequence, 5);
});

test("replace batch resets all entries", () => {
  const current = {
    entries: [{ id: "old", kind: "assistant_message" as const, chunks: [], timestamp: "2026-06-29T09:00:00.000Z", updatedAt: "2026-06-29T09:00:00.000Z", sequence: 1 }],
    latestDeliverySequence: 3,
    reloadRequired: false,
  };
  const next = applySessionTimelineBatch(current, {
    replace: true,
    deliverySequence: 4,
    lastSequence: 2,
    entries: [
      { id: "new-1", kind: "user_message", message: { id: "new-1", role: "user", text: "hi", timestamp: "2026-06-29T10:00:00.000Z" }, timestamp: "2026-06-29T10:00:00.000Z", updatedAt: "2026-06-29T10:00:00.000Z", sequence: 1 },
      { id: "new-2", kind: "assistant_message", chunks: [], timestamp: "2026-06-29T10:00:01.000Z", updatedAt: "2026-06-29T10:00:01.000Z", sequence: 2 },
    ],
  });

  assert.deepEqual(next.entries.map((entry) => entry.id), ["new-1", "new-2"]);
  assert.equal(next.latestDeliverySequence, 4);
  assert.equal(next.reloadRequired, false);
});

test("batch upserts existing entries by id", () => {
  const current = {
    entries: [
      { id: "assistant-1", kind: "assistant_message" as const, chunks: [{ id: "c1", kind: "content" as const, text: "Hello", timestamp: "2026-06-29T10:00:01.000Z", sequence: 1 }], timestamp: "2026-06-29T10:00:01.000Z", updatedAt: "2026-06-29T10:00:01.000Z", sequence: 1 },
    ],
    latestDeliverySequence: 1,
    reloadRequired: false,
  };
  const next = applySessionTimelineBatch(current, {
    replace: false,
    deliverySequence: 2,
    lastSequence: 1,
    entries: [
      { id: "assistant-1", kind: "assistant_message", chunks: [{ id: "c1", kind: "content", text: "Hello world", timestamp: "2026-06-29T10:00:01.000Z", sequence: 1 }], timestamp: "2026-06-29T10:00:01.000Z", updatedAt: "2026-06-29T10:00:02.000Z", sequence: 1 },
    ],
  });

  assert.equal(next.entries.length, 1);
  const entry = next.entries[0];
  assert.equal(entry?.kind, "assistant_message");
  if (entry?.kind === "assistant_message") {
    assert.equal(entry.chunks[0]?.text, "Hello world");
  }
});
