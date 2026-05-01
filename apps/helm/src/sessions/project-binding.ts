import type { ProjectSummary, SessionSummary } from "@tiller/shared";

export function alignSessionProjectBinding(summary: SessionSummary, projects: ProjectSummary[]): SessionSummary {
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
