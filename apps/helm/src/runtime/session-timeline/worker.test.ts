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

test("timeline worker publishes lifecycle updates under the same subagent tool entity", () => {
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
  assert.equal(worker.flush()[0]?.batch.entries[0]?.id, "tool:subagent:agent-1");

  worker.enqueue({
    type: "tool-call",
    toolCall: {
      id: "launch-call",
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
  assert.equal(batch?.entries[0]?.id, "tool:subagent:agent-1");
  assert.equal(
    batch?.entries[0]?.kind === "tool_call"
      ? batch.entries[0].toolCall.output
      : undefined,
    "done",
  );
});

test("timeline worker keeps a flushed subagent entry when command identity is learned", () => {
  const worker = createSessionTimelineWorker({ sessionId: "session-1" });

  worker.enqueue({
    type: "tool-call",
    toolCall: {
      id: "opencode-task-call",
      kind: "subagent",
      title: "task",
      status: "running",
      timestamp: "2026-07-11T16:10:00.000Z",
      updatedAt: "2026-07-11T16:10:00.000Z",
      sequence: 1,
    },
  });
  assert.deepEqual(worker.flush()[0]?.batch.entries.map((entry) => entry.id), [
    "tool:opencode-task-call",
  ]);

  worker.enqueue({
    type: "tool-call",
    toolCall: {
      id: "opencode-task-call",
      commandId: "subagent:ses_opencode_child",
      kind: "subagent",
      title: "explore",
      status: "completed",
      output: "done",
      timestamp: "2026-07-11T16:10:01.000Z",
      updatedAt: "2026-07-11T16:10:01.000Z",
      sequence: 2,
    },
  });

  const batch = worker.flush()[0]?.batch;
  assert.deepEqual(batch?.entries.map((entry) => entry.id), ["tool:opencode-task-call"]);
  assert.equal(
    batch?.entries[0]?.kind === "tool_call"
      ? batch.entries[0].toolCall.status
      : undefined,
    "completed",
  );
  assert.equal(
    batch?.entries[0]?.kind === "tool_call"
      ? batch.entries[0].toolCall.commandId
      : undefined,
    "subagent:ses_opencode_child",
  );
});

test("timeline worker merges reused subagent command ids into one entity", () => {
  const worker = createSessionTimelineWorker({ sessionId: "session-1" });

  for (const [id, sequence] of [["first-call", 1], ["second-call", 2]] as const) {
    worker.enqueue({
      type: "tool-call",
      toolCall: {
        id,
        commandId: "subagent:reused-task",
        kind: "subagent",
        title: id,
        status: "running",
        timestamp: `2026-07-11T16:10:0${sequence}.000Z`,
        updatedAt: `2026-07-11T16:10:0${sequence}.000Z`,
        sequence,
      },
    });
  }

  const batch = worker.flush()[0]?.batch;
  assert.deepEqual(batch?.entries.map((entry) => entry.id), ["tool:subagent:reused-task"]);
});

test("timeline worker keeps a reused subagent running after the prior call was flushed", () => {
  const worker = createSessionTimelineWorker({ sessionId: "session-1" });
  const base = {
    commandId: "subagent:reused-task",
    kind: "subagent" as const,
    title: "Subagent",
    timestamp: "2026-07-11T16:10:00.000Z",
    updatedAt: "2026-07-11T16:10:00.000Z",
  };

  worker.enqueue({
    type: "tool-call",
    toolCall: { ...base, id: "first-call", status: "completed", sequence: 1 },
  });
  assert.equal(worker.flush()[0]?.batch.entries.length, 1);

  worker.enqueue({
    type: "tool-call",
    toolCall: {
      ...base,
      id: "second-call",
      status: "running",
      sequence: 2,
      timestamp: "2026-07-11T16:10:01.000Z",
      updatedAt: "2026-07-11T16:10:01.000Z",
    },
  });

  const batch = worker.flush()[0]?.batch;
  assert.deepEqual(batch?.entries.map((entry) => entry.id), ["tool:subagent:reused-task"]);
  const entry = batch?.entries[0];
  assert.equal(entry?.kind, "tool_call");
  assert.equal(entry?.kind === "tool_call" ? entry.toolCall.status : undefined, "running");
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

test("timeline workers keep interleaved sessions isolated", () => {
  const first = createSessionTimelineWorker({ sessionId: "session-a" });
  const second = createSessionTimelineWorker({ sessionId: "session-b" });

  for (let sequence = 1; sequence <= 100; sequence += 1) {
    first.enqueue({
      type: "tool-call",
      toolCall: {
        id: `a-${sequence}`,
        kind: "read",
        title: "Read A",
        status: "completed",
        timestamp: "2026-07-11T16:10:00.000Z",
        updatedAt: "2026-07-11T16:10:00.000Z",
        sequence,
      },
    });
    second.enqueue({
      type: "tool-call",
      toolCall: {
        id: `b-${sequence}`,
        kind: "read",
        title: "Read B",
        status: "completed",
        timestamp: "2026-07-11T16:10:00.000Z",
        updatedAt: "2026-07-11T16:10:00.000Z",
        sequence,
      },
    });
  }

  const firstBatch = first.flush()[0]?.batch;
  const secondBatch = second.flush()[0]?.batch;
  assert.equal(firstBatch?.entries.length, 100);
  assert.equal(secondBatch?.entries.length, 100);
  assert.equal(firstBatch?.entries.every((entry) => entry.id.startsWith("tool:a-")), true);
  assert.equal(secondBatch?.entries.every((entry) => entry.id.startsWith("tool:b-")), true);
  assert.equal(first.aggregate().lastSequence, 100);
  assert.equal(second.aggregate().lastSequence, 100);
});

test("timeline worker keeps pending messages when a command-indexed tool is appended", () => {
  const worker = createSessionTimelineWorker({ sessionId: "session-1" });

  worker.enqueue({
    type: "message",
    message: {
      id: "assistant-1",
      role: "assistant",
      text: "I will inspect the file.",
      timestamp: "2026-07-11T16:10:00.000Z",
      sequence: 1,
    },
  });
  worker.enqueue({
    type: "tool-call",
    toolCall: {
      id: "tool-1",
      commandId: "command-1",
      kind: "read",
      title: "Read",
      status: "running",
      timestamp: "2026-07-11T16:10:01.000Z",
      updatedAt: "2026-07-11T16:10:01.000Z",
      sequence: 2,
    },
  });

  const batch = worker.flush()[0]?.batch;
  assert.deepEqual(batch?.entries.map((entry) => entry.id), ["assistant-1", "tool:tool-1"]);
});
