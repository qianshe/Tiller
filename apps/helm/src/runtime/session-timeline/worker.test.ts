import assert from "node:assert/strict";
import test from "node:test";
import type { SessionUpdateRecord } from "@tiller/shared";
import { createSessionTimelineWorker } from "./worker";

test("timeline worker flushes update records with the batch they materialize", () => {
  const worker = createSessionTimelineWorker({ sessionId: "session-1" });
  const update: SessionUpdateRecord = {
    sessionId: "session-1",
    runtimeSessionId: "runtime-1",
    providerId: "codex",
    sequence: 1,
    source: "acp_live",
    updateType: "message",
    receivedAt: "2026-07-11T16:10:00.000Z",
    payloadJson: '{"type":"message"}',
  };

  worker.enqueue({
    type: "message",
    message: {
      id: "assistant-1",
      role: "assistant",
      text: "hello",
      timestamp: "2026-07-11T16:10:00.000Z",
      sequence: 1,
    },
  }, update);

  const commits = worker.flush();
  assert.equal(commits.length, 1);
  assert.equal(commits[0]?.batch.entries[0]?.id, "assistant-1");
  assert.deepEqual(commits[0]?.updates, [update]);
  assert.deepEqual(worker.flush(), []);
});

test("timeline worker publishes only changed canonical entities", () => {
  const worker = createSessionTimelineWorker({ sessionId: "session-1" });
  worker.enqueue({
    type: "message",
    message: {
      id: "assistant-1",
      role: "assistant",
      text: "first",
      timestamp: "2026-07-11T16:10:00.000Z",
      sequence: 1,
    },
  });
  assert.equal(worker.flush()[0]?.batch.entries.length, 1);

  worker.enqueue({
    type: "tool-call",
    toolCall: {
      id: "tool-1",
      kind: "read",
      title: "Read",
      status: "completed",
      timestamp: "2026-07-11T16:10:01.000Z",
      updatedAt: "2026-07-11T16:10:01.000Z",
      sequence: 2,
    },
  });

  const batch = worker.flush()[0]?.batch;
  assert.deepEqual(batch?.entries.map((entry) => entry.id), ["tool:tool-1"]);
});

test("timeline worker publishes lifecycle updates under the launched command entity", () => {
  const worker = createSessionTimelineWorker({ sessionId: "session-1" });
  worker.enqueue({
    type: "tool-call",
    toolCall: {
      id: "launch-call",
      commandId: "subagent:agent-1",
      kind: "subagent",
      title: "Inspect project",
      status: "running",
      timestamp: "2026-07-11T16:10:00.000Z",
      updatedAt: "2026-07-11T16:10:00.000Z",
      sequence: 1,
    },
  });
  assert.equal(worker.flush()[0]?.batch.entries[0]?.id, "tool:launch-call");

  worker.enqueue({
    type: "tool-call",
    toolCall: {
      id: "result-call",
      commandId: "subagent:agent-1",
      kind: "subagent",
      title: "Subagent",
      status: "completed",
      output: "done",
      timestamp: "2026-07-11T16:10:01.000Z",
      updatedAt: "2026-07-11T16:10:01.000Z",
      sequence: 2,
    },
  });

  const batch = worker.flush()[0]?.batch;
  assert.equal(batch?.entries.length, 1);
  assert.equal(batch?.entries[0]?.id, "tool:launch-call");
  assert.equal(
    batch?.entries[0]?.kind === "tool_call"
      ? batch.entries[0].toolCall.output
      : undefined,
    "done",
  );
});

test("timeline worker releases terminal history after a large flushed session", () => {
  const worker = createSessionTimelineWorker({ sessionId: "session-1" });
  for (let sequence = 1; sequence <= 10_000; sequence += 1) {
    worker.enqueue({
      type: "tool-call",
      toolCall: {
        id: `tool-${sequence}`,
        kind: "read",
        title: "Read",
        status: "completed",
        timestamp: "2026-07-11T16:10:00.000Z",
        updatedAt: "2026-07-11T16:10:00.000Z",
        sequence,
      },
    });
  }

  const batch = worker.flush()[0]?.batch;
  assert.equal(batch?.entries.length, 10_000);
  assert.equal(worker.aggregate().entries.length, 0);
  assert.equal(worker.aggregate().lastSequence, 10_000);
});
