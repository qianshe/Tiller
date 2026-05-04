import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { createDeckStorePersistOptions } from "./middleware";
import { createActivitiesSlice, type ActivitiesSlice } from "./slices/activities-slice";
import { createAgentsSlice, type AgentsSlice } from "./slices/agents-slice";
import { createHelmsSlice, type HelmsSlice } from "./slices/helms-slice";
import { createMessagesSlice, type MessagesSlice } from "./slices/messages-slice";
import { createPermissionsSlice, type PermissionsSlice } from "./slices/permissions-slice";
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

export type DeckStore = ActivitiesSlice &
  AgentsSlice &
  HelmsSlice &
  MessagesSlice &
  PermissionsSlice &
  PreferencesSlice &
  ProjectsSlice &
  SessionsSlice;

export const useDeckStore = create<DeckStore>()(
  devtools(
    persist(
      (...args) => ({
        ...createActivitiesSlice(...args),
        ...createAgentsSlice(...args),
        ...createHelmsSlice(...args),
        ...createMessagesSlice(...args),
        ...createPermissionsSlice(...args),
        ...createPreferencesSlice(...args),
        ...createProjectsSlice(...args),
        ...createSessionsSlice(...args),
      }),
      createDeckStorePersistOptions(),
    ),
    { name: "tiller.deck.store" },
  ),
);
