import type { SessionSummary } from "@tiller/shared";
import { createSessionUpdateRecord } from "../../session-updates/reducer";
import {
  applyCanonicalSessionStateEvent,
  createCanonicalSessionState,
} from "./state-reducer";
import type { SessionApprovalStateStore } from "./approval-store";
import type { SessionLiveStateStore } from "../../session-timeline/live-state-store";

type ApprovalRecoveryOptions = {
  sessions: readonly SessionSummary[];
  approvals: SessionApprovalStateStore;
  liveStates: SessionLiveStateStore;
  now?: () => string;
};

export function expirePersistedApprovalsOnStartup(options: ApprovalRecoveryOptions) {
  const expiredApprovalIds: string[] = [];
  for (const summary of options.sessions) {
    const activeApprovals = Object.values(options.approvals.get(summary.id).active)
      .sort((left, right) => left.sequence - right.sequence);
    for (const approval of activeApprovals) {
      const updatedAt = options.now?.() ?? new Date().toISOString();
      const currentSessionState = options.liveStates.get(summary.id) ??
        createCanonicalSessionState();
      const sequence = Math.max(
        currentSessionState.sequence,
        options.approvals.get(summary.id).sequence,
      ) + 1;
      const event = {
        type: "approval-status" as const,
        approvalId: approval.id,
        status: "expired" as const,
        updatedAt,
      };
      const nextPendingCount = Math.max(
        0,
        Object.keys(options.approvals.get(summary.id).active).length - 1,
      );
      const nextSessionState = applyCanonicalSessionStateEvent(
        currentSessionState,
        { type: "pending-approval-count", count: nextPendingCount },
        sequence,
      );
      const update = createSessionUpdateRecord({
        sessionId: summary.id,
        runtimeSessionId: summary.runtimeSessionId ?? approval.runtimeInstanceId,
        providerId: summary.agentId,
        sequence,
        source: "local_history_repair",
        event,
      });
      options.approvals.commit(
        summary.id,
        { type: "expired", approvalId: approval.id, updatedAt },
        sequence,
        update,
        nextSessionState,
      );
      options.liveStates.adoptCommitted(summary.id, nextSessionState);
      expiredApprovalIds.push(approval.id);
    }
  }
  return expiredApprovalIds;
}
