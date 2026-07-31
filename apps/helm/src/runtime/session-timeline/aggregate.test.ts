import assert from "node:assert/strict";
import test from "node:test";
import {
  applySessionRuntimeEvent,
  buildSessionTimelineBatch,
  createEmptySessionTimelineAggregate,
} from "./aggregate";

test("aggregate records command output as an independent canonical entry", () => {
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
  const outputEntry = aggregate.entries.find((entry) => entry.kind === "command_output");
  assert.equal(toolEntry?.kind, "tool_call");
  assert.equal(toolEntry?.kind === "tool_call" ? toolEntry.toolCall.output : "", undefined);
  assert.equal(outputEntry?.kind, "command_output");
  assert.equal(outputEntry?.kind === "command_output" ? outputEntry.output.text : "", "PASS");
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

test("aggregate concatenates assistant delta chunks instead of overwriting them", () => {
  let aggregate = createEmptySessionTimelineAggregate("session-3b");

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "message",
    message: {
      id: "assistant-delta-1",
      role: "assistant",
      text: "Let me check",
      timestamp: "2026-07-03T22:40:01.000Z",
      streaming: true,
    },
  });

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "message",
    message: {
      id: "assistant-delta-1",
      role: "assistant",
      text: " how",
      timestamp: "2026-07-03T22:40:02.000Z",
      streaming: true,
    },
  });

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "message",
    message: {
      id: "assistant-delta-1",
      role: "assistant",
      text: "。",
      timestamp: "2026-07-03T22:40:03.000Z",
      streaming: false,
    },
  });

  assert.equal(aggregate.entries.length, 1);
  const entry = aggregate.entries[0];
  assert.equal(entry?.kind, "assistant_message");
  if (entry?.kind === "assistant_message") {
    assert.equal(entry.chunks.length, 1);
    assert.equal(entry.chunks[0]?.text, "Let me check how。");
    assert.equal(entry.streaming, false);
  }
});

test("buildSessionTimelineBatch emits assistant streaming updates even when the entry id stays the same", () => {
  const before = applySessionRuntimeEvent(
    createEmptySessionTimelineAggregate("session-3c"),
    {
      type: "message",
      message: {
        id: "assistant-stream-1",
        role: "assistant",
        text: "Now",
        timestamp: "2026-07-04T10:00:01.000Z",
        streaming: true,
      },
    },
  );

  const after = applySessionRuntimeEvent(before, {
    type: "message",
    message: {
      id: "assistant-stream-1",
      role: "assistant",
      text: " thinking",
      timestamp: "2026-07-04T10:00:02.000Z",
      streaming: true,
    },
  });

  const batch = buildSessionTimelineBatch(before, after);
  assert.ok(batch);
  assert.equal(batch?.entries[0]?.kind, "assistant_message");
  if (batch?.entries[0]?.kind === "assistant_message") {
    assert.equal(batch.entries[0].chunks[0]?.text, "Now thinking");
  }
});

test("aggregate nests thinking into assistant entry", () => {
  let aggregate = createEmptySessionTimelineAggregate("session-4");

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "message",
    message: {
      id: "assistant-1",
      role: "assistant",
      contentKind: "thought",
      text: "Let me think...",
      timestamp: "2026-06-29T10:00:01.000Z",
      streaming: false,
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

test("aggregate concatenates thinking delta chunks instead of overwriting them", () => {
  let aggregate = createEmptySessionTimelineAggregate("session-4b");

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "message",
    message: {
      id: "assistant-think-1",
      role: "assistant",
      contentKind: "thought",
      text: "Let me",
      timestamp: "2026-07-03T22:41:01.000Z",
      streaming: true,
      streamMode: "delta",
    },
  });

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "message",
    message: {
      id: "assistant-think-1",
      role: "assistant",
      contentKind: "thought",
      text: " think",
      timestamp: "2026-07-03T22:41:02.000Z",
      streaming: true,
      streamMode: "delta",
    },
  });

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "message",
    message: {
      id: "assistant-think-1",
      role: "assistant",
      contentKind: "thought",
      text: "。",
      timestamp: "2026-07-03T22:41:03.000Z",
      streaming: false,
      streamMode: "delta",
    },
  });

  assert.equal(aggregate.entries.length, 1);
  const entry = aggregate.entries[0];
  assert.equal(entry?.kind, "assistant_message");
  if (entry?.kind === "assistant_message") {
    assert.equal(entry.chunks.length, 1);
    assert.equal(entry.chunks[0]?.kind, "thinking");
    assert.equal(entry.chunks[0]?.text, "Let me think。");
  }
});

test("buildSessionTimelineBatch emits thinking streaming updates even when the assistant entry is reused", () => {
  const before = applySessionRuntimeEvent(
    createEmptySessionTimelineAggregate("session-4c"),
    {
      type: "message",
      message: {
        id: "assistant-think-stream",
        role: "assistant",
        contentKind: "thought",
        text: "Let me",
        timestamp: "2026-07-04T10:01:01.000Z",
        streaming: true,
        streamMode: "delta",
      },
    },
  );

  const after = applySessionRuntimeEvent(before, {
    type: "message",
    message: {
      id: "assistant-think-stream",
      role: "assistant",
      contentKind: "thought",
      text: " think",
      timestamp: "2026-07-04T10:01:02.000Z",
      streaming: true,
      streamMode: "delta",
    },
  });

  const batch = buildSessionTimelineBatch(before, after);
  assert.ok(batch);
  assert.equal(batch?.entries[0]?.kind, "assistant_message");
  if (batch?.entries[0]?.kind === "assistant_message") {
    assert.equal(batch.entries[0].chunks[0]?.kind, "thinking");
    assert.equal(batch.entries[0].chunks[0]?.text, "Let me think");
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

test("aggregate compaction(started) creates a pending context_compaction entry", () => {
  let aggregate = createEmptySessionTimelineAggregate("session-6");

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "compaction",
    phase: "started",
    source: "provider",
    timestamp: "2026-06-29T10:00:01.000Z",
  });

  assert.equal(aggregate.entries.length, 1);
  const entry = aggregate.entries[0];
  assert.equal(entry?.kind, "context_compaction");
  if (entry?.kind === "context_compaction") {
    assert.equal(entry.phase, "started");
    assert.equal(entry.source, "provider");
    assert.equal(entry.summaryText, undefined);
  }
});

test("aggregate compaction(completed) updates the pending context_compaction entry", () => {
  let aggregate = createEmptySessionTimelineAggregate("session-7");

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "compaction",
    phase: "started",
    source: "provider",
    timestamp: "2026-06-29T10:00:01.000Z",
  });

  aggregate = applySessionRuntimeEvent(aggregate, {
    type: "compaction",
    phase: "completed",
    source: "provider",
    timestamp: "2026-06-29T10:00:20.000Z",
    summaryText: "Session compacted.",
  });

  assert.equal(aggregate.entries.length, 1);
  const entry = aggregate.entries[0];
  assert.equal(entry?.kind, "context_compaction");
  if (entry?.kind === "context_compaction") {
    assert.equal(entry.phase, "completed");
    assert.equal(entry.source, "provider");
    assert.equal(entry.summaryText, "Session compacted.");
    assert.equal(entry.updatedAt, "2026-06-29T10:00:20.000Z");
  }
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
