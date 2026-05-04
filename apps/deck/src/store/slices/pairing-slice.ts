import type { StateCreator } from "zustand";

export type PairingState = "idle" | "waiting" | "input" | "paired" | "rejected";

export type PairingSlice = {
  pairingState: PairingState;
  pairingCodeInput: string;
  pairingFeedback: string;
  connectFeedback: string;
  setPairingState: (updater: PairingState | ((current: PairingState) => PairingState)) => void;
  setPairingCodeInput: (pairingCodeInput: string) => void;
  setPairingFeedback: (pairingFeedback: string) => void;
  setConnectFeedback: (connectFeedback: string) => void;
};

export const createPairingSlice: StateCreator<PairingSlice> = (set) => ({
  pairingState: "idle",
  pairingCodeInput: "",
  pairingFeedback: "",
  connectFeedback: "",
  setPairingState: (updater) =>
    set((state) => ({
      pairingState:
        typeof updater === "function" ? updater(state.pairingState) : updater,
    })),
  setPairingCodeInput: (pairingCodeInput) => set({ pairingCodeInput }),
  setPairingFeedback: (pairingFeedback) => set({ pairingFeedback }),
  setConnectFeedback: (connectFeedback) => set({ connectFeedback }),
});
