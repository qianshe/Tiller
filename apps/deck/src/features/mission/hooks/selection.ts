import type { Dispatch, SetStateAction } from "react";
import type {
  AcpAgentProvider,
  ProjectSummary,
  SessionReasoningEffort,
  SessionSummary,
} from "@tiller/shared";
import {
  resolveSessionProjectId,
  toggleExpandedIdSet,
} from "../utils/session-derivations";

type UseSelectionOptions = {
  projects: ProjectSummary[];
  agents: AcpAgentProvider[];
  sessions: SessionSummary[];
  requestChatScrollToBottom: (sessionId: string | null) => void;
  setSelectedMissionHelmId: Dispatch<SetStateAction<string | null>>;
  setExpandedMissionHelmIds: Dispatch<SetStateAction<Set<string>>>;
  setExpandedMissionProjectIds: Dispatch<SetStateAction<Set<string>>>;
  setSelectedProjectId: Dispatch<SetStateAction<string | null>>;
  setSelectedWorkspaceId: Dispatch<SetStateAction<string | null>>;
  setSelectedAgentId: Dispatch<SetStateAction<string | null>>;
  setActiveSessionId: (sessionId: string | null) => void;
  setWorktreePickerOpen: Dispatch<SetStateAction<boolean>>;
  setAgentPickerOpen: Dispatch<SetStateAction<boolean>>;
};

type SessionDraftPreferencePatch = {
  agentMode?: string;
  model?: string;
  reasoningEffort?: SessionReasoningEffort;
};

export type { SessionDraftPreferencePatch };

/**
 * Coordinates mission tree, draft selectors and active session selection.
 */
export function useSelection({
  projects,
  agents,
  sessions,
  requestChatScrollToBottom,
  setSelectedMissionHelmId,
  setExpandedMissionHelmIds,
  setExpandedMissionProjectIds,
  setSelectedProjectId,
  setSelectedWorkspaceId,
  setSelectedAgentId,
  setActiveSessionId,
  setWorktreePickerOpen,
  setAgentPickerOpen,
}: UseSelectionOptions) {
  function toggleHelmNode(helmId: string) {
    setExpandedMissionHelmIds((current) => {
      const next = new Set(current);
      if (next.has(helmId)) {
        next.delete(helmId);
      } else {
        next.add(helmId);
      }
      return next;
    });
  }

  function toggleProjectNode(projectId: string) {
    setExpandedMissionProjectIds((current) =>
      toggleExpandedIdSet(current, projectId),
    );
  }

  function selectDraftWorkspace(workspaceId: string) {
    setSelectedWorkspaceId(workspaceId);
    setWorktreePickerOpen(false);
  }

  function selectDraftAgent(agentId: string) {
    setSelectedAgentId(agentId);
    setAgentPickerOpen(false);
  }

  function selectHelm(helmId: string) {
    setSelectedMissionHelmId(helmId);
    setExpandedMissionHelmIds((current) => new Set([...current, helmId]));
    const nextProject =
      projects.find((project) => project.helmId === helmId) ?? null;
    requestChatScrollToBottom(null);
    setSelectedProjectId(nextProject?.id ?? null);
    setActiveSessionId(null);
  }

  function selectProject(projectId: string) {
    const project = projects.find((item) => item.id === projectId);
    if (project) {
      setSelectedMissionHelmId(project.helmId);
      setExpandedMissionHelmIds(
        (current) => new Set([...current, project.helmId]),
      );
      setExpandedMissionProjectIds(
        (current) => new Set([...current, projectId]),
      );
      setSelectedWorkspaceId((current) =>
        project.workspaceIds?.includes(current ?? "")
          ? current
          : (project.defaultWorkspaceId ?? project.workspaceIds?.[0] ?? null),
      );
      setSelectedAgentId((current) =>
        agents.some((agent) => agent.id === current)
          ? current
          : (project.defaultAgentId ?? agents[0]?.id ?? null),
      );
    }
    setSelectedProjectId(projectId);
    requestChatScrollToBottom(null);
    setActiveSessionId(null);
  }

  function openSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }
    setSelectedMissionHelmId(session.helmId);
    const projectId = resolveSessionProjectId(session, projects);
    setSelectedProjectId(projectId);
    setExpandedMissionHelmIds(
      (current) => new Set([...current, session.helmId]),
    );
    setExpandedMissionProjectIds((current) => new Set([...current, projectId]));
    requestChatScrollToBottom(sessionId);
    setActiveSessionId(sessionId);
  }

  return {
    toggleHelmNode,
    toggleProjectNode,
    selectDraftWorkspace,
    selectDraftAgent,
    selectHelm,
    selectProject,
    openSession,
  };
}
