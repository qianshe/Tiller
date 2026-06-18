import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionSummary,
} from "@tiller/shared";
import type { StoredSessionRuntimeDescriptor } from "@tiller/persistence";
import {
  createSqliteSessionArtifactStore,
  createSqliteSessionMessageStore,
  createSqliteSessionRuntimeStore,
  createSqliteSessionStore,
} from "@tiller/persistence/sqlite";

function createSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    projectId: "project-1",
    projectName: "Project",
    helmId: "local",
    cwd: "D:/workspace/project",
    worktreeName: "main",
    agentId: "codex",
    agentName: "Codex",
    status: "idle",
    createdAt: "2026-05-29T10:00:00.000Z",
    updatedAt: "2026-05-29T10:00:00.000Z",
    messageCount: 0,
    ...overrides,
  };
}

function createMessage(id: string, timestamp: string): AgentMessage {
  return {
    id,
    role: "assistant",
    text: `message ${id}`,
    timestamp,
  };
}

function createOutput(id: string, timestamp: string): CommandChunk {
  return {
    id,
    commandId: `command-${id}`,
    text: `output ${id}`,
    stream: "stdout",
    timestamp,
  };
}

function createDiff(path: string): FileDiffSummary {
  return {
    path,
    status: "modified",
    additions: 1,
    deletions: 0,
  };
}

function createToolCall(id: string, timestamp: string): AgentToolCall {
  return {
    id,
    kind: "tool",
    title: `Tool ${id}`,
    status: "completed",
    timestamp,
    updatedAt: timestamp,
  };
}

test("SessionSummaryStore contract supports list upsert and remove", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-store-contract-summary-"));
  const store = createSqliteSessionStore(join(tempRoot, "sessions.sqlite"));
  try {
    assert.deepEqual(store.list(), []);

    assert.deepEqual(
      store
        .upsert(createSummary({ id: "older", updatedAt: "2026-05-29T10:00:00.000Z" }))
        .map((summary) => summary.id),
      ["older"],
    );
    assert.deepEqual(
      store
        .upsert(createSummary({ id: "newer", updatedAt: "2026-05-29T11:00:00.000Z" }))
        .map((summary) => summary.id),
      ["newer", "older"],
    );
    assert.deepEqual(
      store.remove("newer").map((summary) => summary.id),
      ["older"],
    );
  } finally {
    store.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("SessionMessageStore contract supports append replace paging and remove", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-store-contract-message-"));
  const store = createSqliteSessionMessageStore(join(tempRoot, "sessions.sqlite"));
  try {
    store.append("session-1", createMessage("m1", "2026-05-29T10:00:00.000Z"));
    store.append("session-1", createMessage("m2", "2026-05-29T10:00:01.000Z"));
    assert.deepEqual(
      store.list("session-1").map((message) => message.id),
      ["m1", "m2"],
    );

    store.replace("session-1", [
      createMessage("m1", "2026-05-29T10:00:00.000Z"),
      createMessage("m2", "2026-05-29T10:00:01.000Z"),
      createMessage("m3", "2026-05-29T10:00:02.000Z"),
    ]);
    const firstPage = store.listPage("session-1", { limit: 2 });
    assert.deepEqual(
      firstPage.messages.map((message) => message.id),
      ["m2", "m3"],
    );
    assert.equal(firstPage.hasMore, true);
    assert.deepEqual(
      store
        .listPage("session-1", { limit: 2, before: firstPage.nextCursor })
        .messages.map((message) => message.id),
      ["m1"],
    );

    store.remove("session-1");
    assert.deepEqual(store.list("session-1"), []);
  } finally {
    store.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("SessionArtifactStore contract supports outputs diffs tool calls paging and remove", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-store-contract-artifact-"));
  const store = createSqliteSessionArtifactStore(join(tempRoot, "sessions.sqlite"));
  try {
    store.appendOutput("session-1", createOutput("out-1", "2026-05-29T10:00:00.000Z"));
    store.appendOutput("session-1", createOutput("out-2", "2026-05-29T10:00:01.000Z"));
    store.replaceDiffs("session-1", [createDiff("src/a.ts")]);
    store.appendToolCall("session-1", createToolCall("tool-1", "2026-05-29T10:00:02.000Z"));

    const artifacts = store.get("session-1");
    assert.deepEqual(
      artifacts.outputs.map((output) => output.id),
      ["out-1", "out-2"],
    );
    assert.deepEqual(
      artifacts.diffs.map((diff) => diff.path),
      ["src/a.ts"],
    );
    assert.deepEqual(
      artifacts.toolCalls.map((toolCall) => toolCall.id),
      ["tool-1"],
    );
    assert.equal(store.getPage("session-1", { limit: 1 }).hasMore, true);

    store.replaceOutputs("session-1", [
      createOutput("out-3", "2026-05-29T10:00:04.000Z"),
    ]);
    assert.deepEqual(
      store.get("session-1").outputs.map((output) => output.id),
      ["out-3"],
    );
    store.replaceToolCalls("session-1", [
      createToolCall("tool-2", "2026-05-29T10:00:03.000Z"),
    ]);
    assert.deepEqual(
      store.get("session-1").toolCalls.map((toolCall) => toolCall.id),
      ["tool-2"],
    );
    store.remove("session-1");
    assert.deepEqual(store.get("session-1"), { outputs: [], diffs: [], toolCalls: [] });
  } finally {
    store.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("SessionRuntimeStore contract supports list get upsert and remove", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-store-contract-runtime-"));
  const store = createSqliteSessionRuntimeStore(join(tempRoot, "sessions.sqlite"));
  try {
    const descriptor: StoredSessionRuntimeDescriptor = {
      sessionId: "session-1",
      providerId: "codex",
      runtimeSessionId: "runtime-1",
      lastSeenAt: "2026-05-29T10:00:00.000Z",
      state: "resumeable",
      capabilities: { sessionLoad: true },
    };

    assert.equal(store.get("session-1"), null);
    assert.deepEqual(store.upsert(descriptor), descriptor);
    assert.deepEqual(store.get("session-1"), descriptor);
    assert.deepEqual(
      store.list().map((item) => item.sessionId),
      ["session-1"],
    );
    store.remove("session-1");
    assert.equal(store.get("session-1"), null);
  } finally {
    store.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
