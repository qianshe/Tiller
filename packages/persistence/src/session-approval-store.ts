import type {
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
  ): CanonicalApprovalState;
  remove(sessionId: string): void;
  close(): void;
};
