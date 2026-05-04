import type { TrustedDeviceSummary } from "@tiller/shared";
import type { StateCreator } from "zustand";
import type { TrustedDeviceCache } from "../../features/auth/beacon-cache";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export type DebugTrace = {
  connectClicks: number;
  pairClicks: number;
  requestsSent: number;
  lastRequestType: string;
};

type Updater<T> = T | ((current: T) => T);

export type ConnectionSlice = {
  connection: ConnectionState;
  daemonHost: string;
  daemonPort: string;
  trustedDevice: TrustedDeviceCache | null;
  trustedDevices: TrustedDeviceSummary[];
  debugTrace: DebugTrace;
  setConnection: (updater: Updater<ConnectionState>) => void;
  setEndpoint: (endpoint: { host: string; port: string }) => void;
  setDaemonHost: (host: string) => void;
  setDaemonPort: (port: string) => void;
  setTrustedDevice: (device: TrustedDeviceCache | null) => void;
  setTrustedDevices: (updater: Updater<TrustedDeviceSummary[]>) => void;
  setDebugTrace: (updater: Updater<DebugTrace>) => void;
};

const DEFAULT_DEBUG_TRACE: DebugTrace = {
  connectClicks: 0,
  pairClicks: 0,
  requestsSent: 0,
  lastRequestType: "none",
};

export const createConnectionSlice: StateCreator<ConnectionSlice> = (set) => ({
  connection: "disconnected",
  daemonHost: "127.0.0.1",
  daemonPort: "47631",
  trustedDevice: null,
  trustedDevices: [],
  debugTrace: DEFAULT_DEBUG_TRACE,
  setConnection: (updater) =>
    set((state) => ({
      connection:
        typeof updater === "function" ? updater(state.connection) : updater,
    })),
  setEndpoint: ({ host, port }) => set({ daemonHost: host, daemonPort: port }),
  setDaemonHost: (daemonHost) => set({ daemonHost }),
  setDaemonPort: (daemonPort) => set({ daemonPort }),
  setTrustedDevice: (trustedDevice) => set({ trustedDevice }),
  setTrustedDevices: (updater) =>
    set((state) => ({
      trustedDevices:
        typeof updater === "function" ? updater(state.trustedDevices) : updater,
    })),
  setDebugTrace: (updater) =>
    set((state) => ({
      debugTrace:
        typeof updater === "function" ? updater(state.debugTrace) : updater,
    })),
});
