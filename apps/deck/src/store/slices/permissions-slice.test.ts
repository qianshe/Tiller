import assert from "node:assert/strict";
import test from "node:test";
import type { PermissionRequest } from "@tiller/shared";
import { createStore } from "zustand/vanilla";
import { createPermissionsSlice, type PermissionsSlice } from "./permissions-slice.js";

function createTestStore() {
  return createStore<PermissionsSlice>()((...args) => ({ ...createPermissionsSlice(...args) }));
}

test("permission requests support value and updater forms", () => {
  const store = createTestStore();
  const request = { id: "p1", sessionId: "s1", action: "run" } as unknown as PermissionRequest;
  store.getState().setPermissionRequests({ s1: request });
  store.getState().setPermissionRequests((current) => ({ ...current, s2: request }));
  assert.equal(store.getState().permissionRequests.s1?.id, "p1");
  assert.equal(store.getState().permissionRequests.s2?.id, "p1");
});
