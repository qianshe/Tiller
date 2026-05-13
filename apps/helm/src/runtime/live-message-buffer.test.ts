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
