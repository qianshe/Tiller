import type { ProjectSummary, WorktreeSummary } from "@tiller/shared";

export function formatProjectSummaryForDisplay(
  summary: string | undefined,
  projectName: string,
) {
  const normalized = summary?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "暂无项目摘要";
  }

  const generatedPrefix = `Project: ${projectName} Configured summary:`;
  const withoutGeneratedPrefix = normalized.includes(generatedPrefix)
    ? (normalized
        .split(generatedPrefix)
        .map((part) => part.trim())
        .filter(Boolean)[0] ??
      normalized.replaceAll(generatedPrefix, "").trim())
    : normalized;
  const compact = withoutGeneratedPrefix || normalized;
  return compact.length > 360 ? `${compact.slice(0, 360)}…` : compact;
}

export function resolveProjectWorktreeLabel(
  project: ProjectSummary,
  worktrees: WorktreeSummary[],
) {
  const projectWorktree = project.worktrees?.[0];
  const worktree = projectWorktree
    ? worktrees.find(
        (item) => normalizePath(item.path) === normalizePath(projectWorktree.path),
      )
    : undefined;
  return worktree?.name ?? projectWorktree?.name ?? project.gitCurrentBranch ?? "-";
}

function normalizePath(path: string | undefined) {
  return path?.replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
}

export function resolveProjectDisplayId(
  project: ProjectSummary,
  projects: ProjectSummary[],
) {
  const numericId = /^project-\d+$/u.test(project.id) ? project.id : null;
  if (numericId) {
    return numericId;
  }
  const index = projects.findIndex((item) => item.id === project.id);
  return `project-${index >= 0 ? index + 1 : projects.length + 1}`;
}
