import type {
  ApprovalHistoryPage,
  CanonicalApproval,
  CanonicalApprovalState,
  CanonicalSessionState,
  SessionUpdateRecord,
} from "@tiller/shared";

export type SessionApprovalStore = {
  get(sessionId: string): CanonicalApprovalState | undefined;
  replace(sessionId: string, state: CanonicalApprovalState): CanonicalApprovalState;
  commitUpdate(
    update: SessionUpdateRecord,
    approvalState: CanonicalApprovalState,
    sessionState: CanonicalSessionState,
    historyRecord?: CanonicalApproval,
  ): CanonicalApprovalState;
  listHistory(options?: { limit?: number; before?: string }): ApprovalHistoryPage;
  clearProcessedHistory(): number;
  remove(sessionId: string): void;
  close(): void;
};
