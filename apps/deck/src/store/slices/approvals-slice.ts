import type { StateCreator } from "zustand";
import type { PermissionRequest } from "@tiller/shared";

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
  replacePendingApprovals: (
    items: Array<{ sessionId: string; request: PermissionRequest; createdAt?: string }>,
  ) => void;
  upsertApproval: (item: {
    sessionId: string;
    request: PermissionRequest;
    createdAt?: string;
  }) => void;
  markApprovalResolving: (approvalRequestId: string, resolving: boolean) => void;
  resolveApproval: (approvalRequestId: string) => void;
  dropSessionApprovals: (sessionId: string) => void;
};

function removeFromList(list: string[] | undefined, id: string): string[] {
  if (!list) {
    return [];
  }
  const next = list.filter((item) => item !== id);
  return next.length === list.length ? list : next;
}

export const createApprovalsSlice: StateCreator<ApprovalsSlice> = (set) => ({
  approvalItemsById: {},
  pendingApprovalIds: [],
  pendingApprovalIdsBySession: {},
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
          resolving: false,
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
  dropSessionApprovals: (sessionId) =>
    set((state) => {
      const ids = state.pendingApprovalIdsBySession[sessionId];
      if (!ids || ids.length === 0) {
        return state;
      }
      const idSet = new Set(ids);
      const nextItems = { ...state.approvalItemsById };
      for (const id of ids) {
        delete nextItems[id];
      }
      const nextBySession = { ...state.pendingApprovalIdsBySession };
      delete nextBySession[sessionId];
      return {
        approvalItemsById: nextItems,
        pendingApprovalIds: state.pendingApprovalIds.filter((id) => !idSet.has(id)),
        pendingApprovalIdsBySession: nextBySession,
      };
    }),
});
