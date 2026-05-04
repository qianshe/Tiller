import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { createDeckStorePersistOptions } from "./middleware";
import {
  createPreferencesSlice,
  type PreferencesSlice,
} from "./slices/preferences-slice";

export type DeckStore = PreferencesSlice;

export const useDeckStore = create<DeckStore>()(
  devtools(
    persist(
      (...args) => ({
        ...createPreferencesSlice(...args),
      }),
      createDeckStorePersistOptions(),
    ),
    { name: "tiller.deck.store" },
  ),
);
