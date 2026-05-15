import type {
  AcpAgentProvider,
  AvailableCommand,
  ProjectSummary,
  SessionSummary,
  WorktreeSummary,
} from "@tiller/shared";
import type { StorageLike } from "../features/auth";

export type DeckSnapshotCache = {
  profileId: string;
  cachedAt: string;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  worktrees: WorktreeSummary[];
  agents: AcpAgentProvider[];
  activeSessionId?: string | null;
  sessionAvailableCommands: Record<string, AvailableCommand[]>;
  agentAvailableCommands: Record<string, AvailableCommand[]>;
};

export function snapshotStorageKey(profileId: string) {
  return `tiller.deck-snapshot.${profileId}`;
}

function normalizeCommandMap(value: unknown): Record<string, AvailableCommand[]> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, AvailableCommand[]] =>
        typeof entry[0] === "string" && Array.isArray(entry[1]),
    ),
  );
}

export function readDeckSnapshot(storage: StorageLike, profileId: string): DeckSnapshotCache | null {
  try {
    const raw = storage.getItem(snapshotStorageKey(profileId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<DeckSnapshotCache>;
    if (!parsed.profileId || !parsed.cachedAt) {
      return null;
    }
    return {
      profileId: parsed.profileId,
      cachedAt: parsed.cachedAt,
      projects: parsed.projects ?? [],
      sessions: parsed.sessions ?? [],
      worktrees: parsed.worktrees ?? [],
      agents: parsed.agents ?? [],
      activeSessionId: typeof parsed.activeSessionId === "string" ? parsed.activeSessionId : null,
      sessionAvailableCommands: normalizeCommandMap(parsed.sessionAvailableCommands),
      agentAvailableCommands: normalizeCommandMap(parsed.agentAvailableCommands),
    };
  } catch {
    return null;
  }
}

export function writeDeckSnapshot(storage: StorageLike, snapshot: DeckSnapshotCache) {
  storage.setItem(snapshotStorageKey(snapshot.profileId), JSON.stringify(snapshot));
}

export function clearDeckSnapshot(storage: StorageLike, profileId: string) {
  storage.removeItem(snapshotStorageKey(profileId));
}

export function persistAdapter(storage: StorageLike) {
  return {
    getItem(name: string) {
      return storage.getItem(name);
    },
    setItem(name: string, value: string) {
      storage.setItem(name, value);
    },
    removeItem(name: string) {
      storage.removeItem(name);
    },
  };
}
