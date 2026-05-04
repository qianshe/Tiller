import type { HelmSummary } from "@tiller/shared";
import type { StateCreator } from "zustand";
import type {
  ConnectionState,
  HelmInventoryBucket,
} from "../../features/helm-connection/use-helm-connection-state";

export type HelmListUpdater =
  | HelmSummary[]
  | ((current: HelmSummary[]) => HelmSummary[]);

export type HelmsSlice = {
  helms: HelmSummary[];
  helmConnectionStates: Record<string, ConnectionState>;
  helmInventories: Record<string, HelmInventoryBucket>;
  setHelms: (updater: HelmListUpdater) => void;
  applyHelmInventory: (
    helmKey: string,
    patch: Partial<HelmInventoryBucket>,
  ) => void;
  setHelmConnection: (helmKey: string, state: ConnectionState) => void;
  removeHelm: (helmKey: string) => void;
};

const emptyInventoryBucket: HelmInventoryBucket = {
  projects: [],
  workspaces: [],
  agents: [],
  sessions: [],
  statuses: {},
  trustedDevices: [],
};

export const createHelmsSlice: StateCreator<HelmsSlice> = (set) => ({
  helms: [],
  helmConnectionStates: {},
  helmInventories: {},
  setHelms: (updater) =>
    set((state) => ({
      helms: typeof updater === "function" ? updater(state.helms) : updater,
    })),
  applyHelmInventory: (helmKey, patch) =>
    set((state) => ({
      helmInventories: {
        ...state.helmInventories,
        [helmKey]: {
          ...emptyInventoryBucket,
          ...(state.helmInventories[helmKey] ?? {}),
          ...patch,
        },
      },
    })),
  setHelmConnection: (helmKey, connectionState) =>
    set((state) => ({
      helmConnectionStates: {
        ...state.helmConnectionStates,
        [helmKey]: connectionState,
      },
    })),
  removeHelm: (helmKey) =>
    set((state) => {
      const { [helmKey]: _removedConnection, ...helmConnectionStates } =
        state.helmConnectionStates;
      const { [helmKey]: _removedInventory, ...helmInventories } =
        state.helmInventories;
      return { helmConnectionStates, helmInventories };
    }),
});
