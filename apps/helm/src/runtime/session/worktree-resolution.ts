import type { ProjectSummary, SessionSummary, WorktreeSummary } from "@tiller/shared";

export function normalizeWorktreePath(path: string | undefined) {
  return path?.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}

export function resolveStoredSessionWorktree(input: {
  summary: SessionSummary;
  projects: ReadonlyArray<ProjectSummary>;
  worktrees: ReadonlyArray<WorktreeSummary>;
}): WorktreeSummary | undefined {
  const normalizedSummaryPath = normalizeWorktreePath(input.summary.cwd);
  const pathWorktree = normalizedSummaryPath
    ? input.worktrees.find((item) => normalizeWorktreePath(item.path) === normalizedSummaryPath)
    : undefined;
  if (pathWorktree) {
    return { ...pathWorktree, path: input.summary.cwd ?? pathWorktree.path };
  }

  const project = input.projects.find((item) => item.id === input.summary.projectId);
  if (project?.path) {
    return {
      name: input.summary.worktreeName || project.name,
      path: input.summary.cwd || project.path,
    } satisfies WorktreeSummary;
  }

  return undefined;
}
