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
  setSelectedModel: Dispatch<SetStateAction<string>>;
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
  setSelectedModel,
  setActiveSessionId,
  setWorktreePickerOpen,
  setAgentPickerOpen,
}: UseSelectionOptions) {
  function toggleMissionHelmNode(helmId: string) {
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

  function toggleMissionProjectNode(projectId: string) {
    setExpandedMissionProjectIds((current) =>
      toggleExpandedIdSet(current, projectId),
    );
  }

  function selectDraftWorkspace(workspaceId: string) {
    setSelectedWorkspaceId(workspaceId);
    setWorktreePickerOpen(false);
  }

  function selectDraftAgent(agentId: string) {
    setSelectedModel("provider-default");
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
    setSelectedAgentId(null);
    setSelectedModel("provider-default");
    setAgentPickerOpen(false);
    setWorktreePickerOpen(false);
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
      setSelectedAgentId(null);
      setSelectedModel("provider-default");
      setAgentPickerOpen(false);
      setWorktreePickerOpen(false);
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
    toggleMissionHelmNode,
    toggleMissionProjectNode,
    selectDraftWorkspace,
    selectDraftAgent,
    selectHelm,
    selectProject,
    openSession,
  };
}
