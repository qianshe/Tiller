import type {
  ApprovalStatus,
  CanonicalApproval,
  CanonicalApprovalState,
  PermissionDecision,
} from "@tiller/shared";

export type CanonicalApprovalEvent =
  | { type: "requested"; approval: CanonicalApproval }
  | {
      type: "status-changed";
      approvalId: string;
      status: Extract<ApprovalStatus, "pending" | "resolving">;
      updatedAt: string;
    }
  | {
      type: "resolved";
      approvalId: string;
      decision: PermissionDecision;
      updatedAt: string;
    }
  | {
      type: "expired";
      approvalId: string;
      updatedAt: string;
    };

export function createApprovalState(): CanonicalApprovalState {
  return { sequence: 0, active: {} };
}

export function applyApprovalEvent(
  state: CanonicalApprovalState,
  event: CanonicalApprovalEvent,
  sequence: number,
): CanonicalApprovalState {
  switch (event.type) {
    case "requested":
      return {
        sequence,
        active: {
          ...state.active,
          [event.approval.id]: event.approval,
        },
      };
    case "status-changed": {
      const current = state.active[event.approvalId];
      if (!current) {
        return { ...state, sequence };
      }
      return {
        sequence,
        active: {
          ...state.active,
          [event.approvalId]: {
            ...current,
            status: event.status,
            updatedAt: event.updatedAt,
          },
        },
      };
    }
    case "resolved":
    case "expired": {
      const active = { ...state.active };
      delete active[event.approvalId];
      return { sequence, active };
    }
  }
}

export function expireActiveApprovals(
  state: CanonicalApprovalState,
  sequence: number,
  updatedAt: string,
) {
  const expired = Object.values(state.active).map((approval): CanonicalApproval => ({
    ...approval,
    status: "expired",
    updatedAt,
  }));
  return {
    state: { sequence, active: {} } satisfies CanonicalApprovalState,
    expired,
  };
}
