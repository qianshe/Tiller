import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentMessage } from "@tiller/shared";

test("session message store appends messages per session and reloads them from disk", async () => {
  let mod: null | {
    createSessionMessageStore: (rootDir: string) => {
      append: (sessionId: string, message: AgentMessage) => AgentMessage[];
      list: (sessionId: string) => AgentMessage[];
      remove: (sessionId: string) => void;
    };
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

test("session message store returns messages sorted by timestamp", async () => {
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

    assert.deepEqual(store.list("session-1").map((message) => message.id), ["msg-early", "msg-late"]);
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

    assert.deepEqual(store.list("session-1"), [{
      id: "msg-1",
      role: "assistant",
      text: "你好，主人喵~",
      timestamp: "2026-04-27T08:00:00.000Z",
    }]);
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
