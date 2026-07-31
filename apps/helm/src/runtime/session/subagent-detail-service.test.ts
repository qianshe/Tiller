import assert from "node:assert/strict";
import test from "node:test";
import type { SessionSubagentDetailStore } from "@tiller/persistence";
import type {
  SessionSubagentDetail,
  SessionSubagentDetailDelta,
  SessionTimelineBatch,
  SessionTimelineEntry,
} from "@tiller/shared";
import { createSessionSubagentDetailService } from "./subagent-detail-service";

test("subagent detail service builds a logical timeline with prompt, thinking, tools and reply", () => {
  const { store, details } = createMemoryStore();
  const published: SessionSubagentDetailDelta[] = [];
  const service = createSessionSubagentDetailService({
    store,
    publish: (_sessionId, delta) => published.push(delta),
    flushWindowMs: 60_000,
  });

  service.registerRoot("session-1", {
    id: "root-1",
    kind: "subagent",
    title: "Inspect files",
    status: "running",
    input: JSON.stringify({ prompt: "Inspect the repository" }),
    timestamp: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
  });
  service.handleEvent("session-1", "root-1", {
    type: "message",
    origin: { scope: "subagent", parentToolCallId: "root-1" },
    message: {
      id: "reply-1",
      role: "assistant",
      contentKind: "thought",
      text: "I should inspect the files",
      timestamp: "2026-07-22T00:00:01.000Z",
      streaming: false,
    },
  });
  service.handleEvent("session-1", "root-1", {
    type: "tool-call",
    origin: { scope: "subagent", parentToolCallId: "root-1" },
    toolCall: {
      id: "tool-shell",
      commandId: "command-shell",
      kind: "shell",
      title: "Run tests",
      status: "running",
      timestamp: "2026-07-22T00:00:02.000Z",
      updatedAt: "2026-07-22T00:00:02.000Z",
    },
  });
  service.handleEvent("session-1", "root-1", {
    type: "tool-call",
    origin: { scope: "subagent", parentToolCallId: "root-1" },
    toolCall: {
      id: "tool-command-shell",
      commandId: "command-shell",
      kind: "tool",
      title: "Command",
      status: "running",
      output: "passed",
      timestamp: "2026-07-22T00:00:03.000Z",
      updatedAt: "2026-07-22T00:00:03.000Z",
    },
  });
  service.handleEvent("session-1", "root-1", {
    type: "command-output",
    origin: { scope: "subagent", parentToolCallId: "root-1" },
    chunk: {
      id: "output-1",
      commandId: "command-shell",
      text: "passed",
      stream: "stdout",
      timestamp: "2026-07-22T00:00:04.000Z",
    },
  });
  service.handleEvent("session-1", "root-1", {
    type: "message",
    origin: { scope: "subagent", parentToolCallId: "root-1" },
    message: {
      id: "reply-1",
      role: "assistant",
      text: "The tests passed",
      timestamp: "2026-07-22T00:00:05.000Z",
      streaming: false,
      streamMode: "snapshot",
    },
  });

  const detail = service.getDetail("session-1", "root-1");
  assert.deepEqual(detail.entries.map((entry) => entry.kind), [
    "user_message",
    "assistant_message",
    "tool_call",
  ]);
  const thinking = detail.entries.find((entry) =>
    entry.kind === "assistant_message" &&
    entry.chunks.some((chunk) => chunk.kind === "thinking")
  );
  assert.ok(thinking);
  assert.ok(
    thinking?.kind === "assistant_message" &&
    thinking.chunks.some((chunk) => chunk.kind === "content" && chunk.text === "The tests passed"),
  );
  const shellEntries = detail.entries.filter((entry) =>
    entry.kind === "tool_call" && entry.toolCall.commandId === "command-shell"
  );
  assert.equal(shellEntries.length, 1);
  assert.equal(shellEntries[0]?.kind === "tool_call" ? shellEntries[0].toolCall.title : undefined, "Run tests");
  assert.equal(shellEntries[0]?.kind === "tool_call" ? shellEntries[0].toolCall.output : undefined, "passed");
  assert.ok(published.length > 0);
  assert.ok(published.every((delta) => delta.batch.entries.length === 1));
  assert.equal(details.size, 1);
  service.dispose();
});

test("subagent detail service keeps terminal tool status monotonic", () => {
  const { store } = createMemoryStore();
  const service = createSessionSubagentDetailService({
    store,
    publish: () => undefined,
    flushWindowMs: 60_000,
  });
  for (const status of ["running", "completed", "running"] as const) {
    service.handleEvent("session-1", "root-1", {
      type: "tool-call",
      toolCall: {
        id: "tool-1",
        kind: "read",
        title: "Read file",
        status,
        timestamp: "2026-07-22T00:00:01.000Z",
        updatedAt: "2026-07-22T00:00:02.000Z",
      },
      origin: { scope: "subagent", parentToolCallId: "root-1" },
    });
  }
  service.flush("session-1");
  const tool = service.getDetail("session-1", "root-1").entries.find(
    (entry) => entry.kind === "tool_call",
  );
  assert.equal(tool?.kind === "tool_call" ? tool.toolCall.status : undefined, "completed");
  service.dispose();
});

test("subagent detail service registers the root prompt once across lifecycle updates", () => {
  const { store } = createMemoryStore();
  const published: SessionSubagentDetailDelta[] = [];
  const service = createSessionSubagentDetailService({
    store,
    publish: (_sessionId, delta) => published.push(delta),
    flushWindowMs: 60_000,
  });
  const root = {
    id: "root-1",
    kind: "subagent" as const,
    title: "Inspect files",
    input: JSON.stringify({ prompt: "Inspect the repository" }),
    timestamp: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:01.000Z",
  };

  service.registerRoot("session-1", { ...root, status: "running" });
  service.flush("session-1");
  service.registerRoot("session-1", { ...root, status: "completed" });

  const detail = service.getDetail("session-1", "root-1");
  assert.equal(detail.entries.filter((entry) => entry.kind === "user_message").length, 1);
  assert.equal(published.length, 1);
  service.dispose();
});

test("subagent detail service adds the completed root result when no child reply arrived", () => {
  const { store } = createMemoryStore();
  const service = createSessionSubagentDetailService({
    store,
    publish: () => undefined,
    flushWindowMs: 60_000,
  });
  const prompt = "Inspect the repository";
  const finalReply = "The repository is implementing nested Subagent conversations.";
  const root = {
    id: "root-1",
    kind: "subagent" as const,
    title: "Inspect files",
    input: JSON.stringify({ prompt }),
    timestamp: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:01.000Z",
  };

  service.registerRoot("session-1", { ...root, status: "running" });
  service.handleEvent("session-1", "root-1", {
    type: "tool-call",
    origin: { scope: "subagent", parentToolCallId: "root-1" },
    toolCall: {
      id: "read-1",
      kind: "read",
      title: "Read README.md",
      status: "completed",
      timestamp: "2026-07-22T00:00:00.500Z",
      updatedAt: "2026-07-22T00:00:00.600Z",
    },
  });
  service.registerRoot("session-1", {
    ...root,
    status: "completed",
    output: finalReply,
  });

  const detail = service.getDetail("session-1", "root-1");
  assert.deepEqual(detail.entries.map((entry) => entry.kind), [
    "user_message",
    "tool_call",
    "assistant_message",
  ]);
  const assistant = detail.entries.find((entry) => entry.kind === "assistant_message");
  assert.deepEqual(
    assistant?.kind === "assistant_message"
      ? assistant.chunks.map((chunk) => ({ kind: chunk.kind, text: chunk.text }))
      : [],
    [{ kind: "content", text: finalReply }],
  );
  service.dispose();
});

test("subagent detail service does not duplicate a real child reply with the root result", () => {
  const { store } = createMemoryStore();
  const service = createSessionSubagentDetailService({
    store,
    publish: () => undefined,
    flushWindowMs: 60_000,
  });
  const root = {
    id: "root-1",
    kind: "subagent" as const,
    title: "Inspect files",
    status: "running" as const,
    input: JSON.stringify({ prompt: "Inspect the repository" }),
    timestamp: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:01.000Z",
  };

  service.registerRoot("session-1", root);
  service.handleEvent("session-1", "root-1", {
    type: "message",
    origin: { scope: "subagent", parentToolCallId: "root-1" },
    message: {
      id: "real-reply",
      role: "assistant",
      text: "The real child reply",
      timestamp: "2026-07-22T00:00:02.000Z",
      streaming: false,
      streamMode: "snapshot",
    },
  });
  service.registerRoot("session-1", {
    ...root,
    status: "completed",
    output: "The root fallback reply",
  });

  const replies = service.getDetail("session-1", "root-1").entries
    .filter((entry) => entry.kind === "assistant_message")
    .flatMap((entry) => entry.chunks)
    .filter((chunk) => chunk.kind === "content")
    .map((chunk) => chunk.text);
  assert.deepEqual(replies, ["The real child reply"]);
  service.dispose();
});

test("subagent deletion discards pending work and rejects late events", () => {
  const { store, details } = createMemoryStore();
  const published: SessionSubagentDetailDelta[] = [];
  const service = createSessionSubagentDetailService({
    store,
    publish: (_sessionId, delta) => published.push(delta),
    flushWindowMs: 60_000,
  });
  service.handleEvent("session-1", "root-1", {
    type: "message",
    message: {
      id: "reply-1",
      role: "assistant",
      text: "pending",
      timestamp: "2026-07-22T00:00:01.000Z",
      streaming: true,
    },
    origin: { scope: "subagent", parentToolCallId: "root-1" },
  });

  service.beginDelete("session-1");
  service.remove("session-1");
  service.handleEvent("session-1", "root-1", {
    type: "message",
    message: {
      id: "reply-1",
      role: "assistant",
      text: "late",
      timestamp: "2026-07-22T00:00:02.000Z",
      streaming: false,
    },
    origin: { scope: "subagent", parentToolCallId: "root-1" },
  });
  service.flush("session-1");

  assert.equal(details.size, 0);
  assert.equal(published.length, 0);
  service.dispose();
});

test("subagent detail service retries persistence before broadcasting", () => {
  const memory = createMemoryStore();
  let shouldFail = true;
  const store: SessionSubagentDetailStore = {
    ...memory.store,
    commitBatch(sessionId, parentToolCallId, batch) {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("write failed");
      }
      return memory.store.commitBatch(sessionId, parentToolCallId, batch);
    },
  };
  const published: SessionSubagentDetailDelta[] = [];
  const service = createSessionSubagentDetailService({
    store,
    publish: (_sessionId, delta) => published.push(delta),
    flushWindowMs: 60_000,
  });
  service.handleEvent("session-1", "root-1", {
    type: "message",
    message: {
      id: "reply-1",
      role: "assistant",
      text: "done",
      timestamp: "2026-07-22T00:00:01.000Z",
      streaming: false,
    },
    origin: { scope: "subagent", parentToolCallId: "root-1" },
  });
  assert.equal(published.length, 0);

  service.flush("session-1");
  assert.equal(published.length, 1);
  assert.equal(service.getDetail("session-1", "root-1").entries.length, 1);
  service.dispose();
});

function createMemoryStore() {
  const details = new Map<string, SessionSubagentDetail>();
  const key = (sessionId: string, parentToolCallId: string) => `${sessionId}\0${parentToolCallId}`;
  const store: SessionSubagentDetailStore = {
    get(sessionId, parentToolCallId) {
      return details.get(key(sessionId, parentToolCallId)) ?? {
        sessionId,
        parentToolCallId,
        throughSequence: 0,
        entries: [],
      };
    },
    commitBatch(sessionId, parentToolCallId, batch) {
      const current = this.get(sessionId, parentToolCallId);
      const entries = new Map(current.entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
      for (const entry of batch.entries) entries.set(`${entry.kind}:${entry.id}`, entry);
      const next: SessionSubagentDetail = {
        sessionId,
        parentToolCallId,
        throughSequence: Math.max(current.throughSequence, batch.lastSequence),
        entries: [...entries.values()].sort(compareEntries),
      };
      details.set(key(sessionId, parentToolCallId), next);
      return next;
    },
    remove(sessionId) {
      for (const detailKey of [...details.keys()]) {
        if (detailKey.startsWith(`${sessionId}\0`)) details.delete(detailKey);
      }
    },
  };
  return { details, store };
}

function compareEntries(left: SessionTimelineEntry, right: SessionTimelineEntry) {
  return entrySequence(left) - entrySequence(right) || left.id.localeCompare(right.id);
}

function entrySequence(entry: SessionTimelineEntry) {
  return "sequence" in entry ? entry.sequence ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
}
