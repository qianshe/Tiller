import type { AcpAgentProvider, ProjectSummary, SessionSummary, WorktreeSummary } from "@tiller/shared";
import type { StorageLike } from "../features/auth";

export type DeckSnapshotCache = {
  profileId: string;
  cachedAt: string;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  worktrees: WorktreeSummary[];
  agents: AcpAgentProvider[];
};

export function snapshotStorageKey(profileId: string) {
  return `tiller.deck-snapshot.${profileId}`;
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
