import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "zustand/vanilla";
import { createApprovalsSlice, type ApprovalsSlice } from "./approvals-slice.js";

function createSlice() {
  return createStore<ApprovalsSlice>()((...args) => ({
    ...createApprovalsSlice(...args),
  }));
}

const request = {
  id: "approval-1",
  command: "Run",
  reason: "审核",
  cwd: "D:/repo",
} as any;

test("replacePendingApprovals hydrates by-session index and orders by createdAt insertion", () => {
  const store = createSlice();
  store.getState().replacePendingApprovals([
    { sessionId: "s1", request },
    {
      sessionId: "s2",
      request: { ...request, id: "approval-2" },
      status: "resolving",
    },
  ]);

  assert.deepEqual(store.getState().pendingApprovalIds, ["approval-1", "approval-2"]);
  assert.deepEqual(store.getState().pendingApprovalIdsBySession.s1, ["approval-1"]);
  assert.deepEqual(store.getState().pendingApprovalIdsBySession.s2, ["approval-2"]);
  assert.equal(store.getState().approvalItemsById["approval-1"]?.request.id, "approval-1");
  assert.equal(store.getState().approvalItemsById["approval-1"]?.resolving, false);
  assert.equal(store.getState().approvalItemsById["approval-2"]?.resolving, true);
});

test("upsertApproval appends to indexes", () => {
  const store = createSlice();
  store.getState().upsertApproval({ sessionId: "s1", request });

  assert.deepEqual(store.getState().pendingApprovalIds, ["approval-1"]);
  assert.deepEqual(store.getState().pendingApprovalIdsBySession.s1, ["approval-1"]);
});

test("upsertApproval is idempotent on the same request id", () => {
  const store = createSlice();
  store.getState().upsertApproval({ sessionId: "s1", request });
  store.getState().upsertApproval({ sessionId: "s1", request });

  assert.deepEqual(store.getState().pendingApprovalIds, ["approval-1"]);
  assert.deepEqual(store.getState().pendingApprovalIdsBySession.s1, ["approval-1"]);
});

test("markApprovalResolving toggles the resolving flag", () => {
  const store = createSlice();
  store.getState().upsertApproval({ sessionId: "s1", request });

  store.getState().markApprovalResolving("approval-1", true);
  assert.equal(store.getState().approvalItemsById["approval-1"]?.resolving, true);

  store.getState().markApprovalResolving("approval-1", false);
  assert.equal(store.getState().approvalItemsById["approval-1"]?.resolving, false);
});

test("resolveApproval drops the entry from every index", () => {
  const store = createSlice();
  store.getState().upsertApproval({ sessionId: "s1", request });
  store.getState().upsertApproval({
    sessionId: "s1",
    request: { ...request, id: "approval-2" },
  });

  store.getState().resolveApproval("approval-1");
  assert.deepEqual(store.getState().pendingApprovalIds, ["approval-2"]);
  assert.deepEqual(store.getState().pendingApprovalIdsBySession.s1, ["approval-2"]);
  assert.equal(store.getState().approvalItemsById["approval-1"], undefined);
});

test("approval slice indexes 100 pending approvals without losing entries", () => {
  const store = createSlice();
  store.getState().replacePendingApprovals(
    Array.from({ length: 100 }, (_, index) => ({
      sessionId: `s${index % 5}`,
      request: {
        id: `approval-${index}`,
        command: `Run ${index}`,
        reason: "审核",
        cwd: "D:/repo",
      } as any,
    })),
  );

  assert.equal(store.getState().pendingApprovalIds.length, 100);
  assert.equal(Object.keys(store.getState().approvalItemsById).length, 100);
  for (let bucket = 0; bucket < 5; bucket++) {
    assert.equal(store.getState().pendingApprovalIdsBySession[`s${bucket}`]?.length, 20);
  }
});

test("approval slice keeps performance stable when 100 pending approvals are upserted one by one", () => {
  const store = createSlice();
  for (let index = 0; index < 100; index++) {
    store.getState().upsertApproval({
      sessionId: `s${index % 5}`,
      request: {
        id: `approval-${index}`,
        command: `Run ${index}`,
        reason: "审核",
        cwd: "D:/repo",
      } as any,
    });
  }

  assert.equal(store.getState().pendingApprovalIds.length, 100);
  for (let bucket = 0; bucket < 5; bucket++) {
    assert.equal(store.getState().pendingApprovalIdsBySession[`s${bucket}`]?.length, 20);
  }
});

test("dropSessionApprovals removes every entry tied to a session id", () => {
  const store = createSlice();
  store.getState().replacePendingApprovals([
    { sessionId: "s1", request },
    { sessionId: "s1", request: { ...request, id: "approval-2" } },
    { sessionId: "s2", request: { ...request, id: "approval-3" } },
  ]);

  store.getState().dropSessionApprovals("s1");
  assert.deepEqual(store.getState().pendingApprovalIds, ["approval-3"]);
  assert.equal(store.getState().pendingApprovalIdsBySession.s1, undefined);
  assert.deepEqual(store.getState().pendingApprovalIdsBySession.s2, ["approval-3"]);
});

test("approval history keeps resolved records and clear preserves active statuses", () => {
  const store = createSlice();
  const pending = {
    id: "approval-pending",
    sessionId: "s1",
    runtimeInstanceId: "runtime-1",
    sequence: 1,
    status: "pending",
    request: { ...request, id: "approval-pending" },
    createdAt: "2026-07-26T10:00:00.000Z",
    updatedAt: "2026-07-26T10:00:00.000Z",
  } as any;
  const resolved = {
    ...pending,
    id: "approval-resolved",
    status: "resolved",
    decision: "allow",
    request: { ...request, id: "approval-resolved" },
    updatedAt: "2026-07-26T10:01:00.000Z",
  } as any;

  store.getState().replaceApprovalHistory({
    approvals: [resolved, pending],
    hasMore: false,
  });
  assert.deepEqual(
    store.getState().approvalHistory.map((approval) => approval.id),
    ["approval-resolved", "approval-pending"],
  );

  store.getState().clearProcessedApprovalHistory();
  assert.deepEqual(
    store.getState().approvalHistory.map((approval) => approval.id),
    ["approval-pending"],
  );
});

test("approval history upserts the same runtime record across lifecycle changes", () => {
  const store = createSlice();
  const pending = {
    id: "approval-1",
    sessionId: "s1",
    runtimeInstanceId: "runtime-1",
    sequence: 1,
    status: "pending",
    request,
    createdAt: "2026-07-26T10:00:00.000Z",
    updatedAt: "2026-07-26T10:00:00.000Z",
  } as any;

  store.getState().upsertApprovalHistory(pending);
  store.getState().upsertApprovalHistory({
    ...pending,
    status: "resolved",
    decision: "deny",
    updatedAt: "2026-07-26T10:02:00.000Z",
  });

  assert.equal(store.getState().approvalHistory.length, 1);
  assert.equal(store.getState().approvalHistory[0]?.status, "resolved");
  assert.equal(store.getState().approvalHistory[0]?.decision, "deny");
});
