import { createJSONStorage, type PersistOptions } from "zustand/middleware";
import { persistAdapter } from "./persist";
import type { DeckStore } from "./index";

export const DECK_STORE_STORAGE_KEY = "tiller.deck.store";

type PersistedDeckStore = Pick<
  DeckStore,
  "preferences" | "daemonProfiles" | "selectedHelmKey"
>;

export function createDeckStorePersistOptions(): PersistOptions<
  DeckStore,
  PersistedDeckStore
> {
  return {
    name: DECK_STORE_STORAGE_KEY,
    storage: createJSONStorage(() => persistAdapter(window.localStorage)),
    partialize: (state) => ({
      preferences: state.preferences,
      daemonProfiles: state.daemonProfiles,
      selectedHelmKey: state.selectedHelmKey,
    }),
  };
}
