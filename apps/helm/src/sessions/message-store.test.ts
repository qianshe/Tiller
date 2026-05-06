import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentMessage } from "@tiller/shared";

type MessageStore = {
  append: (sessionId: string, message: AgentMessage) => AgentMessage[];
  replace: (sessionId: string, messages: AgentMessage[]) => AgentMessage[];
  list: (sessionId: string) => AgentMessage[];
  listPage: (
    sessionId: string,
    options?: { limit?: number; before?: string },
  ) => { messages: AgentMessage[]; nextCursor?: string; hasMore: boolean };
  remove: (sessionId: string) => void;
};

test("session message store appends messages per session and reloads them from disk", async () => {
  let mod: null | {
    createSessionMessageStore: (rootDir: string) => MessageStore;
  } = null;

  try {
    mod = await import("./message-store.js");
  } catch {
    mod = null;
  }

  assert.ok(mod?.createSessionMessageStore, "createSessionMessageStore export is missing");

  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-message-store-"));

  try {
    const store = mod.createSessionMessageStore(tempRoot);
    const first: AgentMessage = {
      id: "msg-1",
      role: "user",
      text: "please inspect login flow",
      timestamp: "2026-04-26T12:00:00.000Z",
    };
    const second: AgentMessage = {
      id: "msg-2",
      role: "assistant",
      text: "I found two risky branches.",
      timestamp: "2026-04-26T12:00:05.000Z",
    };

    store.append("session-1", first);
    store.append("session-1", second);

    const reloadedStore = mod.createSessionMessageStore(tempRoot);
    const sessionMessages = reloadedStore.list("session-1");
    const unrelatedMessages = reloadedStore.list("session-2");

    assert.equal(sessionMessages.length, 2);
    assert.deepEqual(sessionMessages[0], first);
    assert.deepEqual(sessionMessages[1], second);
    assert.deepEqual(unrelatedMessages, []);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session message store preserves append order instead of sorting by timestamp", async () => {
  const mod = await import("./message-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-message-store-sort-"));

  try {
    const store = mod.createSessionMessageStore(tempRoot);
    store.append("session-1", {
      id: "msg-late",
      role: "assistant",
      text: "late",
      timestamp: "2026-04-27T08:00:02.000Z",
    });
    store.append("session-1", {
      id: "msg-early",
      role: "user",
      text: "early",
      timestamp: "2026-04-27T08:00:01.000Z",
    });

    assert.deepEqual(
      store.list("session-1").map((message) => message.id),
      ["msg-late", "msg-early"],
    );
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session message store merges chunks with the same message id", async () => {
  const mod = await import("./message-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-message-store-merge-"));

  try {
    const store = mod.createSessionMessageStore(tempRoot);
    store.append("session-1", {
      id: "msg-1",
      role: "assistant",
      text: "你好",
      timestamp: "2026-04-27T08:00:00.000Z",
    });
    store.append("session-1", {
      id: "msg-1",
      role: "assistant",
      text: "，主人喵~",
      timestamp: "2026-04-27T08:00:01.000Z",
    });

    assert.deepEqual(store.list("session-1"), [
      {
        id: "msg-1",
        role: "assistant",
        text: "你好，主人喵~",
        timestamp: "2026-04-27T08:00:00.000Z",
      },
    ]);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session message store merges consecutive assistant stream chunks without a shared id", async () => {
  const mod = await import("./message-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-message-store-stream-"));

  try {
    const store = mod.createSessionMessageStore(tempRoot);
    store.append("session-1", {
      id: "session-1-msg-1000",
      role: "assistant",
      text: "执行 pnpm ",
      timestamp: "2026-04-27T08:00:00.000Z",
    });
    store.append("session-1", {
      id: "session-1-msg-1001",
      role: "assistant",
      text: "typecheck 验证喵~",
      timestamp: "2026-04-27T08:00:01.000Z",
    });

    assert.deepEqual(store.list("session-1"), [
      {
        id: "session-1-msg-1000",
        role: "assistant",
        text: "执行 pnpm typecheck 验证喵~",
        timestamp: "2026-04-27T08:00:00.000Z",
      },
    ]);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session message store keeps the latest cumulative assistant stream snapshot", async () => {
  const mod = await import("./message-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-message-store-cumulative-"));

  try {
    const store = mod.createSessionMessageStore(tempRoot);
    store.append("session-1", {
      id: "session-1-msg-1000",
      role: "assistant",
      text: "主人，已完成",
      timestamp: "2026-04-27T08:00:00.000Z",
    });
    store.append("session-1", {
      id: "session-1-msg-1001",
      role: "assistant",
      text: "主人，已完成本轮验证喵~",
      timestamp: "2026-04-27T08:00:01.000Z",
    });

    assert.deepEqual(store.list("session-1"), [
      {
        id: "session-1-msg-1000",
        role: "assistant",
        text: "主人，已完成本轮验证喵~",
        timestamp: "2026-04-27T08:00:00.000Z",
      },
    ]);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session message store collapses repeated assistant snapshots inside one merged payload", async () => {
  const mod = await import("./message-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-message-store-repeated-payload-"));

  try {
    const store = mod.createSessionMessageStore(tempRoot);
    const finalAnswer =
      "主人，已完成本轮最小改动喵~\n\n| 项目 | 内容 |\n|---|---|\n| **产物** | `apps/deck/src/app/App.tsx` |";
    const bridge =
      "我会按 `superpowers` 流程做最小定位与修改，并优先用 MCP 搜索/编辑，确保 typecheck 验证喵~";
    store.append("session-1", {
      id: "session-1-msg-1000",
      role: "assistant",
      text: finalAnswer,
      timestamp: "2026-04-27T08:00:00.000Z",
    });
    store.append("session-1", {
      id: "session-1-msg-1001",
      role: "assistant",
      text: `${finalAnswer}${bridge}${finalAnswer}`,
      timestamp: "2026-04-27T08:00:01.000Z",
    });

    assert.equal(store.list("session-1")[0]?.text, finalAnswer);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session message store collapses repeated replayed assistant text without line breaks", async () => {
  const mod = await import("./message-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-message-store-replayed-text-"));

  try {
    const store = mod.createSessionMessageStore(tempRoot);
    const replayedText =
      "我会使用 `superpowers:systematic-debugging` 来先定位根因，再做最小修复喵~[🌳木] 目标：定位并修复 mission 页左侧项目展开/收起失效的根因；验收是能通过代码/类型检查，并给出可复核的交互点。先读取项目上下文与相关代码喵~";
    const replayHead = replayedText.slice(0, 55);
    const replayTail = replayedText.slice(55);
    store.append("session-1", {
      id: "session-1-msg-1000",
      role: "assistant",
      text: replayHead,
      timestamp: "2026-04-27T08:00:00.000Z",
    });
    store.append("session-1", {
      id: "session-1-msg-1001",
      role: "assistant",
      text: replayTail,
      timestamp: "2026-04-27T08:00:01.000Z",
    });
    store.append("session-1", {
      id: "session-1-msg-1002",
      role: "assistant",
      text: replayHead,
      timestamp: "2026-04-27T08:00:02.000Z",
    });
    store.append("session-1", {
      id: "session-1-msg-1003",
      role: "assistant",
      text: replayTail,
      timestamp: "2026-04-27T08:00:03.000Z",
    });

    assert.equal(store.list("session-1")[0]?.text, replayedText);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session message store refreshes duplicate replay timestamps without duplicating text", async () => {
  const mod = await import("./message-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-message-store-replay-"));

  try {
    const store = mod.createSessionMessageStore(tempRoot);
    store.append("session-1", {
      id: "msg-1",
      role: "user",
      text: "还有谁？",
      timestamp: "2026-04-30T13:17:41.000Z",
    });
    store.append("session-1", {
      id: "msg-1",
      role: "user",
      text: "还有谁？",
      timestamp: "2026-04-30T13:22:46.686Z",
    });

    assert.deepEqual(store.list("session-1"), [
      {
        id: "msg-1",
        role: "user",
        text: "还有谁？",
        timestamp: "2026-04-30T13:22:46.686Z",
      },
    ]);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session message store replaces a session with authoritative history order", async () => {
  const mod = await import("./message-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-message-store-replace-"));

  try {
    const store = mod.createSessionMessageStore(tempRoot);
    store.append("session-1", {
      id: "stale",
      role: "user",
      text: "old",
      timestamp: "2026-04-30T13:22:46.000Z",
    });
    store.replace("session-1", [
      { id: "msg-2", role: "assistant", text: "new", timestamp: "2026-04-30T09:59:11.000Z" },
      { id: "msg-1", role: "user", text: "hello", timestamp: "2026-04-30T09:58:57.000Z" },
    ]);

    assert.deepEqual(
      store.list("session-1").map((message) => message.id),
      ["msg-2", "msg-1"],
    );
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session message store removes only the targeted session history", async () => {
  const mod = await import("./message-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-message-store-delete-"));

  try {
    const store = mod.createSessionMessageStore(tempRoot);
    store.append("session-1", {
      id: "msg-1",
      role: "user",
      text: "keep? no",
      timestamp: "2026-04-27T08:00:00.000Z",
    });
    store.append("session-2", {
      id: "msg-2",
      role: "assistant",
      text: "keep me",
      timestamp: "2026-04-27T08:00:01.000Z",
    });

    store.remove("session-1");

    const reloadedStore = mod.createSessionMessageStore(tempRoot);
    assert.deepEqual(reloadedStore.list("session-1"), []);
    assert.equal(reloadedStore.list("session-2").length, 1);
    assert.equal(reloadedStore.list("session-2")[0]?.id, "msg-2");
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session message store pages latest messages and exposes an older cursor", async () => {
  const mod = await import("./message-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-message-store-page-"));

  try {
    const store = mod.createSessionMessageStore(tempRoot);
    for (let index = 1; index <= 5; index += 1) {
      store.append("session-1", {
        id: `msg-${index}`,
        role: index % 2 ? "user" : "assistant",
        text: `message ${index}`,
        timestamp: `2026-04-27T08:00:0${index}.000Z`,
      });
    }

    const latest = store.listPage("session-1", { limit: 2 });
    assert.deepEqual(
      latest.messages.map((message) => message.id),
      ["msg-4", "msg-5"],
    );
    assert.equal(latest.hasMore, true);
    assert.ok(latest.nextCursor);

    const older = store.listPage("session-1", { limit: 2, before: latest.nextCursor });
    assert.deepEqual(
      older.messages.map((message) => message.id),
      ["msg-2", "msg-3"],
    );
    assert.equal(older.hasMore, true);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session message store defaults to the latest twenty messages", async () => {
  const mod = await import("./message-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-message-store-default-page-"));

  try {
    const store = mod.createSessionMessageStore(tempRoot);
    for (let index = 1; index <= 25; index += 1) {
      store.append("session-1", {
        id: `msg-${index}`,
        role: index % 2 ? "user" : "assistant",
        text: `message ${index}`,
        timestamp: `2026-04-27T08:00:${String(index).padStart(2, "0")}.000Z`,
      });
    }

    const latest = store.listPage("session-1");
    assert.equal(latest.messages.length, 20);
    assert.deepEqual(latest.messages.map((message) => message.id).slice(0, 3), [
      "msg-6",
      "msg-7",
      "msg-8",
    ]);
    assert.deepEqual(latest.messages.map((message) => message.id).slice(-3), [
      "msg-23",
      "msg-24",
      "msg-25",
    ]);
    assert.equal(latest.hasMore, true);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});
