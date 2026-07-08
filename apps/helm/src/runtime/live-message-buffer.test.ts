import assert from "node:assert/strict";
import test from "node:test";
import { createLiveMessageBuffer } from "./live-message-buffer.js";

test("live message buffer appends chunks into one assistant message", () => {
  const buffer = createLiveMessageBuffer();
  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    text: "hello ",
    timestamp: "2026-05-12T00:00:00.000Z",
  });
  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    text: "world",
    timestamp: "2026-05-12T00:00:01.000Z",
  });

  assert.deepEqual(buffer.peek("s1")?.text, "hello world");
  assert.deepEqual(buffer.finalize("s1")?.text, "hello world");
  assert.equal(buffer.peek("s1"), null);
});

test("live message buffer replaces cumulative assistant snapshots", () => {
  const buffer = createLiveMessageBuffer();
  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    text: "hello",
    timestamp: "2026-05-12T00:00:00.000Z",
  });
  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    text: "hello world",
    timestamp: "2026-05-12T00:00:01.000Z",
  });

  assert.equal(buffer.peek("s1")?.text, "hello world");
});

test("live message buffer replaces a trailing assistant fragment with the later full snapshot", () => {
  const buffer = createLiveMessageBuffer();
  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    text: "Line 2\nLine 3\nLine 4",
    timestamp: "2026-05-12T00:00:00.000Z",
  });
  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    text: "Line 1\nLine 2\nLine 3\nLine 4",
    timestamp: "2026-05-12T00:00:01.000Z",
  });

  assert.equal(buffer.peek("s1")?.text, "Line 1\nLine 2\nLine 3\nLine 4");
  assert.equal(buffer.flushPending("s1")?.text, "Line 1\nLine 2\nLine 3\nLine 4");
  assert.equal(buffer.finalize("s1")?.text, "Line 1\nLine 2\nLine 3\nLine 4");
});

test("live message buffer ignores duplicate assistant snapshots", () => {
  const buffer = createLiveMessageBuffer();
  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    text: "hello",
    timestamp: "2026-05-12T00:00:00.000Z",
  });
  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    text: "hello",
    timestamp: "2026-05-12T00:00:01.000Z",
  });

  assert.equal(buffer.peek("s1")?.text, "hello");
});

test("live message buffer exposes only the unflushed assistant delta", () => {
  const buffer = createLiveMessageBuffer();
  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    text: "hello",
    timestamp: "2026-05-12T00:00:00.000Z",
  });
  buffer.flushPending("s1");
  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    text: "hello world",
    timestamp: "2026-05-12T00:00:01.000Z",
  });

  assert.equal(buffer.flushPending("s1")?.text, " world");
  assert.equal(buffer.flushPending("s1"), null);
  assert.equal(buffer.finalize("s1")?.text, "hello world");
});
