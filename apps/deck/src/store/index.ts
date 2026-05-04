import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { createDeckStorePersistOptions } from "./middleware";
import { createAgentsSlice, type AgentsSlice } from "./slices/agents-slice";
import { createHelmsSlice, type HelmsSlice } from "./slices/helms-slice";
import {
  createPreferencesSlice,
  type PreferencesSlice,
} from "./slices/preferences-slice";
import {
  createProjectsSlice,
  type ProjectsSlice,
} from "./slices/projects-slice";

export type DeckStore = AgentsSlice & HelmsSlice & PreferencesSlice & ProjectsSlice;

export const useDeckStore = create<DeckStore>()(
  devtools(
    persist(
      (...args) => ({
        ...createAgentsSlice(...args),
        ...createHelmsSlice(...args),
        ...createPreferencesSlice(...args),
        ...createProjectsSlice(...args),
      }),
      createDeckStorePersistOptions(),
    ),
    { name: "tiller.deck.store" },
  ),
);
