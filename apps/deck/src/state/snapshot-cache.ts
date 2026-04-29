import type { AcpAgentProvider, ProjectSummary, SessionSummary, WorkspaceSummary } from "@tiller/shared";
import type { StorageLike } from "../auth/beacon-cache";

export type DeckSnapshotCache = {
  profileId: string;
  cachedAt: string;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  workspaces: WorkspaceSummary[];
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
      workspaces: parsed.workspaces ?? [],
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
