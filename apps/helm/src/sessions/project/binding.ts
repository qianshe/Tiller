import type { ProjectSummary, SessionSummary, WorkspaceSummary } from "@tiller/shared";

/** True when `workspace` represents the project's root branch — its path should fall back to `project.path`. */
export function isProjectRootBranchWorkspace<P extends ProjectSummary>(
  project: P,
  workspace: Pick<WorkspaceSummary, "id">,
): project is P & { path: string } {
  return Boolean(
    project.path &&
    (workspace.id === project.defaultWorkspaceId || workspace.id === project.gitCurrentBranch),
  );
}

export function alignSessionProjectBinding(
  summary: SessionSummary,
  projects: ProjectSummary[],
): SessionSummary {
  const exactProject = projects.find((project) => project.id === summary.projectId);
  if (exactProject) {
    return {
      ...summary,
      projectName: exactProject.name,
      helmId: exactProject.helmId,
    };
  }

  const matchedProject =
    projects.find((project) => project.name === summary.projectName) ??
    projects.find((project) => project.workspaceIds?.includes(summary.workspaceId));
  if (!matchedProject) {
    return summary;
  }

  return {
    ...summary,
    projectId: matchedProject.id,
    projectName: matchedProject.name,
    helmId: matchedProject.helmId,
  };
}

export function alignSessionWorkspaceBinding(
  summary: SessionSummary,
  workspaces: WorkspaceSummary[],
): SessionSummary {
  const normalizedSummaryPath = normalizeWorkspacePath(summary.workspacePath);
  const matchedWorkspace = normalizedSummaryPath
    ? workspaces.find(
        (workspace) => normalizeWorkspacePath(workspace.path) === normalizedSummaryPath,
      )
    : undefined;

  if (!matchedWorkspace) {
    return summary;
  }

  return {
    ...summary,
    workspaceId: matchedWorkspace.id,
    workspaceName: matchedWorkspace.name,
    workspacePath: summary.workspacePath ?? matchedWorkspace.path,
  };
}

function normalizeWorkspacePath(path: string | undefined) {
  return path?.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}
