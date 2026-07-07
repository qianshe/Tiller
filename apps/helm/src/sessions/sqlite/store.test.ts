import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
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
  initializeSqliteSessionStore,
  migrateJsonSessionDataToSqlite,
} from "@tiller/persistence/sqlite";

function createSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    projectId: "project-1",
    projectName: "Project",
    helmId: "local",
    cwd: "worktree-1",
    worktreeName: "Worktree",
    agentId: "codex",
    agentName: "Codex",
    status: "idle",
    createdAt: "2026-04-30T10:00:00.000Z",
    updatedAt: "2026-04-30T10:00:00.000Z",
    messageCount: 0,
    ...overrides,
  };
}

function createMessage(id: string, timestamp: string, text = id): AgentMessage {
  return { id, role: "assistant", text, timestamp };
}

function createOutput(id: string, timestamp: string): CommandChunk {
  return { id, commandId: `cmd-${id}`, text: `output-${id}`, stream: "stdout", timestamp };
}

function createToolCall(
  id: string,
  timestamp: string,
  overrides: Partial<AgentToolCall> = {},
): AgentToolCall {
  return {
    id,
    kind: "tool",
    title: `Tool ${id}`,
    status: "running",
    timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function createDiff(path: string): FileDiffSummary {
  return { path, status: "modified", additions: 1, deletions: 2 };
}


test("sqlite session store initializes repeatedly and preserves summary ordering", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-sqlite-summary-"));
  try {
    const dbPath = join(tempRoot, "sessions.sqlite");
    initializeSqliteSessionStore(dbPath);
    initializeSqliteSessionStore(dbPath);

    const store = createSqliteSessionStore(dbPath);
    try {
      store.upsert(createSummary({ id: "old", updatedAt: "2026-04-30T10:00:00.000Z" }));
      store.upsert(createSummary({ id: "new", updatedAt: "2026-04-30T11:00:00.000Z" }));

      assert.deepEqual(
        store.list().map((item) => item.id),
        ["new", "old"],
      );
      assert.deepEqual(
        store.remove("new").map((item) => item.id),
        ["old"],
      );
    } finally {
      store.close();
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("sqlite message store matches append merge, replace, pagination, and remove semantics", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-sqlite-message-"));
  try {
    const dbPath = join(tempRoot, "sessions.sqlite");
    const store = createSqliteSessionMessageStore(dbPath);
    try {
      store.append("session-1", createMessage("m1", "2026-04-30T10:00:00.000Z", "Hello"));
      store.append("session-1", createMessage("m1", "2026-04-30T10:00:01.000Z", " world"));
      store.append("session-1", createMessage("m2", "2026-04-30T10:00:02.000Z", "Later"));
      store.append(
        "session-2",
        createMessage("session-2-msg-1000", "2026-04-30T10:00:00.000Z", "执行 pnpm "),
      );
      store.append(
        "session-2",
        createMessage("session-2-msg-1001", "2026-04-30T10:00:01.000Z", "typecheck 验证喵~"),
      );
      store.append(
        "session-3",
        createMessage("session-3-msg-1000", "2026-04-30T10:00:00.000Z", "主人，已完成"),
      );
      store.append(
        "session-3",
        createMessage("session-3-msg-1001", "2026-04-30T10:00:01.000Z", "主人，已完成本轮验证喵~"),
      );
      const finalAnswer =
        "主人，已完成本轮最小改动喵~\n\n| 项目 | 内容 |\n|---|---|\n| **产物** | `apps/deck/src/app/App.tsx` |";
      const bridge =
        "我会按 `superpowers` 流程做最小定位与修改，并优先用 MCP 搜索/编辑，确保 typecheck 验证喵~";
      store.append(
        "session-4",
        createMessage("session-4-msg-1000", "2026-04-30T10:00:00.000Z", finalAnswer),
      );
      store.append(
        "session-4",
        createMessage(
          "session-4-msg-1001",
          "2026-04-30T10:00:01.000Z",
          `${finalAnswer}${bridge}${finalAnswer}`,
        ),
      );

      assert.equal(store.list("session-1")[0]?.text, "Hello world");
      assert.deepEqual(store.list("session-2"), [
        {
          id: "session-2-msg-1000",
          role: "assistant",
          text: "执行 pnpm typecheck 验证喵~",
          timestamp: "2026-04-30T10:00:00.000Z",
        },
      ]);
      assert.deepEqual(store.list("session-3"), [
        {
          id: "session-3-msg-1000",
          role: "assistant",
          text: "主人，已完成本轮验证喵~",
          timestamp: "2026-04-30T10:00:00.000Z",
        },
      ]);
      assert.equal(store.list("session-4")[0]?.text, finalAnswer);
      const replayedText =
        "我会使用 `superpowers:systematic-debugging` 来先定位根因，再做最小修复喵~[🌳木] 目标：定位并修复 mission 页左侧项目展开/收起失效的根因；验收是能通过代码/类型检查，并给出可复核的交互点。先读取项目上下文与相关代码喵~";
      const replayHead = replayedText.slice(0, 55);
      const replayTail = replayedText.slice(55);
      store.append(
        "session-5",
        createMessage("session-5-msg-1000", "2026-04-30T10:00:00.000Z", replayHead),
      );
      store.append(
        "session-5",
        createMessage("session-5-msg-1001", "2026-04-30T10:00:01.000Z", replayTail),
      );
      store.append(
        "session-5",
        createMessage("session-5-msg-1002", "2026-04-30T10:00:02.000Z", replayHead),
      );
      store.append(
        "session-5",
        createMessage("session-5-msg-1003", "2026-04-30T10:00:03.000Z", replayTail),
      );
      assert.equal(store.list("session-5")[0]?.text, replayedText);
      store.append(
        "session-6",
        createMessage(
          "session-6-msg-000001-000000-cabc12345",
          "2026-04-30T10:00:00.000Z",
          "first segment",
        ),
      );
      store.append(
        "session-6",
        createMessage(
          "session-6-msg-000001-000000-cdef67890",
          "2026-04-30T10:00:01.000Z",
          " continued",
        ),
      );
      store.append(
        "session-6",
        createMessage(
          "session-6-msg-000001-000001-c12345678",
          "2026-04-30T10:00:02.000Z",
          "second segment",
        ),
      );
      assert.deepEqual(
        store.list("session-6").map((item) => item.text),
        ["first segment continued", "second segment"],
      );
      const firstPage = store.listPage("session-1", { limit: 1 });
      assert.deepEqual(
        firstPage.messages.map((item) => item.id),
        ["m2"],
      );
      assert.equal(firstPage.hasMore, true);
      assert.deepEqual(
        store
          .listPage("session-1", { limit: 1, before: firstPage.nextCursor })
          .messages.map((item) => item.id),
        ["m1"],
      );

      store.replace("session-1", [
        createMessage("m3", "2026-04-30T10:00:03.000Z"),
        createMessage("m0", "2026-04-30T09:59:59.000Z"),
      ]);
      assert.deepEqual(
        store.list("session-1").map((item) => item.id),
        ["m3", "m0"],
      );
      store.remove("session-1");
      assert.deepEqual(store.list("session-1"), []);
    } finally {
      store.close();
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("sqlite message store preserves insertion order and defaults to twenty-message pages", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-sqlite-message-order-"));
  try {
    const dbPath = join(tempRoot, "sessions.sqlite");
    const store = createSqliteSessionMessageStore(dbPath);
    try {
      store.append("session-1", createMessage("late", "2026-04-30T10:00:02.000Z"));
      store.append("session-1", createMessage("early", "2026-04-30T10:00:01.000Z"));
      assert.deepEqual(
        store.list("session-1").map((item) => item.id),
        ["late", "early"],
      );

      store.replace(
        "session-1",
        Array.from({ length: 25 }, (_, index) => {
          const ordinal = index + 1;
          return createMessage(
            `m${ordinal}`,
            `2026-04-30T10:00:${String(ordinal).padStart(2, "0")}.000Z`,
          );
        }),
      );

      const latest = store.listPage("session-1");
      assert.equal(latest.messages.length, 20);
      assert.deepEqual(latest.messages.map((item) => item.id).slice(0, 3), ["m6", "m7", "m8"]);
      assert.deepEqual(latest.messages.map((item) => item.id).slice(-3), ["m23", "m24", "m25"]);
      assert.equal(latest.hasMore, true);
    } finally {
      store.close();
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("sqlite artifact store normalizes historical MCP tool calls from persisted input", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-sqlite-artifact-tool-kind-"));
  try {
    const dbPath = join(tempRoot, "sessions.sqlite");
    const store = createSqliteSessionArtifactStore(dbPath);
    try {
      store.appendToolCall(
        "session-1",
        createToolCall("call_prbt7TQxsqcB92s2tKhL0PuD", "2026-05-15T10:00:00.000Z", {
          kind: "tool",
          title: "Tool call call_prbt…",
          input: JSON.stringify({
            title: "执行 1+1",
            code: "nodeRepl.write(String(1 + 1));",
            timeout_ms: 10000,
          }),
          status: "completed",
        }),
      );
      store.appendToolCall(
        "session-1",
        createToolCall("call_shortTitle", "2026-05-15T10:00:01.000Z", {
          kind: "mcp",
          title: "js",
          input: JSON.stringify({
            title: "执行 2+2",
            code: "nodeRepl.write(String(2 + 2));",
            timeout_ms: 10000,
          }),
          status: "completed",
        }),
      );

      const [toolCall, shortTitleToolCall] = store.get("session-1").toolCalls;
      assert.equal(toolCall?.kind, "mcp");
      assert.equal(toolCall?.title, "Tool: node_repl/js");
      assert.equal(shortTitleToolCall?.kind, "mcp");
      assert.equal(shortTitleToolCall?.title, "Tool: node_repl/js");
      assert.equal(store.getPage("session-1", { limit: 1 }).toolCalls[0]?.kind, "mcp");
    } finally {
      store.close();
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("sqlite artifact store normalizes request-shaped MCP input from persisted tool calls", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-sqlite-artifact-request-shaped-mcp-"));
  try {
    const dbPath = join(tempRoot, "sessions.sqlite");
    const store = createSqliteSessionArtifactStore(dbPath);
    try {
      store.appendToolCall(
        "session-1",
        createToolCall("call-mcp-request", "2026-04-30T10:00:03.500Z", {
          kind: "tool",
          title: "Tool call toolu_01Mcp…",
          input: JSON.stringify({
            server_name: "mcp_router",
            request: { name: "find_symbol" },
            arguments: { relative_path: "apps/deck/src/features/server-events/session-events.ts" },
          }),
          status: "completed",
        }),
      );

      const [toolCall] = store.get("session-1").toolCalls;
      assert.equal(toolCall?.kind, "mcp");
      assert.equal(toolCall?.title, "Tool: mcp_router/find_symbol");
    } finally {
      store.close();
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("sqlite artifact store preserves strong tool metadata when sparse updates arrive", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-sqlite-artifact-sparse-tool-update-"));
  try {
    const dbPath = join(tempRoot, "sessions.sqlite");
    const store = createSqliteSessionArtifactStore(dbPath);
    try {
      store.appendToolCall(
        "session-1",
        createToolCall("toolu_01Write", "2026-05-17T10:00:00.000Z", {
          kind: "write",
          title: "Write",
          input: JSON.stringify({ file_path: "apps/deck/src/app.tsx" }),
          status: "running",
        }),
      );
      store.appendToolCall(
        "session-1",
        createToolCall("toolu_01Write", "2026-05-17T10:00:01.000Z", {
          kind: "tool",
          title: "Tool call toolu_01W...",
          output: "ok",
          status: "completed",
          updatedAt: "2026-05-17T10:00:01.000Z",
        }),
      );

      const [toolCall] = store.get("session-1").toolCalls;
      assert.equal(toolCall?.kind, "write");
      assert.equal(toolCall?.title, "Write");
      assert.equal(toolCall?.input, JSON.stringify({ file_path: "apps/deck/src/app.tsx" }));
      assert.equal(toolCall?.status, "completed");
      assert.equal(toolCall?.output, "ok");
      assert.equal(toolCall?.timestamp, "2026-05-17T10:00:00.000Z");
      assert.equal(toolCall?.updatedAt, "2026-05-17T10:00:01.000Z");
    } finally {
      store.close();
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("sqlite artifact store lets later search repairs override stale shell classifications", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-sqlite-artifact-search-repair-"));
  try {
    const dbPath = join(tempRoot, "sessions.sqlite");
    const store = createSqliteSessionArtifactStore(dbPath);
    try {
      store.appendToolCall(
        "session-1",
        createToolCall("toolu_search_repair", "2026-07-07T10:00:00.000Z", {
          kind: "shell",
          title: "grep -l \"tool-call-repair\"",
          input: "{\"output_mode\":\"files_with_matches\",\"pattern\":\"tool-call-repair\"}",
          status: "completed",
          updatedAt: "2026-07-07T10:00:00.000Z",
        }),
      );
      store.appendToolCall(
        "session-1",
        createToolCall("toolu_search_repair", "2026-07-07T10:00:00.000Z", {
          kind: "search",
          title: "Grep",
          input: "{\"output_mode\":\"files_with_matches\",\"pattern\":\"tool-call-repair\"}",
          status: "completed",
          updatedAt: "2026-07-07T10:00:01.000Z",
        }),
      );

      const [toolCall] = store.get("session-1").toolCalls;
      assert.equal(toolCall?.kind, "search");
      assert.equal(toolCall?.title, "Grep");
    } finally {
      store.close();
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("sqlite artifact store replaces cumulative thinking output instead of appending duplicates", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-sqlite-artifact-thinking-output-"));
  try {
    const dbPath = join(tempRoot, "sessions.sqlite");
    const store = createSqliteSessionArtifactStore(dbPath);
    try {
      store.appendToolCall(
        "session-1",
        createToolCall("session-1-msg-s0:thinking", "2026-05-23T10:00:00.000Z", {
          commandId: "session-1-msg-s0:thinking",
          kind: "think",
          title: "Thinking",
          output: "分析 A",
          status: "running",
          updatedAt: "2026-05-23T10:00:01.000Z",
        }),
      );
      store.appendToolCall(
        "session-1",
        createToolCall("session-1-msg-s0:thinking", "2026-05-23T10:00:00.000Z", {
          commandId: "session-1-msg-s0:thinking",
          kind: "think",
          title: "Thinking",
          output: "分析 A\n分析 B",
          status: "running",
          updatedAt: "2026-05-23T10:00:02.000Z",
        }),
      );
      store.appendToolCall(
        "session-1",
        createToolCall("session-1-msg-s0:thinking", "2026-05-23T10:00:00.000Z", {
          commandId: "session-1-msg-s0:thinking",
          kind: "think",
          title: "Thinking",
          output: "分析 A",
          status: "running",
          updatedAt: "2026-05-23T10:00:03.000Z",
        }),
      );

      assert.equal(store.get("session-1").toolCalls[0]?.output, "分析 A\n分析 B");
    } finally {
      store.close();
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("sqlite artifact store paginates outputs/tool calls and replaces diffs/tool calls", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-sqlite-artifact-"));
  try {
    const dbPath = join(tempRoot, "sessions.sqlite");
    const store = createSqliteSessionArtifactStore(dbPath);
    try {
      store.appendOutput("session-1", createOutput("out-1", "2026-04-30T10:00:00.000Z"));
      store.appendOutput("session-1", createOutput("out-2", "2026-04-30T10:00:02.000Z"));
      store.appendToolCall(
        "session-1",
        createToolCall("call_abc123", "2026-04-30T10:00:01.000Z", {
          title: "Tool: search",
          output: "a",
        }),
      );
      store.appendToolCall(
        "session-1",
        createToolCall("call_abc123", "2026-04-30T10:00:03.000Z", {
          title: "call_abc123",
          output: "b",
          status: "completed",
          updatedAt: "2026-04-30T10:00:03.000Z",
        }),
      );
      store.replaceDiffs("session-1", [createDiff("src/a.ts")]);

      const artifacts = store.get("session-1");
      assert.equal(artifacts.toolCalls[0]?.title, "Tool: search");
      assert.equal(artifacts.toolCalls[0]?.output, "ab");
      assert.deepEqual(
        artifacts.diffs.map((item) => item.path),
        ["src/a.ts"],
      );

      const page = store.getPage("session-1", { limit: 2 });
      assert.equal(page.hasMore, true);
      assert.deepEqual(
        page.outputs.map((item) => item.id),
        ["out-2"],
      );
      assert.deepEqual(
        page.toolCalls.map((item) => item.id),
        ["call_abc123"],
      );

      store.replaceToolCalls("session-1", [createToolCall("call-2", "2026-04-30T10:00:04.000Z")]);
      assert.deepEqual(
        store.get("session-1").toolCalls.map((item) => item.id),
        ["call-2"],
      );
      store.remove("session-1");
      assert.deepEqual(store.get("session-1"), { outputs: [], diffs: [], toolCalls: [] });
    } finally {
      store.close();
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("sqlite runtime store persists descriptors", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-sqlite-runtime-"));
  try {
    const dbPath = join(tempRoot, "sessions.sqlite");
    const store = createSqliteSessionRuntimeStore(dbPath);
    try {
      const descriptor: StoredSessionRuntimeDescriptor = {
        sessionId: "session-1",
        providerId: "codex",
        runtimeSessionId: "runtime-1",
        lastSeenAt: "2026-04-30T10:00:00.000Z",
        state: "resumeable",
        capabilities: { sessionLoad: true },
      };

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
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("sqlite stores can remove all session-scoped data for cleanup", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-sqlite-cleanup-"));
  try {
    const dbPath = join(tempRoot, "sessions.sqlite");
    const summaryStore = createSqliteSessionStore(dbPath);
    const messageStore = createSqliteSessionMessageStore(dbPath);
    const artifactStore = createSqliteSessionArtifactStore(dbPath);
    const runtimeStore = createSqliteSessionRuntimeStore(dbPath);
    try {
      summaryStore.upsert(createSummary());
      messageStore.append("session-1", createMessage("m1", "2026-04-30T10:00:00.000Z"));
      artifactStore.appendOutput("session-1", createOutput("out-1", "2026-04-30T10:00:01.000Z"));
      artifactStore.replaceDiffs("session-1", [createDiff("src/a.ts")]);
      artifactStore.appendToolCall(
        "session-1",
        createToolCall("call-1", "2026-04-30T10:00:02.000Z"),
      );
      runtimeStore.upsert({
        sessionId: "session-1",
        providerId: "codex",
        lastSeenAt: "2026-04-30T10:00:03.000Z",
        state: "resumeable",
      });

      summaryStore.remove("session-1");
      messageStore.remove("session-1");
      artifactStore.remove("session-1");
      runtimeStore.remove("session-1");

      assert.deepEqual(summaryStore.list(), []);
      assert.deepEqual(messageStore.list("session-1"), []);
      assert.deepEqual(artifactStore.get("session-1"), { outputs: [], diffs: [], toolCalls: [] });
      assert.equal(runtimeStore.get("session-1"), null);
    } finally {
      summaryStore.close();
      messageStore.close();
      artifactStore.close();
      runtimeStore.close();
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("json to sqlite migration is idempotent, backs up json, and ignores malformed files", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-sqlite-migrate-"));
  try {
    const jsonPaths = {
      sessionHistoryPath: join(tempRoot, "sessions.json"),
      sessionMessagesPath: join(tempRoot, "session-messages"),
      sessionArtifactsPath: join(tempRoot, "session-artifacts"),
      sessionRuntimesPath: join(tempRoot, "session-runtimes.json"),
    };
    mkdirSync(jsonPaths.sessionMessagesPath, { recursive: true });
    mkdirSync(jsonPaths.sessionArtifactsPath, { recursive: true });
    writeFileSync(jsonPaths.sessionHistoryPath, JSON.stringify([createSummary()]), "utf8");
    writeFileSync(
      join(jsonPaths.sessionMessagesPath, "session-1.json"),
      JSON.stringify([createMessage("m1", "2026-04-30T10:00:00.000Z")]),
      "utf8",
    );
    writeFileSync(join(jsonPaths.sessionMessagesPath, "bad.json"), "{bad", "utf8");
    writeFileSync(
      join(jsonPaths.sessionArtifactsPath, "session-1.json"),
      JSON.stringify({
        outputs: [createOutput("out-1", "2026-04-30T10:00:01.000Z")],
        diffs: [createDiff("src/a.ts")],
        toolCalls: [],
      }),
      "utf8",
    );
    writeFileSync(
      jsonPaths.sessionRuntimesPath,
      JSON.stringify([
        {
          sessionId: "session-1",
          providerId: "codex",
          lastSeenAt: "2026-04-30T10:00:02.000Z",
          state: "resumeable",
        },
      ]),
      "utf8",
    );

    const sqlitePath = join(tempRoot, "sessions.sqlite");
    migrateJsonSessionDataToSqlite({ sqlitePath, jsonPaths });
    const backupCountAfterFirstMigration = countBackups(tempRoot, "sessions.json.bak-");
    migrateJsonSessionDataToSqlite({ sqlitePath, jsonPaths });

    const summaryStore = createSqliteSessionStore(sqlitePath);
    const messageStore = createSqliteSessionMessageStore(sqlitePath);
    const artifactStore = createSqliteSessionArtifactStore(sqlitePath);
    const runtimeStore = createSqliteSessionRuntimeStore(sqlitePath);
    try {
      assert.equal(summaryStore.list().length, 1);
      assert.equal(messageStore.list("session-1").length, 1);
      assert.equal(artifactStore.get("session-1").outputs.length, 1);
      assert.equal(runtimeStore.list().length, 1);
    } finally {
      summaryStore.close();
      messageStore.close();
      artifactStore.close();
      runtimeStore.close();
    }
    assert.equal(readdirBackupExists(tempRoot, "sessions.json.bak-"), true);
    assert.equal(countBackups(tempRoot, "sessions.json.bak-"), backupCountAfterFirstMigration);
    assert.equal(existsSync(jsonPaths.sessionHistoryPath), true);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

function readdirBackupExists(root: string, prefix: string) {
  return countBackups(root, prefix) > 0;
}

function countBackups(root: string, prefix: string) {
  return readdirSync(root).filter((entry) => entry.startsWith(prefix)).length;
}
