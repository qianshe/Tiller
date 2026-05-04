import type { StateCreator } from "zustand";
import {
  daemonProfileKey,
  mergeDaemonProfile,
  readDaemonProfiles,
  type DaemonProfile,
} from "../../features/helm-connection/daemon-profiles";
import {
  DEFAULT_DECK_PREFERENCES,
  readDeckPreferences,
  type DeckPreferences,
} from "../../features/preferences/preferences-storage";

export type PreferencesSlice = {
  preferences: DeckPreferences;
  daemonProfiles: DaemonProfile[];
  selectedHelmKey: string;
  updatePreferences: (patch: Partial<DeckPreferences>) => void;
  addDaemonProfile: (profile: DaemonProfile) => void;
  removeDaemonProfile: (profile: DaemonProfile) => void;
  selectHelmKey: (key: string) => void;
};

function canReadBrowserStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function initialPreferences() {
  return canReadBrowserStorage() ? readDeckPreferences() : DEFAULT_DECK_PREFERENCES;
}

function initialDaemonProfiles() {
  return canReadBrowserStorage() ? readDaemonProfiles() : [];
}

export const createPreferencesSlice: StateCreator<PreferencesSlice> = (set) => ({
  preferences: initialPreferences(),
  daemonProfiles: initialDaemonProfiles(),
  selectedHelmKey: "",
  updatePreferences: (patch) =>
    set((state) => ({ preferences: { ...state.preferences, ...patch } })),
  addDaemonProfile: (profile) =>
    set((state) => ({
      daemonProfiles: mergeDaemonProfile(state.daemonProfiles, profile),
    })),
  removeDaemonProfile: (profile) =>
    set((state) => ({
      daemonProfiles: state.daemonProfiles.filter(
        (item) =>
          daemonProfileKey(item.host, item.port) !==
          daemonProfileKey(profile.host, profile.port),
      ),
    })),
  selectHelmKey: (key) => set({ selectedHelmKey: key }),
});
