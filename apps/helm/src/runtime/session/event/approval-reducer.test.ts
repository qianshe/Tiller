import assert from "node:assert/strict";
import test from "node:test";
import {
  applyApprovalEvent,
  createApprovalState,
  expireActiveApprovals,
} from "./approval-reducer";

test("approval reducer keeps stable request and tool-call linkage through retries", () => {
  let state = createApprovalState();
  state = applyApprovalEvent(state, {
    type: "requested",
    approval: {
      id: "approval-1",
      sessionId: "session-1",
      runtimeInstanceId: "runtime-1",
      toolCallId: "tool-1",
      sequence: 10,
      status: "pending",
      request: {
        id: "approval-1",
        toolCallId: "tool-1",
        command: "git status",
        reason: "inspect",
        cwd: "D:/repo",
      },
      updatedAt: "2026-07-11T17:00:00.000Z",
    },
  }, 10);
  state = applyApprovalEvent(state, {
    type: "status-changed",
    approvalId: "approval-1",
    status: "resolving",
    updatedAt: "2026-07-11T17:00:01.000Z",
  }, 11);
  state = applyApprovalEvent(state, {
    type: "status-changed",
    approvalId: "approval-1",
    status: "pending",
    updatedAt: "2026-07-11T17:00:02.000Z",
  }, 12);

  assert.equal(state.sequence, 12);
  assert.equal(state.active["approval-1"]?.status, "pending");
  assert.equal(state.active["approval-1"]?.toolCallId, "tool-1");
  assert.equal(state.active["approval-1"]?.sequence, 10);
});

test("resolved approvals leave actionable materialized state", () => {
  let state = createApprovalState();
  state = applyApprovalEvent(state, {
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
      updatedAt: "2026-07-11T17:00:00.000Z",
    },
  }, 1);
  state = applyApprovalEvent(state, {
    type: "resolved",
    approvalId: "approval-1",
    decision: "allow",
    updatedAt: "2026-07-11T17:00:03.000Z",
  }, 2);

  assert.deepEqual(state.active, {});
  assert.equal(state.sequence, 2);
});

test("restart expiration clears active approvals and returns audit entities", () => {
  const requested = applyApprovalEvent(createApprovalState(), {
    type: "requested",
    approval: {
      id: "approval-1",
      sessionId: "session-1",
      runtimeInstanceId: "runtime-old",
      sequence: 1,
      status: "pending",
      request: {
        id: "approval-1",
        command: "git status",
        reason: "inspect",
        cwd: "D:/repo",
      },
      updatedAt: "2026-07-11T17:00:00.000Z",
    },
  }, 1);

  const result = expireActiveApprovals(
    requested,
    2,
    "2026-07-11T17:05:00.000Z",
  );

  assert.deepEqual(result.state.active, {});
  assert.equal(result.state.sequence, 2);
  assert.equal(result.expired[0]?.status, "expired");
  assert.equal(result.expired[0]?.id, "approval-1");
});

test("expired approval is removed from actionable state", () => {
  const requested = applyApprovalEvent(createApprovalState(), {
    type: "requested",
    approval: {
      id: "approval-1",
      sessionId: "session-1",
      runtimeInstanceId: "runtime-old",
      sequence: 1,
      status: "pending",
      request: {
        id: "approval-1",
        command: "git status",
        reason: "inspect",
        cwd: "D:/repo",
      },
      updatedAt: "2026-07-11T17:00:00.000Z",
    },
  }, 1);

  const expired = applyApprovalEvent(requested, {
    type: "expired",
    approvalId: "approval-1",
    updatedAt: "2026-07-11T17:05:00.000Z",
  }, 2);

  assert.deepEqual(expired.active, {});
  assert.equal(expired.sequence, 2);
});
