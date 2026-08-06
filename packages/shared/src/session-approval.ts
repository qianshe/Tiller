import type {
  PermissionDecision,
  PermissionRequest,
} from "./types";

export type ApprovalStatus = "pending" | "resolving" | "resolved" | "expired";

export type CanonicalApproval = {
  id: string;
  sessionId: string;
  runtimeInstanceId: string;
  toolCallId?: string;
  sequence: number;
  status: ApprovalStatus;
  request: PermissionRequest;
  decision?: PermissionDecision;
  createdAt?: string;
  updatedAt: string;
};

export type CanonicalApprovalState = {
  sequence: number;
  active: Record<string, CanonicalApproval>;
};

export type ApprovalHistoryPage = {
  approvals: CanonicalApproval[];
  nextCursor?: string;
  hasMore: boolean;
};
