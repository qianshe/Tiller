import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "zustand/vanilla";
import type { DaemonProfile } from "../../features/helm-connection/daemon-profiles";
import { DEFAULT_DECK_PREFERENCES } from "../../features/preferences/storage";
import {
  createPreferencesSlice,
  type PreferencesSlice,
} from "./preferences-slice.js";

function createTestStore() {
  return createStore<PreferencesSlice>()((...args) => ({
    ...createPreferencesSlice(...args),
  }));
}

function profile(input: Partial<DaemonProfile> = {}): DaemonProfile {
  return {
    id: input.id ?? "profile-1",
    name: input.name ?? "Local Helm",
    host: input.host ?? "127.0.0.1",
    port: input.port ?? "47631",
  };
}

test("updatePreferences merges a partial preferences patch", () => {
  const store = createTestStore();

  store.getState().updatePreferences({ theme: "dark", reduceMotion: true });

  assert.equal(store.getState().preferences.theme, "dark");
  assert.equal(store.getState().preferences.reduceMotion, true);
  assert.equal(
    store.getState().preferences.language,
    DEFAULT_DECK_PREFERENCES.language,
  );
});

test("addDaemonProfile replaces an existing endpoint profile", () => {
  const store = createTestStore();

  store.getState().addDaemonProfile(profile({ id: "old", name: "Old" }));
  store.getState().addDaemonProfile(profile({ id: "new", name: "New" }));

  assert.deepEqual(store.getState().daemonProfiles, [
    profile({ id: "new", name: "New" }),
  ]);
});

test("removeDaemonProfile deletes by endpoint key", () => {
  const store = createTestStore();
  const first = profile({ id: "first", host: "127.0.0.1", port: "47631" });
  const second = profile({ id: "second", host: "127.0.0.1", port: "47632" });

  store.getState().addDaemonProfile(first);
  store.getState().addDaemonProfile(second);
  store
    .getState()
    .removeDaemonProfile(profile({ host: "127.0.0.1", port: "47631" }));

  assert.deepEqual(store.getState().daemonProfiles, [second]);
});

test("selectHelmKey stores the active helm key", () => {
  const store = createTestStore();

  store.getState().selectHelmKey("127.0.0.1:47631");

  assert.equal(store.getState().selectedHelmKey, "127.0.0.1:47631");
});
