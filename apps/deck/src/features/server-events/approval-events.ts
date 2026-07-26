import type {
  ApprovalHistoryPage,
  CanonicalApproval,
  PermissionDecision,
  PermissionRequest,
  SessionSummary,
} from "@tiller/shared";
import { useDeckStore } from "../../store";

export type ApprovalCreatedPayload = {
  sessionId: string;
  request: PermissionRequest;
  approval?: CanonicalApproval;
  session?: SessionSummary | null;
};

export type ApprovalResolvedPayload = {
  sessionId: string;
  approvalRequestId: string;
  decision: PermissionDecision;
  approval?: CanonicalApproval;
};

export function applyApprovalCreated(payload: ApprovalCreatedPayload): boolean {
  useDeckStore.getState().upsertApproval({
    sessionId: payload.sessionId,
    request: payload.request,
    createdAt: payload.approval?.createdAt ?? payload.approval?.updatedAt,
  });
  if (payload.approval) {
    useDeckStore.getState().upsertApprovalHistory(payload.approval);
  }
  return true;
}

export function applyApprovalResolved(payload: ApprovalResolvedPayload): boolean {
  useDeckStore.getState().resolveApproval(payload.approvalRequestId);
  if (payload.approval) {
    useDeckStore.getState().upsertApprovalHistory(payload.approval);
  }
  return true;
}

export function applyApprovalListResult(payload: {
  approvals?: Array<{
    sessionId: string;
    request: PermissionRequest;
    status?: Extract<CanonicalApproval["status"], "pending" | "resolving">;
    createdAt?: string;
  }>;
}): boolean {
  useDeckStore.getState().replacePendingApprovals(payload.approvals ?? []);
  return true;
}

export function applyApprovalHistoryListResult(payload: ApprovalHistoryPage): boolean {
  useDeckStore.getState().replaceApprovalHistory(payload);
  return true;
}
