import type { ProjectSummary, SessionSummary, WorktreeSummary } from "@tiller/shared";

/** True when `worktree` represents the project's root cwd. */
export function isProjectRootBranchWorktree<P extends ProjectSummary>(
  project: P,
  worktree: Pick<WorktreeSummary, "path">,
): project is P & { path: string } {
  return Boolean(project.path && normalizeWorktreePath(worktree.path) === normalizeWorktreePath(project.path));
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
      cwd: summary.cwd || resolveProjectCwd(exactProject),
    };
  }

  const matchedProject =
    projects.find((project) => project.name === summary.projectName) ??
    projects.find((project) => project.worktrees?.some((worktree) => normalizeWorktreePath(worktree.path) === normalizeWorktreePath(summary.cwd)));
  if (!matchedProject) {
    return summary;
  }

  return {
    ...summary,
    projectId: matchedProject.id,
    projectName: matchedProject.name,
    helmId: matchedProject.helmId,
    cwd: summary.cwd || resolveProjectCwd(matchedProject),
  };
}

export function alignSessionWorktreeBinding(
  summary: SessionSummary,
  worktrees: WorktreeSummary[],
): SessionSummary {
  const normalizedSummaryPath = normalizeWorktreePath(summary.cwd);
  const matchedWorktree = normalizedSummaryPath
    ? worktrees.find((worktree) => normalizeWorktreePath(worktree.path) === normalizedSummaryPath)
    : undefined;

  if (!matchedWorktree) {
    return summary;
  }

  return {
    ...summary,
    cwd: summary.cwd || matchedWorktree.path,
    worktreeName: matchedWorktree.name,
  };
}

function resolveProjectCwd(project: ProjectSummary) {
  return project.path || project.worktrees?.[0]?.path || "";
}

function normalizeWorktreePath(path: string | undefined) {
  return path?.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}
