import assert from "node:assert/strict";
import test from "node:test";
import { createPromptTraceEmitter } from "./prompt-trace.js";

test("prompt trace emitter ignores events when disabled", () => {
  const events: unknown[] = [];
  const emitter = createPromptTraceEmitter({
    enabled: false,
    publish: (event) => events.push(event),
  });

  emitter.emit({
    traceId: "t1",
    sessionId: "s1",
    phase: "helm.prompt.ack",
    timestamp: "2026-05-24T00:00:00.000Z",
    source: "helm",
  });

  assert.equal(events.length, 0);
});

test("prompt trace emitter publishes events when enabled", () => {
  const events: unknown[] = [];
  const emitter = createPromptTraceEmitter({
    enabled: true,
    publish: (event) => events.push(event),
  });

  const event = {
    traceId: "t1",
    sessionId: "s1",
    phase: "helm.prompt.ack" as const,
    timestamp: "2026-05-24T00:00:00.000Z",
    source: "helm" as const,
  };
  emitter.emit(event);

  assert.deepEqual(events, [event]);
});
