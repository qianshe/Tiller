import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { StoredSessionRuntimeDescriptor } from "./runtime-store";

test("session runtime store persists reconnect descriptors", async () => {
  let mod: null | {
    createSessionRuntimeStore: (filePath: string) => {
      list: () => StoredSessionRuntimeDescriptor[];
      get: (sessionId: string) => StoredSessionRuntimeDescriptor | null;
      upsert: (descriptor: StoredSessionRuntimeDescriptor) => StoredSessionRuntimeDescriptor;
      remove: (sessionId: string) => void;
    };
  } = null;

  try {
    mod = await import("./runtime-store.js");
  } catch {
    mod = null;
  }

  assert.ok(mod?.createSessionRuntimeStore, "createSessionRuntimeStore export is missing");

  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-runtime-store-"));

  try {
    const filePath = join(tempRoot, "session-runtimes.json");
    const store = mod.createSessionRuntimeStore(filePath);
    store.upsert({
      sessionId: "session-1",
      providerId: "agent-opencode",
      runtimeSessionId: "runtime-1",
      capabilities: { sessionLoad: true, sessionResume: true },
      providerHistory: {
        latestMessageId: "provider-message-1",
        latestMessageHash: "abc123",
        latestMessageTimestamp: "2026-04-26T12:29:00.000Z",
        messageCount: 3,
        syncedAt: "2026-04-26T12:30:00.000Z",
      },
      lastSeenAt: "2026-04-26T12:30:00.000Z",
      state: "resumeable",
    });

    const reloadedStore = mod.createSessionRuntimeStore(filePath);
    const descriptor = reloadedStore.get("session-1");

    assert.ok(descriptor);
    assert.equal(descriptor?.runtimeSessionId, "runtime-1");
    assert.equal(descriptor?.capabilities?.sessionLoad, true);
    assert.equal(descriptor?.capabilities?.sessionResume, true);
    assert.deepEqual(descriptor?.providerHistory, {
      latestMessageId: "provider-message-1",
      latestMessageHash: "abc123",
      latestMessageTimestamp: "2026-04-26T12:29:00.000Z",
      messageCount: 3,
      syncedAt: "2026-04-26T12:30:00.000Z",
    });
    assert.equal(reloadedStore.list().length, 1);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});

test("session runtime store removes only the targeted descriptor", async () => {
  const mod = await import("./runtime-store.js");
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-runtime-store-delete-"));

  try {
    const filePath = join(tempRoot, "session-runtimes.json");
    const store = mod.createSessionRuntimeStore(filePath);
    store.upsert({
      sessionId: "session-1",
      providerId: "opencode",
      runtimeSessionId: "runtime-1",
      lastSeenAt: "2026-04-27T08:10:00.000Z",
      state: "resumeable",
    });
    store.upsert({
      sessionId: "session-2",
      providerId: "codex",
      runtimeSessionId: "runtime-2",
      lastSeenAt: "2026-04-27T08:10:01.000Z",
      state: "resumeable",
    });

    store.remove("session-1");

    const reloadedStore = mod.createSessionRuntimeStore(filePath);
    assert.equal(reloadedStore.get("session-1"), null);
    assert.equal(reloadedStore.get("session-2")?.runtimeSessionId, "runtime-2");
    assert.equal(reloadedStore.list().length, 1);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});
