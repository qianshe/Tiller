import type { PermissionDecision, PermissionRequest, SessionSummary } from "@tiller/shared";
import { useDeckStore } from "../../store";

export type ApprovalCreatedPayload = {
  sessionId: string;
  request: PermissionRequest;
  session?: SessionSummary | null;
};

export type ApprovalResolvedPayload = {
  sessionId: string;
  approvalRequestId: string;
  decision: PermissionDecision;
};

export function applyApprovalCreated(payload: ApprovalCreatedPayload): boolean {
  useDeckStore.getState().upsertApproval({
    sessionId: payload.sessionId,
    request: payload.request,
  });
  return true;
}

export function applyApprovalResolved(payload: ApprovalResolvedPayload): boolean {
  useDeckStore.getState().resolveApproval(payload.approvalRequestId);
  return true;
}

export function applyApprovalListResult(payload: {
  approvals?: Array<{ sessionId: string; request: PermissionRequest }>;
}): boolean {
  useDeckStore.getState().replacePendingApprovals(payload.approvals ?? []);
  return true;
}
