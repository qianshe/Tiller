import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentToolCall, CommandChunk, FileDiffSummary } from "@tiller/shared";

type ArtifactStore = {
  appendOutput: (sessionId: string, chunk: CommandChunk) => { outputs: CommandChunk[]; diffs: FileDiffSummary[]; toolCalls: AgentToolCall[] };
  replaceDiffs: (sessionId: string, diffs: FileDiffSummary[]) => { outputs: CommandChunk[]; diffs: FileDiffSummary[]; toolCalls: AgentToolCall[] };
  appendToolCall: (sessionId: string, toolCall: AgentToolCall) => { outputs: CommandChunk[]; diffs: FileDiffSummary[]; toolCalls: AgentToolCall[] };
  replaceToolCalls: (sessionId: string, toolCalls: AgentToolCall[]) => { outputs: CommandChunk[]; diffs: FileDiffSummary[]; toolCalls: AgentToolCall[] };
  get: (sessionId: string) => { outputs: CommandChunk[]; diffs: FileDiffSummary[]; toolCalls: AgentToolCall[] };
  getPage: (sessionId: string, options?: { limit?: number; before?: string }) => { outputs: CommandChunk[]; diffs: FileDiffSummary[]; toolCalls: AgentToolCall[]; nextCursor?: string; hasMore: boolean };
  remove: (sessionId: string) => void;
};

test("session artifact store persists command output history and latest diff snapshot", async () => {
  let mod: null | {
    createSessionArtifactStore: (rootDir: string) => ArtifactStore;
  } = null;

  try {
    mod = await import("./artifact-store.js");
  } catch {
    mod = null;
  }

  assert.ok(mod?.createSessionArtifactStore, "createSessionArtifactStore export is missing");

  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-artifact-store-"));

  try {
    const store = mod.createSessionArtifactStore(tempRoot);
    const output: CommandChunk = {
      id: "chunk-1",
      commandId: "cmd-1",
      text: "npm test",
      stream: "stdout",
      timestamp: "2026-04-26T12:15:00.000Z",
    };
    const diffs: FileDiffSummary[] = [
      {
        path: "apps/web/src/App.tsx",
        status: "modified",
        additions: 10,
        deletions: 2,
      },
    ];

    const toolCall: AgentToolCall = {
      id: "tool-1",
      kind: "tool",
      title: "mcp search",
      status: "completed",
      output: "ok",
      timestamp: "2026-04-26T12:15:01.000Z",
      updatedAt: "2026-04-26T12:15:01.000Z",
    };

    store.appendOutput("session-1", output);
    store.replaceDiffs("session-1", diffs);
    store.appendToolCall("session-1", toolCall);

    const reloadedStore = mod.createSessionArtifactStore(tempRoot);
    const sessionArtifacts = reloadedStore.get("session-1");

    assert.equal(sessionArtifacts.outputs.length, 1);
    assert.deepEqual(sessionArtifacts.outputs[0], output);
    assert.deepEqual(sessionArtifacts.diffs, diffs);
    assert.deepEqual(sessionArtifacts.toolCalls, [toolCall]);
    assert.deepEqual(reloadedStore.get("session-2"), { outputs: [], diffs: [], toolCalls: [] });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("session artifact store returns outputs and tool calls sorted by timestamp", async () => {
  const mod = await import("./artifact-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-artifact-store-sort-"));

  try {
    const store = mod.createSessionArtifactStore(tempRoot);
    store.appendOutput("session-1", { id: "out-late", commandId: "cmd", text: "late", stream: "stdout", timestamp: "2026-04-26T12:15:02.000Z" });
    store.appendOutput("session-1", { id: "out-early", commandId: "cmd", text: "early", stream: "stdout", timestamp: "2026-04-26T12:15:01.000Z" });
    store.appendToolCall("session-1", { id: "tool-late", kind: "terminal", title: "late", status: "completed", timestamp: "2026-04-26T12:15:03.000Z", updatedAt: "2026-04-26T12:15:03.000Z" });
    store.appendToolCall("session-1", { id: "tool-early", kind: "terminal", title: "early", status: "completed", timestamp: "2026-04-26T12:15:01.000Z", updatedAt: "2026-04-26T12:15:01.000Z" });

    const artifacts = store.get("session-1");
    assert.deepEqual(artifacts.outputs.map((item) => item.id), ["out-early", "out-late"]);
    assert.deepEqual(artifacts.toolCalls.map((item) => item.id), ["tool-early", "tool-late"]);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session artifact store keeps the first timestamp for tool call updates", async () => {
  const mod = await import("./artifact-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-artifact-store-tool-update-"));

  try {
    const store = mod.createSessionArtifactStore(tempRoot);
    store.appendToolCall("session-1", {
      id: "tool-1",
      kind: "tool",
      title: "mcp search",
      status: "pending",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.627Z",
    });
    store.appendToolCall("session-1", {
      id: "tool-1",
      kind: "tool",
      title: "mcp search",
      status: "completed",
      output: "ok",
      timestamp: "2026-04-30T13:22:46.630Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    });

    assert.deepEqual(store.get("session-1").toolCalls, [{
      id: "tool-1",
      kind: "tool",
      title: "mcp search",
      status: "completed",
      output: "ok",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    }]);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session artifact store keeps informative tool title when later updates only carry call id", async () => {
  const mod = await import("./artifact-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-artifact-store-tool-title-"));

  try {
    const store = mod.createSessionArtifactStore(tempRoot);
    store.appendToolCall("session-1", {
      id: "call_abc123",
      kind: "tool",
      title: "Tool: mcp_router/find_symbol",
      status: "running",
      timestamp: "2026-04-30T13:22:46.627Z",
      updatedAt: "2026-04-30T13:22:46.627Z",
    });
    store.appendToolCall("session-1", {
      id: "call_abc123",
      kind: "tool",
      title: "call_abc123",
      status: "completed",
      output: "ok",
      timestamp: "2026-04-30T13:22:46.630Z",
      updatedAt: "2026-04-30T13:22:46.630Z",
    });

    assert.equal(store.get("session-1").toolCalls[0]?.title, "Tool: mcp_router/find_symbol");
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session artifact store replaces tool calls while keeping outputs and diffs", async () => {
  const mod = await import("./artifact-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-artifact-store-replace-tools-"));

  try {
    const store = mod.createSessionArtifactStore(tempRoot);
    store.appendOutput("session-1", { id: "out-1", commandId: "cmd", text: "output", stream: "stdout", timestamp: "2026-04-30T13:22:46.000Z" });
    store.replaceDiffs("session-1", [{ path: "a.ts", status: "modified", additions: 1, deletions: 0 }]);
    store.appendToolCall("session-1", { id: "stale", kind: "tool", title: "stale", status: "completed", timestamp: "2026-04-30T13:22:46.000Z", updatedAt: "2026-04-30T13:22:46.000Z" });
    store.replaceToolCalls("session-1", [
      { id: "tool-2", kind: "tool", title: "newer", status: "completed", timestamp: "2026-04-30T09:59:11.000Z", updatedAt: "2026-04-30T09:59:12.000Z" },
      { id: "tool-1", kind: "tool", title: "older", status: "completed", timestamp: "2026-04-30T09:58:57.000Z", updatedAt: "2026-04-30T09:58:58.000Z" },
    ]);

    const artifacts = store.get("session-1");
    assert.deepEqual(artifacts.outputs.map((item) => item.id), ["out-1"]);
    assert.deepEqual(artifacts.diffs.map((item) => item.path), ["a.ts"]);
    assert.deepEqual(artifacts.toolCalls.map((item) => item.id), ["tool-1", "tool-2"]);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session artifact store removes only the targeted session artifacts", async () => {
  const mod = await import("./artifact-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-artifact-store-delete-"));

  try {
    const store = mod.createSessionArtifactStore(tempRoot);
    store.appendOutput("session-1", {
      id: "chunk-1",
      commandId: "cmd-1",
      text: "delete me",
      stream: "stdout",
      timestamp: "2026-04-27T08:05:00.000Z",
    });
    store.replaceDiffs("session-1", [{ path: "a.ts", status: "modified", additions: 1, deletions: 0 }]);
    store.appendOutput("session-2", {
      id: "chunk-2",
      commandId: "cmd-2",
      text: "keep me",
      stream: "stdout",
      timestamp: "2026-04-27T08:05:01.000Z",
    });

    store.remove("session-1");

    const reloadedStore = mod.createSessionArtifactStore(tempRoot);
    assert.deepEqual(reloadedStore.get("session-1"), { outputs: [], diffs: [], toolCalls: [] });
    assert.equal(reloadedStore.get("session-2").outputs.length, 1);
    assert.equal(reloadedStore.get("session-2").outputs[0]?.id, "chunk-2");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("session artifact store pages latest tool activity and keeps latest diffs", async () => {
  const mod = await import("./artifact-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-artifact-store-page-"));

  try {
    const store = mod.createSessionArtifactStore(tempRoot);
    store.replaceDiffs("session-1", [{ path: "a.ts", status: "modified", additions: 1, deletions: 0 }]);
    for (let index = 1; index <= 4; index += 1) {
      store.appendToolCall("session-1", {
        id: `tool-${index}`,
        kind: "terminal",
        title: `tool ${index}`,
        status: "completed",
        timestamp: `2026-04-27T08:05:0${index}.000Z`,
        updatedAt: `2026-04-27T08:05:0${index}.000Z`,
      });
    }

    const latest = store.getPage("session-1", { limit: 2 });
    assert.deepEqual(latest.toolCalls.map((item) => item.id), ["tool-3", "tool-4"]);
    assert.deepEqual(latest.diffs.map((item) => item.path), ["a.ts"]);
    assert.equal(latest.hasMore, true);

    const older = store.getPage("session-1", { limit: 2, before: latest.nextCursor });
    assert.deepEqual(older.toolCalls.map((item) => item.id), ["tool-1", "tool-2"]);
    assert.equal(older.hasMore, false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
