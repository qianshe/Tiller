import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalApprovalState, CanonicalSessionState } from "@tiller/shared";
import { createSessionLiveStateStore } from "../../session-timeline/live-state-store";
import { applyApprovalEvent, createApprovalState } from "./approval-reducer";
import { expirePersistedApprovalsOnStartup } from "./approval-recovery";

test("startup recovery expires persisted approvals in original request order", () => {
  let approvalState = createApprovalState();
  for (const [id, sequence] of [["approval-2", 2], ["approval-1", 1]] as const) {
    approvalState = applyApprovalEvent(approvalState, {
      type: "requested",
      approval: {
        id,
        sessionId: "session-1",
        runtimeInstanceId: "runtime-old",
        sequence,
        status: "pending",
        request: { id, command: "git status", reason: "inspect", cwd: "D:/repo" },
        updatedAt: "2026-07-11T17:00:00.000Z",
      },
    }, sequence);
  }
  const commits: Array<{ id: string; sequence: number; pending: number }> = [];
  const liveStates = createSessionLiveStateStore();
  liveStates.apply("session-1", { type: "pending-approval-count", count: 2 }, 2);
  const approvals = {
    get: () => approvalState,
    commit: (
      _sessionId: string,
      event: { type: "expired"; approvalId: string; updatedAt: string },
      sequence: number,
      _update: unknown,
      sessionState: CanonicalSessionState,
    ) => {
      approvalState = applyApprovalEvent(approvalState, event, sequence);
      commits.push({
        id: event.approvalId,
        sequence,
        pending: sessionState.status.pendingApprovalCount,
      });
      return approvalState;
    },
    remove: () => undefined,
  };

  const expired = expirePersistedApprovalsOnStartup({
    sessions: [{ id: "session-1", agentId: "codex" } as any],
    approvals: approvals as any,
    liveStates,
    now: () => "2026-07-11T17:05:00.000Z",
  });

  assert.deepEqual(expired, ["approval-1", "approval-2"]);
  assert.deepEqual(commits, [
    { id: "approval-1", sequence: 3, pending: 1 },
    { id: "approval-2", sequence: 4, pending: 0 },
  ]);
  assert.deepEqual((approvalState as CanonicalApprovalState).active, {});
  assert.equal(liveStates.get("session-1")?.status.pendingApprovalCount, 0);
});
