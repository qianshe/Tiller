import type {
  AvailableCommand,
  SessionConfigOption,
  SessionStatus,
  SessionSummary,
} from "@tiller/shared";
import type { StateCreator } from "zustand";

const SESSION_TITLES_STORAGE_KEY = "tiller.session-titles";

export type SessionHistoryState = {
  nextCursor?: string;
  hasMore: boolean;
  loading: boolean;
};

export type SessionsUpdater =
  | SessionSummary[]
  | ((current: SessionSummary[]) => SessionSummary[]);
export type StatusesUpdater =
  | Record<string, SessionStatus>
  | ((current: Record<string, SessionStatus>) => Record<string, SessionStatus>);
export type SessionTitlesUpdater =
  | Record<string, string>
  | ((current: Record<string, string>) => Record<string, string>);
export type SessionConfigOptionsUpdater =
  | Record<string, SessionConfigOption[]>
  | ((
      current: Record<string, SessionConfigOption[]>,
    ) => Record<string, SessionConfigOption[]>);
export type SessionAvailableCommandsUpdater =
  | Record<string, AvailableCommand[]>
  | ((
      current: Record<string, AvailableCommand[]>,
    ) => Record<string, AvailableCommand[]>);
export type SessionHistoryStateUpdater =
  | SessionHistoryState
  | ((current: SessionHistoryState) => SessionHistoryState);
export type ActiveSessionIdUpdater =
  | string
  | null
  | ((current: string | null) => string | null);

export type SessionsSlice = {
  sessions: SessionSummary[];
  sessionHistoryState: SessionHistoryState;
  statuses: Record<string, SessionStatus>;
  sessionTitles: Record<string, string>;
  sessionConfigOptions: Record<string, SessionConfigOption[]>;
  sessionAvailableCommands: Record<string, AvailableCommand[]>;
  activeSessionId: string | null;
  setSessions: (updater: SessionsUpdater) => void;
  setStatuses: (updater: StatusesUpdater) => void;
  setSessionStatus: (sessionId: string, status: SessionStatus) => void;
  setSessionTitles: (updater: SessionTitlesUpdater) => void;
  setSessionTitle: (sessionId: string, title: string) => void;
  setSessionConfigOptions: (updater: SessionConfigOptionsUpdater) => void;
  setSessionAvailableCommands: (
    updater: SessionAvailableCommandsUpdater,
  ) => void;
  setSessionHistoryState: (updater: SessionHistoryStateUpdater) => void;
  setActiveSessionId: (updater: ActiveSessionIdUpdater) => void;
};

function readSessionTitles(): Record<string, string> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(SESSION_TITLES_STORAGE_KEY) ?? "{}",
    ) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

export const createSessionsSlice: StateCreator<SessionsSlice> = (set) => ({
  sessions: [],
  sessionHistoryState: { hasMore: false, loading: false },
  statuses: {},
  sessionTitles: readSessionTitles(),
  sessionConfigOptions: {},
  sessionAvailableCommands: {},
  activeSessionId: null,
  setSessions: (updater) =>
    set((state) => ({
      sessions: typeof updater === "function" ? updater(state.sessions) : updater,
    })),
  setStatuses: (updater) =>
    set((state) => ({
      statuses: typeof updater === "function" ? updater(state.statuses) : updater,
    })),
  setSessionStatus: (sessionId, status) =>
    set((state) => ({ statuses: { ...state.statuses, [sessionId]: status } })),
  setSessionTitles: (updater) =>
    set((state) => ({
      sessionTitles:
        typeof updater === "function" ? updater(state.sessionTitles) : updater,
    })),
  setSessionTitle: (sessionId, title) =>
    set((state) => ({
      sessionTitles: { ...state.sessionTitles, [sessionId]: title },
    })),
  setSessionConfigOptions: (updater) =>
    set((state) => ({
      sessionConfigOptions:
        typeof updater === "function"
          ? updater(state.sessionConfigOptions)
          : updater,
    })),
  setSessionAvailableCommands: (updater) =>
    set((state) => ({
      sessionAvailableCommands:
        typeof updater === "function"
          ? updater(state.sessionAvailableCommands)
          : updater,
    })),
  setSessionHistoryState: (updater) =>
    set((state) => ({
      sessionHistoryState:
        typeof updater === "function"
          ? updater(state.sessionHistoryState)
          : updater,
    })),
  setActiveSessionId: (updater) =>
    set((state) => ({
      activeSessionId:
        typeof updater === "function" ? updater(state.activeSessionId) : updater,
    })),
});
