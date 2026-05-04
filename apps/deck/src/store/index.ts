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
import {
  createSessionsSlice,
  type SessionsSlice,
} from "./slices/sessions-slice";

export type DeckStore = AgentsSlice &
  HelmsSlice &
  PreferencesSlice &
  ProjectsSlice &
  SessionsSlice;

export const useDeckStore = create<DeckStore>()(
  devtools(
    persist(
      (...args) => ({
        ...createAgentsSlice(...args),
        ...createHelmsSlice(...args),
        ...createPreferencesSlice(...args),
        ...createProjectsSlice(...args),
        ...createSessionsSlice(...args),
      }),
      createDeckStorePersistOptions(),
    ),
    { name: "tiller.deck.store" },
  ),
);
