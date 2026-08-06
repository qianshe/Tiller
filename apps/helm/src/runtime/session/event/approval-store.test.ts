import assert from "node:assert/strict";
import test from "node:test";
import type {
  CanonicalApproval,
  CanonicalApprovalState,
  CanonicalSessionState,
  SessionUpdateRecord,
} from "@tiller/shared";
import type { SessionApprovalStore } from "@tiller/persistence";
import { createSessionApprovalStateStore } from "./approval-store";

function sessionState(sequence: number): CanonicalSessionState {
  return {
    sequence,
    status: {
      runtimeStatus: "running",
      effectiveStatus: "waiting_for_permission",
      pendingApprovalCount: 1,
    },
    config: { configOptions: [], modelOptions: [] },
    availableCommands: [],
    sessionInfo: {},
    diffs: [],
  };
}

test("approval state store exposes state only after atomic persistence succeeds", () => {
  let persisted: CanonicalApprovalState | undefined;
  let persistedHistory: CanonicalApproval | undefined;
  const commits: number[] = [];
  const persistence: SessionApprovalStore = {
    get: () => persisted,
    replace: (_sessionId, state) => {
      persisted = state;
      return state;
    },
    commitUpdate: (update, state, _sessionState, historyRecord) => {
      commits.push(update.sequence);
      persisted = state;
      persistedHistory = historyRecord;
      return state;
    },
    listHistory: () => ({ approvals: [], hasMore: false }),
    clearProcessedHistory: () => 0,
    remove: () => undefined,
    close: () => undefined,
  };
  const store = createSessionApprovalStateStore(persistence);
  const update: SessionUpdateRecord = {
    sessionId: "session-1",
    runtimeSessionId: "runtime-1",
    providerId: "codex",
    sequence: 1,
    source: "acp_live",
    updateType: "permission-request",
    receivedAt: "2026-07-11T18:00:00.000Z",
    payloadJson: '{"type":"permission-request"}',
  };

  const next = store.commit("session-1", {
    type: "requested",
    approval: {
      id: "approval-1",
      sessionId: "session-1",
      runtimeInstanceId: "runtime-1",
      sequence: 1,
      status: "pending",
      request: {
        id: "approval-1",
        command: "git status",
        reason: "inspect",
        cwd: "D:/repo",
      },
      updatedAt: "2026-07-11T18:00:00.000Z",
    },
  }, 1, update, sessionState(1));

  assert.deepEqual(commits, [1]);
  assert.deepEqual(store.get("session-1"), next);
  assert.equal(next.active["approval-1"]?.status, "pending");
  assert.equal(persistedHistory?.id, "approval-1");
  assert.equal(persistedHistory?.createdAt, "2026-07-11T18:00:00.000Z");

  const expired = store.commit(
    "session-1",
    {
      type: "expired",
      approvalId: "approval-1",
      updatedAt: "2026-07-11T18:01:00.000Z",
    },
    2,
    {
      ...update,
      sequence: 2,
      updateType: "approval-status",
      receivedAt: "2026-07-11T18:01:00.000Z",
      payloadJson: '{"type":"approval-status","status":"expired"}',
    },
    sessionState(2),
  );

  assert.deepEqual(commits, [1, 2]);
  assert.deepEqual(expired.active, {});
  assert.equal(persistedHistory?.status, "expired");
  assert.equal(persistedHistory?.createdAt, "2026-07-11T18:00:00.000Z");
});

test("approval state store keeps its previous cache when persistence fails", () => {
  const initial: CanonicalApprovalState = { sequence: 0, active: {} };
  const persistence: SessionApprovalStore = {
    get: () => initial,
    replace: (_sessionId, state) => state,
    commitUpdate: () => {
      throw new Error("commit failed");
    },
    listHistory: () => ({ approvals: [], hasMore: false }),
    clearProcessedHistory: () => 0,
    remove: () => undefined,
    close: () => undefined,
  };
  const store = createSessionApprovalStateStore(persistence);

  assert.throws(() => store.commit(
    "session-1",
    {
      type: "status-changed",
      approvalId: "approval-1",
      status: "resolving",
      updatedAt: "2026-07-11T18:00:01.000Z",
    },
    1,
    {
      sessionId: "session-1",
      runtimeSessionId: "runtime-1",
      providerId: "codex",
      sequence: 1,
      source: "acp_live",
      updateType: "approval-status",
      receivedAt: "2026-07-11T18:00:01.000Z",
      payloadJson: '{"type":"approval-status"}',
    },
    sessionState(1),
  ), /commit failed/u);
  assert.deepEqual(store.get("session-1"), initial);
});
