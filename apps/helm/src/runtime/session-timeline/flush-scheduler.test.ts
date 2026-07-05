import assert from "node:assert/strict";
import test from "node:test";
import { createSessionTimelineDispatcher } from "./dispatcher.js";
import { createSessionTimelineFlushScheduler } from "./flush-scheduler.js";
import { createSessionTimelineWorkerRegistry } from "./worker-registry.js";

test("flush scheduler coalesces streaming assistant chunks until the timer fires", () => {
  const workers = createSessionTimelineWorkerRegistry();
  const published: import("@tiller/shared").SessionTimelineBatch[] = [];
  const scheduled: Array<{ callback: () => void; cancelled: boolean }> = [];
  const dispatcher = createSessionTimelineDispatcher({
    store: {
      applyBatch: (_sessionId, batch) => batch.entries,
    } as import("@tiller/persistence").SessionTimelineStore,
    publish: (_sessionId, batch) => {
      published.push(batch);
    },
  });
  const scheduler = createSessionTimelineFlushScheduler({
    workers,
    dispatcher,
    windowMs: 32,
    setTimeoutFn: (callback) => {
      const handle = { callback, cancelled: false };
      scheduled.push(handle);
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn: (handle) => {
      const timer = handle as unknown as { cancelled: boolean };
      timer.cancelled = true;
    },
  });
  const worker = workers.forSession("session-1");

  const firstEvent = {
    type: "message" as const,
    message: {
      id: "assistant-1",
      role: "assistant" as const,
      text: "Now",
      timestamp: "2026-07-04T12:00:01.000Z",
      streaming: true,
    },
  };
  worker.enqueue(firstEvent);
  scheduler.schedule("session-1", firstEvent);

  const secondEvent = {
    type: "message" as const,
    message: {
      id: "assistant-1",
      role: "assistant" as const,
      text: " thinking",
      timestamp: "2026-07-04T12:00:02.000Z",
      streaming: true,
    },
  };
  worker.enqueue(secondEvent);
  scheduler.schedule("session-1", secondEvent);

  assert.equal(published.length, 0);
  assert.equal(scheduled.length, 1);

  scheduled[0]?.callback();

  assert.equal(published.length, 1);
  assert.equal(published[0]?.entries[0]?.kind, "assistant_message");
  if (published[0]?.entries[0]?.kind === "assistant_message") {
    assert.equal(published[0].entries[0].chunks[0]?.text, "Now thinking");
  }
});

test("flush scheduler forces an immediate flush for non-streaming boundaries", () => {
  const workers = createSessionTimelineWorkerRegistry();
  const published: import("@tiller/shared").SessionTimelineBatch[] = [];
  const scheduled: Array<{ callback: () => void; cancelled: boolean }> = [];
  const dispatcher = createSessionTimelineDispatcher({
    store: {
      applyBatch: (_sessionId, batch) => batch.entries,
    } as import("@tiller/persistence").SessionTimelineStore,
    publish: (_sessionId, batch) => {
      published.push(batch);
    },
  });
  const scheduler = createSessionTimelineFlushScheduler({
    workers,
    dispatcher,
    windowMs: 32,
    setTimeoutFn: (callback) => {
      const handle = { callback, cancelled: false };
      scheduled.push(handle);
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn: (handle) => {
      const timer = handle as unknown as { cancelled: boolean };
      timer.cancelled = true;
    },
  });
  const worker = workers.forSession("session-1");

  const streamingEvent = {
    type: "message" as const,
    message: {
      id: "assistant-1",
      role: "assistant" as const,
      text: "draft",
      timestamp: "2026-07-04T12:00:01.000Z",
      streaming: true,
    },
  };
  worker.enqueue(streamingEvent);
  scheduler.schedule("session-1", streamingEvent);

  const boundaryEvent = {
    type: "tool-call" as const,
    toolCall: {
      id: "tool-1",
      kind: "read" as const,
      title: "Read",
      status: "running" as const,
      timestamp: "2026-07-04T12:00:02.000Z",
      updatedAt: "2026-07-04T12:00:02.000Z",
    },
  };
  worker.enqueue(boundaryEvent);
  scheduler.schedule("session-1", boundaryEvent);

  assert.equal(published.length, 1);
  assert.equal(scheduled[0]?.cancelled, true);
  assert.deepEqual(
    published[0]?.entries.map((entry) => entry.kind),
    ["assistant_message", "tool_call"],
  );
});

test("flush scheduler flushes immediately when the buffered streaming text exceeds the threshold", () => {
  const workers = createSessionTimelineWorkerRegistry();
  const published: import("@tiller/shared").SessionTimelineBatch[] = [];
  const dispatcher = createSessionTimelineDispatcher({
    store: {
      applyBatch: (_sessionId, batch) => batch.entries,
    } as import("@tiller/persistence").SessionTimelineStore,
    publish: (_sessionId, batch) => {
      published.push(batch);
    },
  });
  const scheduler = createSessionTimelineFlushScheduler({
    workers,
    dispatcher,
    windowMs: 32,
    charThreshold: 8,
  });
  const worker = workers.forSession("session-1");

  const event = {
    type: "message" as const,
    message: {
      id: "assistant-1",
      role: "assistant" as const,
      text: "threshold exceeded",
      timestamp: "2026-07-04T12:00:01.000Z",
      streaming: true,
    },
  };
  worker.enqueue(event);
  scheduler.schedule("session-1", event);

  assert.equal(published.length, 1);
  assert.equal(published[0]?.entries[0]?.kind, "assistant_message");
});
