import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  CanonicalApprovalState,
  CanonicalSessionState,
  SessionUpdateRecord,
} from "@tiller/shared";
import { createSqliteSessionApprovalStore } from "./session-approval-store";
import { createSqliteSessionStateStore } from "./session-state-store";
import { createSqliteSessionUpdateStore } from "./session-update-store";

function approvalState(sequence: number): CanonicalApprovalState {
  return {
    sequence,
    active: {
      "approval-1": {
        id: "approval-1",
        sessionId: "session-1",
        runtimeInstanceId: "runtime-1",
        toolCallId: "tool-1",
        sequence,
        status: "pending",
        request: {
          id: "approval-1",
          toolCallId: "tool-1",
          command: "git status",
          reason: "inspect",
          cwd: "D:/repo",
        },
        updatedAt: "2026-07-11T17:30:00.000Z",
      },
    },
  };
}

function sessionState(sequence: number, pendingApprovalCount: number): CanonicalSessionState {
  return {
    sequence,
    status: {
      runtimeStatus: "running",
      effectiveStatus: pendingApprovalCount ? "waiting_for_permission" : "running",
      pendingApprovalCount,
    },
    config: { configOptions: [], modelOptions: [] },
    availableCommands: [],
    sessionInfo: {},
    diffs: [],
  };
}

function update(sequence: number): SessionUpdateRecord {
  return {
    sessionId: "session-1",
    runtimeSessionId: "runtime-1",
    providerId: "codex",
    sequence,
    source: "acp_live",
    updateType: "permission-request",
    receivedAt: "2026-07-11T17:30:00.000Z",
    payloadJson: '{"type":"permission-request"}',
  };
}

test("sqlite approval commit atomically writes update, approvals, and session state", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "tiller-approval-store-"));
  const dbPath = join(tempDir, "sessions.sqlite");
  const approvals = createSqliteSessionApprovalStore(dbPath);
  const states = createSqliteSessionStateStore(dbPath);
  const updates = createSqliteSessionUpdateStore(dbPath);

  try {
    approvals.commitUpdate(update(1), approvalState(1), sessionState(1, 1));

    assert.deepEqual(approvals.get("session-1"), approvalState(1));
    assert.equal(states.get("session-1")?.status.pendingApprovalCount, 1);
    assert.equal(updates.listPage("session-1").updates.length, 1);

    assert.throws(() => {
      approvals.commitUpdate(update(1), { sequence: 2, active: {} }, sessionState(2, 0));
    });

    assert.equal(approvals.get("session-1")?.sequence, 1);
    assert.equal(states.get("session-1")?.status.pendingApprovalCount, 1);
    assert.equal(updates.listPage("session-1").updates.length, 1);
  } finally {
    updates.close();
    states.close();
    approvals.close();
    rmSync(tempDir, { force: true, recursive: true });
  }
});
