import type { ProjectSummary, WorkspaceSummary } from "@tiller/shared";

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

export function resolveProjectWorkspaceLabel(
  project: ProjectSummary,
  workspaces: WorkspaceSummary[],
) {
  const workspaceId = project.defaultWorkspaceId ?? project.workspaceIds?.[0];
  const workspace = workspaceId
    ? workspaces.find((item) => item.id === workspaceId)
    : undefined;
  return workspace?.name ?? project.gitCurrentBranch ?? workspaceId ?? "-";
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
