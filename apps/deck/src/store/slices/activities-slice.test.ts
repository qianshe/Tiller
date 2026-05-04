import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "zustand/vanilla";
import { createActivitiesSlice, type ActivitiesSlice } from "./activities-slice.js";

function createTestStore() {
  return createStore<ActivitiesSlice>()((...args) => ({ ...createActivitiesSlice(...args) }));
}

test("activity history and visible count maps support updater forms", () => {
  const store = createTestStore();
  store.getState().setActivityHistoryState({ s1: { hasMore: true, loading: false } });
  store.getState().setActivityVisibleCounts((current) => ({ ...current, s1: 50 }));
  assert.equal(store.getState().activityHistoryState.s1?.hasMore, true);
  assert.equal(store.getState().activityVisibleCounts.s1, 50);
});
