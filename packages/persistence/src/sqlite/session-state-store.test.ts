import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CanonicalSessionState, SessionUpdateRecord } from "@tiller/shared";
import { createSqliteSessionStateStore } from "./session-state-store";
import { createSqliteSessionUpdateStore } from "./session-update-store";

function state(sequence: number): CanonicalSessionState {
  return {
    sequence,
    status: {
      runtimeStatus: "running",
      effectiveStatus: "waiting_for_permission",
      pendingApprovalCount: 1,
    },
    config: {
      agentMode: "architect",
      model: "gpt-5",
      reasoningEffort: "high",
      configOptions: [{ id: "model", currentValue: "gpt-5" }],
      modelOptions: [{ id: "gpt-5", name: "GPT-5" }],
    },
    plan: {
      entries: [{ content: "Persist state", priority: "high", status: "in_progress" }],
      updatedAt: "2026-07-11T12:00:00.000Z",
    },
    availableCommands: [{ name: "review", kind: "command" }],
    usage: { used: 100, size: 200_000 },
    sessionInfo: { title: "Session", updatedAt: "2026-07-11T12:00:00.000Z" },
    diffs: [],
    promptQueue: { sessionId: "session-1", queued: [] },
  };
}

test("sqlite session state store round-trips canonical state and checkpoint sequence", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-session-state-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const store = createSqliteSessionStateStore(dbPath);

  try {
    assert.equal(store.get("session-1"), undefined);
    store.replace("session-1", state(12));
    assert.deepEqual(store.get("session-1"), state(12));
    assert.equal(store.getAppliedSequence("session-1"), 12);

    store.replace("session-1", state(15));
    assert.equal(store.getAppliedSequence("session-1"), 15);
    store.remove("session-1");
    assert.equal(store.get("session-1"), undefined);
  } finally {
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});

test("sqlite state commit rolls back materialized state when update sequence conflicts", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-session-state-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const store = createSqliteSessionStateStore(dbPath);
  const updates = createSqliteSessionUpdateStore(dbPath);
  const update = (sequence: number, payload: string): SessionUpdateRecord => ({
    sessionId: "session-1",
    runtimeSessionId: "runtime-1",
    providerId: "codex",
    sequence,
    source: "acp_live",
    updateType: "status",
    receivedAt: "2026-07-11T15:00:00.000Z",
    payloadJson: payload,
  });

  try {
    store.commitUpdate(update(1, '{"type":"status","status":"running"}'), state(1));

    assert.throws(() => {
      store.commitUpdate(update(1, '{"type":"status","status":"idle"}'), state(2));
    });

    assert.equal(store.getAppliedSequence("session-1"), 1);
    assert.equal(updates.listPage("session-1").updates.length, 1);
    assert.equal(updates.listPage("session-1").updates[0]?.payloadJson, '{"type":"status","status":"running"}');
  } finally {
    updates.close();
    store.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});
