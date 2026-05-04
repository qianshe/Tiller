import type { ProjectSummary } from "@tiller/shared";

export function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "custom-agent"
  );
}

export function createProjectId(projects: ProjectSummary[]) {
  const usedIds = new Set(projects.map((project) => project.id));
  const maxNumericId = projects.reduce((max, project) => {
    const match = /^project-(\d+)$/u.exec(project.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  let next = Math.max(maxNumericId, projects.length) + 1;
  while (usedIds.has(`project-${next}`)) {
    next += 1;
  }
  return `project-${next}`;
}

export function splitArgs(value: string) {
  return value
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
