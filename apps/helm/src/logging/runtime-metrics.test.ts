import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeMetrics } from "./runtime-metrics";

test("runtime metrics keeps one bounded aggregate per session", () => {
  const logs: unknown[] = [];
  const metrics = createRuntimeMetrics({
    logger: { debug: (_event, fields) => logs.push(fields) },
    setIntervalFn: (() => ({ unref() {} })) as any,
    clearIntervalFn: (() => undefined) as any,
  });
  metrics.observe("s1", { payloadBytes: 10, eventType: "message" });
  metrics.observe("s1", { payloadBytes: 5, batchSize: 2, eventType: "tool-call" });
  metrics.observe("s2", { queueDepth: 3 });

  assert.deepEqual(metrics.flush(), [
    { sessionId: "s1", providerId: undefined, eventType: "tool-call", entityKind: undefined, sequence: undefined, payloadBytes: 15, batchSize: 2 },
    { sessionId: "s2", providerId: undefined, eventType: undefined, entityKind: undefined, sequence: undefined, queueDepth: 3 },
  ]);
  metrics.dispose();
  assert.deepEqual(logs, []);
});

test("runtime metrics removes session aggregates without retaining payload bodies", () => {
  const metrics = createRuntimeMetrics({
    logger: { debug: () => undefined },
    setIntervalFn: (() => ({ unref() {} })) as any,
    clearIntervalFn: (() => undefined) as any,
  });
  metrics.observe("s1", { payloadBytes: 10, eventType: "x".repeat(100) });
  metrics.removeSession("s1");
  assert.deepEqual(metrics.flush(), []);
  metrics.dispose();
});
