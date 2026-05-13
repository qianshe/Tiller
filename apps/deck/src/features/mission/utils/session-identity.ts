import type { AcpAgentProvider, ProjectSummary, WorktreeSummary } from "@tiller/shared";

export type NewSessionIdentityInput = {
  selectedProjectId?: string | null;
  projects: Pick<ProjectSummary, "id" | "path">[];
  selectedWorktree?: Pick<WorktreeSummary, "path"> | null;
  worktrees: Pick<WorktreeSummary, "path">[];
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
  selectedWorktree,
  worktrees,
  selectedAgentId,
}: NewSessionIdentityInput): NewSessionIdentity | null {
  const projectId = selectedProjectId || projects[0]?.id;
  const project = projects.find((item) => item.id === projectId) ?? projects[0];
  const worktree = selectedWorktree ?? worktrees[0];
  const cwd = worktree?.path ?? project?.path;
  const agentId = selectedAgentId;

  if (!projectId || !cwd || !agentId) {
    return null;
  }

  return { projectId, cwd, agentId };
}
