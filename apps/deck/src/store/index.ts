import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { createDeckStorePersistOptions } from "./middleware";
import { createActivitiesSlice, type ActivitiesSlice } from "./slices/activities-slice";
import { createAgentsSlice, type AgentsSlice } from "./slices/agents-slice";
import { createApprovalsSlice, type ApprovalsSlice } from "./slices/approvals-slice";
import {
  createConnectionSlice,
  type ConnectionSlice,
} from "./slices/connection-slice";
import { createHelmsSlice, type HelmsSlice } from "./slices/helms-slice";
import { createMessagesSlice, type MessagesSlice } from "./slices/messages-slice";
import {
  createPairingSlice,
  type PairingSlice,
} from "./slices/pairing-slice";
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
  ApprovalsSlice &
  ConnectionSlice &
  HelmsSlice &
  MessagesSlice &
  PairingSlice &
  PreferencesSlice &
  ProjectsSlice &
  SessionsSlice;

export const useDeckStore = create<DeckStore>()(
  devtools(
    persist(
      (...args) => ({
        ...createActivitiesSlice(...args),
        ...createAgentsSlice(...args),
        ...createApprovalsSlice(...args),
        ...createConnectionSlice(...args),
        ...createHelmsSlice(...args),
        ...createMessagesSlice(...args),
        ...createPairingSlice(...args),
        ...createPreferencesSlice(...args),
        ...createProjectsSlice(...args),
        ...createSessionsSlice(...args),
      }),
      createDeckStorePersistOptions(),
    ),
    { name: "tiller.deck.store" },
  ),
);
