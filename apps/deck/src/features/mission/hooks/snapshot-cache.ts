import { useEffect } from "react";
import type {
  AcpAgentProvider,
  ProjectSummary,
  SessionStatus,
  SessionSummary,
  WorkspaceSummary,
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
  workspaces: WorkspaceSummary[];
  agents: AcpAgentProvider[];
  setProjects: (projects: ProjectSummary[]) => void;
  setSessions: (sessions: SessionSummary[]) => void;
  setWorkspaces: (workspaces: WorkspaceSummary[]) => void;
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
  workspaces,
  agents,
  setProjects,
  setSessions,
  setWorkspaces,
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
    setWorkspaces(snapshot.workspaces);
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
      workspaces,
      agents,
    });
  }, [activeProfileId, agents, pairingState, projects, sessions, workspaces]);
}
