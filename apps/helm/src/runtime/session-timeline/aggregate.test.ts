import assert from "node:assert/strict";
import test from "node:test";
import {
  applySessionRuntimeEvent,
  buildSessionTimelineBatch,
  createEmptySessionTimelineAggregate,
} from "./aggregate";

test("aggregate folds command output into the matching tool_call entry", () => {
  let aggregate = createEmptySessionTimelineAggregate("session-1");

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "tool-call",
    toolCall: {
      id: "tool-shell-1",
      kind: "shell",
      title: "pnpm test",
      status: "running",
      commandId: "cmd-1",
      timestamp: "2026-06-29T10:00:01.000Z",
      updatedAt: "2026-06-29T10:00:01.000Z",
    },
  });

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "command-output",
    chunk: {
      id: "chunk-1",
      commandId: "cmd-1",
      text: "PASS",
      stream: "stdout",
      timestamp: "2026-06-29T10:00:02.000Z",
    },
  });

  const toolEntry = aggregate.entries.find((entry) => entry.kind === "tool_call");
  assert.equal(toolEntry?.kind, "tool_call");
  assert.equal(toolEntry?.kind === "tool_call" ? toolEntry.toolCall.output : "", "PASS");
});

// --- PLACEHOLDER_TEST_BODY ---

test("aggregate keeps subagent as an independent tool_call kind", () => {
  let aggregate = createEmptySessionTimelineAggregate("session-2");

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "tool-call",
    toolCall: {
      id: "tool-sub-1",
      kind: "subagent",
      title: "delegate task",
      status: "completed",
      timestamp: "2026-06-29T10:00:03.000Z",
      updatedAt: "2026-06-29T10:00:03.000Z",
    },
  });

  const toolEntry = aggregate.entries[0];
  assert.equal(toolEntry?.kind, "tool_call");
  assert.equal(toolEntry?.kind === "tool_call" ? toolEntry.toolCall.kind : "", "subagent");
});

test("aggregate merges streaming assistant messages into the same entry", () => {
  let aggregate = createEmptySessionTimelineAggregate("session-3");

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "message",
    message: {
      id: "assistant-1",
      role: "assistant",
      text: "Hello",
      timestamp: "2026-06-29T10:00:01.000Z",
      streaming: true,
    },
  });

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "message",
    message: {
      id: "assistant-1",
      role: "assistant",
      text: "Hello world",
      timestamp: "2026-06-29T10:00:02.000Z",
      streaming: false,
    },
  });

  assert.equal(aggregate.entries.length, 1);
  const entry = aggregate.entries[0];
  assert.equal(entry?.kind, "assistant_message");
  if (entry?.kind === "assistant_message") {
    assert.equal(entry.chunks.length, 1);
    assert.equal(entry.chunks[0]?.text, "Hello world");
    assert.equal(entry.streaming, false);
  }
});

test("aggregate nests thinking into assistant entry", () => {
  let aggregate = createEmptySessionTimelineAggregate("session-4");

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "tool-call",
    toolCall: {
      id: "assistant-1:thinking",
      commandId: "assistant-1:thinking",
      kind: "think",
      title: "Thinking",
      status: "completed",
      output: "Let me think...",
      timestamp: "2026-06-29T10:00:01.000Z",
      updatedAt: "2026-06-29T10:00:01.000Z",
    },
  });

  assert.equal(aggregate.entries.length, 1);
  const entry = aggregate.entries[0];
  assert.equal(entry?.kind, "assistant_message");
  assert.equal(entry?.id, "assistant-1");
  if (entry?.kind === "assistant_message") {
    assert.equal(entry.chunks[0]?.kind, "thinking");
    assert.equal(entry.chunks[0]?.text, "Let me think...");
  }
});

test("aggregate second tool-call status update overwrites same entry", () => {
  let aggregate = createEmptySessionTimelineAggregate("session-5");

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "tool-call",
    toolCall: {
      id: "tool-1",
      kind: "read",
      title: "Read",
      status: "running",
      timestamp: "2026-06-29T10:00:01.000Z",
      updatedAt: "2026-06-29T10:00:01.000Z",
    },
  });

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "tool-call",
    toolCall: {
      id: "tool-1",
      kind: "read",
      title: "Read file.ts",
      status: "completed",
      output: "contents",
      timestamp: "2026-06-29T10:00:01.000Z",
      updatedAt: "2026-06-29T10:00:02.000Z",
    },
  });

  assert.equal(aggregate.entries.length, 1);
  const entry = aggregate.entries[0];
  assert.equal(entry?.kind, "tool_call");
  if (entry?.kind === "tool_call") {
    assert.equal(entry.toolCall.status, "completed");
    assert.equal(entry.toolCall.output, "contents");
  }
});

test("aggregate compaction(started) does not create an entry", () => {
  let aggregate = createEmptySessionTimelineAggregate("session-6");

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "compaction",
    phase: "started",
    source: "provider",
    timestamp: "2026-06-29T10:00:01.000Z",
  });

  assert.equal(aggregate.entries.length, 0);
});

test("aggregate compaction(completed) creates a context_compaction entry", () => {
  let aggregate = createEmptySessionTimelineAggregate("session-7");

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "compaction",
    phase: "completed",
    source: "provider",
    timestamp: "2026-06-29T10:00:01.000Z",
    summaryText: "Session compacted.",
  });

  assert.equal(aggregate.entries.length, 1);
  assert.equal(aggregate.entries[0]?.kind, "context_compaction");
});

test("buildSessionTimelineBatch returns null when entries unchanged", () => {
  const aggregate = createEmptySessionTimelineAggregate("session-8");
  const batch = buildSessionTimelineBatch(aggregate, aggregate);
  assert.equal(batch, null);
});

test("buildSessionTimelineBatch returns batch with deliverySequence", () => {
  const before = createEmptySessionTimelineAggregate("session-9");
  let after = createEmptySessionTimelineAggregate("session-9");

  after = applySessionRuntimeEvent(after, {
    type: "message",
    message: {
      id: "user-1",
      role: "user",
      text: "hello",
      timestamp: "2026-06-29T10:00:01.000Z",
    },
  });

  const batch = buildSessionTimelineBatch(before, after);
  assert.notEqual(batch, null);
  assert.equal(batch?.deliverySequence, 1);
  assert.equal(batch?.lastSequence, 1);
  assert.equal(batch?.entries.length, 1);
});
