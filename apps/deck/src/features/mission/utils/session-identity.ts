import type { AcpAgentProvider, ProjectSummary, WorkspaceSummary } from "@tiller/shared";

export type NewSessionIdentityInput = {
  selectedProjectId?: string | null;
  projects: Pick<ProjectSummary, "id" | "path">[];
  selectedWorkspace?: Pick<WorkspaceSummary, "id" | "path"> | null;
  workspaces: Pick<WorkspaceSummary, "id" | "path">[];
  selectedAgentId?: string | null;
  agents?: Pick<AcpAgentProvider, "id">[];
};

export type NewSessionIdentity = {
  projectId: string;
  cwd: string;
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
  const project = projects.find((item) => item.id === projectId) ?? projects[0];
  const workspace = selectedWorkspace ?? workspaces[0];
  const cwd = workspace?.path ?? project?.path;
  const agentId = selectedAgentId;

  if (!projectId || !cwd || !agentId) {
    return null;
  }

  return { projectId, cwd, agentId };
}
