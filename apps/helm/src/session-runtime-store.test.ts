import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { StoredSessionRuntimeDescriptor } from "./session-runtime-store";

test("session runtime store persists reconnect descriptors", async () => {
  let mod: null | {
    createSessionRuntimeStore: (filePath: string) => {
      list: () => StoredSessionRuntimeDescriptor[];
      get: (sessionId: string) => StoredSessionRuntimeDescriptor | null;
      upsert: (descriptor: StoredSessionRuntimeDescriptor) => StoredSessionRuntimeDescriptor;
    };
  } = null;

  try {
    mod = await import("./session-runtime-store.js");
  } catch {
    mod = null;
  }

  assert.ok(mod?.createSessionRuntimeStore, "createSessionRuntimeStore export is missing");

  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-session-runtime-store-"));

  try {
    const filePath = join(tempRoot, "session-runtimes.json");
    const store = mod.createSessionRuntimeStore(filePath);
    store.upsert({
      sessionId: "session-1",
      providerId: "agent-opencode",
      runtimeSessionId: "runtime-1",
      capabilities: { sessionLoad: true, sessionResume: true },
      lastSeenAt: "2026-04-26T12:30:00.000Z",
      state: "resumeable",
    });

    const reloadedStore = mod.createSessionRuntimeStore(filePath);
    const descriptor = reloadedStore.get("session-1");

    assert.ok(descriptor);
    assert.equal(descriptor?.runtimeSessionId, "runtime-1");
    assert.equal(descriptor?.capabilities?.sessionLoad, true);
    assert.equal(descriptor?.capabilities?.sessionResume, true);
    assert.equal(reloadedStore.list().length, 1);
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
});
