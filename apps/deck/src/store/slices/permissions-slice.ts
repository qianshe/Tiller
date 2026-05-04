import type { PermissionRequest } from "@tiller/shared";
import type { StateCreator } from "zustand";

type Updater<T> = T | ((current: T) => T);

export type PermissionsSlice = {
  permissionRequests: Record<string, PermissionRequest | null>;
  setPermissionRequests: (
    updater: Updater<Record<string, PermissionRequest | null>>,
  ) => void;
};

export const createPermissionsSlice: StateCreator<PermissionsSlice> = (set) => ({
  permissionRequests: {},
  setPermissionRequests: (updater) =>
    set((state) => ({
      permissionRequests:
        typeof updater === "function" ? updater(state.permissionRequests) : updater,
    })),
});
