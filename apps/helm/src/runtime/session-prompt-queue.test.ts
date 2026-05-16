import assert from "node:assert/strict";
import test from "node:test";
import { createSessionPromptQueueManager } from "./session-prompt-queue";

test("prompt queue enqueues behind an in-flight prompt", () => {
  const manager = createSessionPromptQueueManager();
  const first = manager.markInFlight({
    sessionId: "session-1",
    text: "first",
    clientMessageId: "client-1",
  });
  const second = manager.enqueue({
    sessionId: "session-1",
    text: "second",
    clientMessageId: "client-2",
  });

  const snapshot = manager.snapshot("session-1");
  assert.equal(snapshot.inFlight?.id, first.id);
  assert.equal(snapshot.queued.length, 1);
  assert.equal(snapshot.queued[0]?.id, second.id);
});

test("prompt queue edits and deletes only queued prompts", () => {
  const manager = createSessionPromptQueueManager();
  const item = manager.enqueue({
    sessionId: "session-1",
    text: "before",
    clientMessageId: "client-1",
  });

  const edited = manager.updateQueuedPrompt("session-1", item.id, { text: "after" });
  assert.equal(edited.text, "after");

  const snapshot = manager.deleteQueuedPrompt("session-1", item.id);
  assert.equal(snapshot.queued.length, 0);
});

test("prompt queue pops FIFO after clearing in-flight", () => {
  const manager = createSessionPromptQueueManager();
  const first = manager.markInFlight({
    sessionId: "session-1",
    text: "first",
    clientMessageId: "client-1",
  });
  manager.enqueue({ sessionId: "session-1", text: "second", clientMessageId: "client-2" });
  manager.enqueue({ sessionId: "session-1", text: "third", clientMessageId: "client-3" });

  manager.clearInFlight("session-1", first.id);
  const next = manager.takeNext("session-1");

  assert.equal(next?.text, "second");
  assert.equal(manager.snapshot("session-1").queued[0]?.text, "third");
});
