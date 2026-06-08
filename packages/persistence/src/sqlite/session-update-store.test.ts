import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { SessionUpdateRecord } from "@tiller/shared";
import { createSqliteSessionUpdateStore } from "./session-update-store";

function update(sequence: number, updateType: string, source: SessionUpdateRecord["source"] = "acp_load_replay"): SessionUpdateRecord {
  return {
    sessionId: "session-1",
    runtimeSessionId: "runtime-1",
    providerId: "codex",
    sequence,
    source,
    updateType,
    receivedAt: `2026-06-08T00:00:0${sequence}.000Z`,
    payloadJson: JSON.stringify({ sessionUpdate: updateType, sequence }),
  };
}

test("sqlite session update store pages newest updates in display order", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-session-update-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const store = createSqliteSessionUpdateStore(dbPath);

  try {
    store.replaceSession("session-1", [
      update(1, "user_message_chunk", "acp_live"),
      update(2, "agent_message_chunk"),
      update(3, "tool_call"),
      update(4, "tool_call_update"),
    ]);

    const latest = store.listPage("session-1", { limit: 2 });

    assert.deepEqual(latest.updates.map((item) => item.sequence), [3, 4]);
    assert.deepEqual(latest.updates.map((item) => item.updateType), ["tool_call", "tool_call_update"]);
    assert.equal(latest.updates[0]?.source, "acp_load_replay");
    assert.equal(latest.hasMore, true);
    assert.ok(latest.nextCursor);

    const older = store.listPage("session-1", { limit: 2, before: latest.nextCursor });
    assert.deepEqual(older.updates.map((item) => item.sequence), [1, 2]);
    assert.equal(older.hasMore, false);
    assert.equal(older.nextCursor, undefined);
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("sqlite session update store replaces and removes one session", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-session-update-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const store = createSqliteSessionUpdateStore(dbPath);

  try {
    store.replaceSession("session-1", [update(1, "user_message_chunk")]);
    store.append({
      ...update(1, "agent_message_chunk"),
      sessionId: "session-2",
      runtimeSessionId: "runtime-2",
    });

    store.replaceSession("session-1", [update(5, "agent_message_chunk", "acp_load_replay")]);
    assert.deepEqual(store.listPage("session-1").updates.map((item) => item.sequence), [5]);
    assert.equal(store.listPage("session-1").updates[0]?.source, "acp_load_replay");

    store.remove("session-1");
    assert.deepEqual(store.listPage("session-1").updates, []);
    assert.deepEqual(store.listPage("session-2").updates.map((item) => item.sessionId), ["session-2"]);
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});
