import type { AcpAgentProvider, ProjectSummary, WorkspaceSummary } from "@tiller/shared";

export type NewSessionIdentityInput = {
  selectedProjectId?: string | null;
  projects: Pick<ProjectSummary, "id">[];
  selectedWorkspace?: Pick<WorkspaceSummary, "id"> | null;
  workspaces: Pick<WorkspaceSummary, "id">[];
  selectedAgentId?: string | null;
  agents?: Pick<AcpAgentProvider, "id">[];
};

export type NewSessionIdentity = {
  projectId: string;
  workspaceId: string;
  agentId: string;
};

export function resolveNewSessionIdentity({
  selectedProjectId,
  projects,
  selectedWorkspace,
  workspaces,
  selectedAgentId,
}: NewSessionIdentityInput): NewSessionIdentity | null {
  const projectId = selectedProjectId || projects[0]?.id;
  const workspaceId = selectedWorkspace?.id || workspaces[0]?.id;
  const agentId = selectedAgentId;

  if (!projectId || !workspaceId || !agentId) {
    return null;
  }

  return { projectId, workspaceId, agentId };
}
