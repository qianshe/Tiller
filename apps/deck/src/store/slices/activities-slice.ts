import type { StateCreator } from "zustand";

type ActivityHistoryState = Record<
  string,
  { nextCursor?: string; hasMore: boolean; loading: boolean }
>;

type Updater<T> = T | ((current: T) => T);

export type ActivitiesSlice = {
  activityHistoryState: ActivityHistoryState;
  activityVisibleCounts: Record<string, number>;
  setActivityHistoryState: (updater: Updater<ActivityHistoryState>) => void;
  setActivityVisibleCounts: (updater: Updater<Record<string, number>>) => void;
};

export const createActivitiesSlice: StateCreator<ActivitiesSlice> = (set) => ({
  activityHistoryState: {},
  activityVisibleCounts: {},
  setActivityHistoryState: (updater) =>
    set((state) => ({
      activityHistoryState:
        typeof updater === "function" ? updater(state.activityHistoryState) : updater,
    })),
  setActivityVisibleCounts: (updater) =>
    set((state) => ({
      activityVisibleCounts:
        typeof updater === "function" ? updater(state.activityVisibleCounts) : updater,
    })),
});
