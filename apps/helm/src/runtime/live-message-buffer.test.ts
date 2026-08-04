import assert from "node:assert/strict";
import test from "node:test";
import {
  appendMessageToSessionTimeline,
  type SessionTimelineEntry,
} from "@tiller/shared";
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

test("live message buffer appends explicit ACP deltas without overlap guessing", () => {
  const buffer = createLiveMessageBuffer();
  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    text: "重复内容",
    streamMode: "delta",
    timestamp: "2026-05-12T00:00:00.000Z",
  });
  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    text: "重复内容",
    streamMode: "delta",
    timestamp: "2026-05-12T00:00:01.000Z",
  });

  assert.equal(buffer.peek("s1")?.text, "重复内容重复内容");
});

test("live message buffer publishes the suffix of cumulative snapshots as a delta", () => {
  const buffer = createLiveMessageBuffer();
  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    contentKind: "thought",
    text: "先分析",
    streamMode: "snapshot",
    timestamp: "2026-05-12T00:00:00.000Z",
  });

  const first = buffer.flushPending("s1");
  assert.equal(first?.text, "先分析");
  assert.equal(first?.streamMode, "snapshot");

  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    contentKind: "thought",
    text: "先分析当前文件",
    streamMode: "snapshot",
    timestamp: "2026-05-12T00:00:01.000Z",
  });

  const second = buffer.flushPending("s1");
  assert.equal(second?.text, "当前文件");
  assert.equal(second?.streamMode, "delta");
  assert.equal(buffer.peek("s1")?.text, "先分析当前文件");
});

test("live message buffer keeps cumulative thinking snapshots intact through timeline aggregation", () => {
  const buffer = createLiveMessageBuffer();
  const entries: SessionTimelineEntry[] = [];

  function flushToTimeline() {
    const message = buffer.flushPending("s1");
    if (message) {
      appendMessageToSessionTimeline(entries, { ...message, streaming: true });
    }
  }

  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    contentKind: "thought",
    text: "第一句",
    streamMode: "snapshot",
    timestamp: "2026-05-12T00:00:00.000Z",
  });
  flushToTimeline();

  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    contentKind: "thought",
    text: "第一句第二句",
    streamMode: "snapshot",
    timestamp: "2026-05-12T00:00:01.000Z",
  });
  flushToTimeline();

  const finalMessage = buffer.finalize("s1");
  assert.ok(finalMessage);
  if (!finalMessage) {
    return;
  }
  appendMessageToSessionTimeline(entries, {
    ...finalMessage,
    streaming: false,
    streamMode: "snapshot",
  });

  const entry = entries[0];
  assert.equal(entry?.kind, "assistant_message");
  if (entry?.kind !== "assistant_message") {
    return;
  }
  assert.equal(entry.chunks.length, 1);
  assert.equal(entry.chunks[0]?.kind, "thinking");
  assert.equal(entry.chunks[0]?.text, "第一句第二句");
});

test("live message buffer appends deltas even when one starts with the current text", () => {
  const buffer = createLiveMessageBuffer();
  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    contentKind: "thought",
    text: "a",
    streamMode: "delta",
    timestamp: "2026-05-12T00:00:00.000Z",
  });
  buffer.flushPending("s1");

  buffer.append("s1", {
    id: "m1",
    role: "assistant",
    contentKind: "thought",
    text: "ab",
    streamMode: "delta",
    timestamp: "2026-05-12T00:00:01.000Z",
  });
  const second = buffer.flushPending("s1");
  assert.equal(second?.text, "ab");
  assert.equal(second?.streamMode, "delta");
  assert.equal(buffer.peek("s1")?.text, "aab");
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
