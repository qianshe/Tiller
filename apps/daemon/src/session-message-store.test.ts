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
    };
  } = null;

  try {
    mod = await import("./session-message-store.js");
  } catch {
    mod = null;
  }

  assert.ok(mod?.createSessionMessageStore, "createSessionMessageStore export is missing");

  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-session-message-store-"));

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
