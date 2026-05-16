import type {
  AvailableCommand,
  SessionConfigOption,
  SessionPromptQueueSnapshot,
  SessionStatus,
  SessionSummary,
} from "@tiller/shared";
import type { StateCreator } from "zustand";

const SESSION_TITLES_STORAGE_KEY = "tiller.session-titles";
const AGENT_AVAILABLE_COMMANDS_STORAGE_KEY = "tiller.agent-available-commands";

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
export type SessionPromptQueuesUpdater =
  | Record<string, SessionPromptQueueSnapshot>
  | ((
      current: Record<string, SessionPromptQueueSnapshot>,
    ) => Record<string, SessionPromptQueueSnapshot>);
export type AgentAvailableCommandsUpdater =
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
  promptQueues: Record<string, SessionPromptQueueSnapshot>;
  agentAvailableCommands: Record<string, AvailableCommand[]>;
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
  setPromptQueues: (updater: SessionPromptQueuesUpdater) => void;
  setPromptQueue: (sessionId: string, queue: SessionPromptQueueSnapshot) => void;
  setAgentAvailableCommands: (
    updater: AgentAvailableCommandsUpdater,
  ) => void;
  refreshAgentAvailableCommands: () => void;
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

function readAgentAvailableCommands(): Record<string, AvailableCommand[]> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(AGENT_AVAILABLE_COMMANDS_STORAGE_KEY) ?? "{}",
    ) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, AvailableCommand[]] =>
          typeof entry[0] === "string" && Array.isArray(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function writeAgentAvailableCommands(commands: Record<string, AvailableCommand[]>) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      AGENT_AVAILABLE_COMMANDS_STORAGE_KEY,
      JSON.stringify(commands),
    );
  } catch {
    // Ignore storage quota or privacy-mode failures; the in-memory cache still works.
  }
}

function agentAvailableCommandMapsEqual(
  left: Record<string, AvailableCommand[]>,
  right: Record<string, AvailableCommand[]>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => {
    const leftCommands = left[key] ?? [];
    const rightCommands = right[key] ?? [];
    if (leftCommands.length !== rightCommands.length) {
      return false;
    }
    return leftCommands.every((command, index) => {
      const other = rightCommands[index];
      return (
        other !== undefined &&
        command.name === other.name &&
        command.description === other.description &&
        command.input?.hint === other.input?.hint
      );
    });
  });
}

export const createSessionsSlice: StateCreator<SessionsSlice> = (set) => ({
  sessions: [],
  sessionHistoryState: { hasMore: false, loading: false },
  statuses: {},
  sessionTitles: readSessionTitles(),
  sessionConfigOptions: {},
  sessionAvailableCommands: {},
  promptQueues: {},
  agentAvailableCommands: readAgentAvailableCommands(),
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
  setPromptQueues: (updater) =>
    set((state) => ({
      promptQueues:
        typeof updater === "function" ? updater(state.promptQueues) : updater,
    })),
  setPromptQueue: (sessionId, queue) =>
    set((state) => ({
      promptQueues: { ...state.promptQueues, [sessionId]: queue },
    })),
  setAgentAvailableCommands: (updater) =>
    set((state) => {
      const next =
        typeof updater === "function"
          ? updater(state.agentAvailableCommands)
          : updater;
      writeAgentAvailableCommands(next);
      return { agentAvailableCommands: next };
    }),
  refreshAgentAvailableCommands: () =>
    set((state) => {
      const next = readAgentAvailableCommands();
      if (agentAvailableCommandMapsEqual(state.agentAvailableCommands, next)) {
        return {};
      }
      return { agentAvailableCommands: next };
    }),
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
