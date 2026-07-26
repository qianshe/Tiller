import type { StateCreator } from "zustand";
import type {
  ApprovalHistoryPage,
  CanonicalApproval,
  PermissionRequest,
} from "@tiller/shared";

export type ApprovalStoreItem = {
  sessionId: string;
  request: PermissionRequest;
  createdAt: string;
  resolving: boolean;
};

export type ApprovalsSlice = {
  approvalItemsById: Record<string, ApprovalStoreItem>;
  pendingApprovalIds: string[];
  pendingApprovalIdsBySession: Record<string, string[]>;
  approvalHistory: CanonicalApproval[];
  approvalHistoryNextCursor?: string;
  approvalHistoryHasMore: boolean;
  replacePendingApprovals: (
    items: Array<{
      sessionId: string;
      request: PermissionRequest;
      status?: Extract<CanonicalApproval["status"], "pending" | "resolving">;
      createdAt?: string;
    }>,
  ) => void;
  upsertApproval: (item: {
    sessionId: string;
    request: PermissionRequest;
    createdAt?: string;
  }) => void;
  markApprovalResolving: (approvalRequestId: string, resolving: boolean) => void;
  resolveApproval: (approvalRequestId: string) => void;
  replaceApprovalHistory: (page: ApprovalHistoryPage) => void;
  upsertApprovalHistory: (approval: CanonicalApproval) => void;
  clearProcessedApprovalHistory: () => void;
  dropSessionApprovals: (sessionId: string) => void;
};

function removeFromList(list: string[] | undefined, id: string): string[] {
  if (!list) {
    return [];
  }
  const next = list.filter((item) => item !== id);
  return next.length === list.length ? list : next;
}

function approvalHistoryKey(approval: CanonicalApproval): string {
  return JSON.stringify([
    approval.sessionId,
    approval.runtimeInstanceId,
    approval.id,
  ]);
}

function sortApprovalHistory(approvals: CanonicalApproval[]): CanonicalApproval[] {
  return approvals.sort((left, right) => {
    const timestampDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    return timestampDelta || approvalHistoryKey(right).localeCompare(approvalHistoryKey(left));
  });
}

export const createApprovalsSlice: StateCreator<ApprovalsSlice> = (set) => ({
  approvalItemsById: {},
  pendingApprovalIds: [],
  pendingApprovalIdsBySession: {},
  approvalHistory: [],
  approvalHistoryNextCursor: undefined,
  approvalHistoryHasMore: false,
  replacePendingApprovals: (items) =>
    set(() => {
      const approvalItemsById: Record<string, ApprovalStoreItem> = {};
      const pendingApprovalIds: string[] = [];
      const pendingApprovalIdsBySession: Record<string, string[]> = {};
      for (const item of items) {
        const id = item.request.id;
        approvalItemsById[id] = {
          sessionId: item.sessionId,
          request: item.request,
          createdAt: item.createdAt ?? new Date().toISOString(),
          resolving: item.status === "resolving",
        };
        pendingApprovalIds.push(id);
        const bucket = pendingApprovalIdsBySession[item.sessionId] ?? [];
        bucket.push(id);
        pendingApprovalIdsBySession[item.sessionId] = bucket;
      }
      return {
        approvalItemsById,
        pendingApprovalIds,
        pendingApprovalIdsBySession,
      };
    }),
  upsertApproval: (item) =>
    set((state) => {
      const id = item.request.id;
      if (state.approvalItemsById[id]) {
        return state;
      }
      const next: ApprovalStoreItem = {
        sessionId: item.sessionId,
        request: item.request,
        createdAt: item.createdAt ?? new Date().toISOString(),
        resolving: false,
      };
      const sessionBucket = state.pendingApprovalIdsBySession[item.sessionId] ?? [];
      return {
        approvalItemsById: { ...state.approvalItemsById, [id]: next },
        pendingApprovalIds: [...state.pendingApprovalIds, id],
        pendingApprovalIdsBySession: {
          ...state.pendingApprovalIdsBySession,
          [item.sessionId]: [...sessionBucket, id],
        },
      };
    }),
  markApprovalResolving: (approvalRequestId, resolving) =>
    set((state) => {
      const current = state.approvalItemsById[approvalRequestId];
      if (!current || current.resolving === resolving) {
        return state;
      }
      return {
        approvalItemsById: {
          ...state.approvalItemsById,
          [approvalRequestId]: { ...current, resolving },
        },
      };
    }),
  resolveApproval: (approvalRequestId) =>
    set((state) => {
      const item = state.approvalItemsById[approvalRequestId];
      if (!item) {
        return state;
      }
      const { [approvalRequestId]: _removed, ...rest } = state.approvalItemsById;
      const nextBySession = { ...state.pendingApprovalIdsBySession };
      const filtered = removeFromList(nextBySession[item.sessionId], approvalRequestId);
      if (filtered.length === 0) {
        delete nextBySession[item.sessionId];
      } else {
        nextBySession[item.sessionId] = filtered;
      }
      return {
        approvalItemsById: rest,
        pendingApprovalIds: removeFromList(state.pendingApprovalIds, approvalRequestId),
        pendingApprovalIdsBySession: nextBySession,
      };
    }),
  replaceApprovalHistory: (page) =>
    set({
      approvalHistory: page.approvals,
      approvalHistoryNextCursor: page.nextCursor,
      approvalHistoryHasMore: page.hasMore,
    }),
  upsertApprovalHistory: (approval) =>
    set((state) => {
      const key = approvalHistoryKey(approval);
      const remaining = state.approvalHistory.filter(
        (item) => approvalHistoryKey(item) !== key,
      );
      return {
        approvalHistory: sortApprovalHistory([approval, ...remaining]),
      };
    }),
  clearProcessedApprovalHistory: () =>
    set((state) => ({
      approvalHistory: state.approvalHistory.filter(
        (approval) => approval.status === "pending" || approval.status === "resolving",
      ),
      approvalHistoryNextCursor: undefined,
      approvalHistoryHasMore: false,
    })),
  dropSessionApprovals: (sessionId) =>
    set((state) => {
      const ids = state.pendingApprovalIdsBySession[sessionId];
      const nextHistory = state.approvalHistory.filter(
        (approval) => approval.sessionId !== sessionId,
      );
      if ((!ids || ids.length === 0) && nextHistory.length === state.approvalHistory.length) {
        return state;
      }
      const idSet = new Set(ids ?? []);
      const nextItems = { ...state.approvalItemsById };
      for (const id of ids ?? []) {
        delete nextItems[id];
      }
      const nextBySession = { ...state.pendingApprovalIdsBySession };
      delete nextBySession[sessionId];
      return {
        approvalItemsById: nextItems,
        pendingApprovalIds: state.pendingApprovalIds.filter((id) => !idSet.has(id)),
        pendingApprovalIdsBySession: nextBySession,
        approvalHistory: nextHistory,
      };
    }),
});
