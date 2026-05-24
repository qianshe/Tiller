import { basename } from "node:path";
import type { ProjectSummary, WorktreeSummary } from "@tiller/shared";

export function resolveProjectSessionWorktree(
  project: ProjectSummary,
  worktrees: WorktreeSummary[],
  params: { cwd: string },
) {
  const requestedCwd = params.cwd.trim();
  const normalizedCwd = normalizeWorktreePath(requestedCwd);
  const worktree = worktrees.find(
    (item) => normalizeWorktreePath(item.path) === normalizedCwd,
  );
  return {
    name: worktree?.name ?? basename(normalizedCwd) ?? project.name,
    path: requestedCwd,
    summary: worktree?.summary,
  } satisfies WorktreeSummary;
}

function normalizeWorktreePath(path: string) {
  return path.replace(/\\/gu, "/").replace(/\/+$/u, "").toLowerCase();
}
