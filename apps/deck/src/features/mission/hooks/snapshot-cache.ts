import { useEffect } from "react";
import type {
  AcpAgentProvider,
  ProjectSummary,
  SessionStatus,
  SessionSummary,
  WorktreeSummary,
} from "@tiller/shared";
import { readDeckSnapshot, writeDeckSnapshot } from "../../../store/facade";
import { createSessionStatusMap } from "../utils/session-derivations";

type StatusMap = Record<string, SessionStatus>;

type UseSnapshotCacheOptions = {
  activeProfileId: string;
  missionVisualMode: boolean;
  pairingState: string;
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  worktrees: WorktreeSummary[];
  agents: AcpAgentProvider[];
  setProjects: (projects: ProjectSummary[]) => void;
  setSessions: (sessions: SessionSummary[]) => void;
  setWorktrees: (worktrees: WorktreeSummary[]) => void;
  setAgents: (agents: AcpAgentProvider[]) => void;
  setStatuses: (statuses: StatusMap) => void;
};

/**
 * Restores and persists the Deck project/session snapshot for the active Helm profile.
 */
export function useSnapshotCache({
  activeProfileId,
  missionVisualMode,
  pairingState,
  projects,
  sessions,
  worktrees,
  agents,
  setProjects,
  setSessions,
  setWorktrees,
  setAgents,
  setStatuses,
}: UseSnapshotCacheOptions) {
  useEffect(() => {
    if (missionVisualMode) {
      return;
    }
    const snapshot = readDeckSnapshot(window.localStorage, activeProfileId);
    if (!snapshot) {
      return;
    }
    setProjects(snapshot.projects);
    setSessions(snapshot.sessions);
    setWorktrees(snapshot.worktrees);
    setAgents(snapshot.agents);
    setStatuses(createSessionStatusMap(snapshot.sessions));
  }, [activeProfileId, missionVisualMode]);

  useEffect(() => {
    if (missionVisualMode || pairingState !== "paired") {
      return;
    }
    writeDeckSnapshot(window.localStorage, {
      profileId: activeProfileId,
      cachedAt: new Date().toISOString(),
      projects,
      sessions,
      worktrees,
      agents,
    });
  }, [activeProfileId, agents, pairingState, projects, sessions, worktrees]);
}
