import type {
  AcpAgentProvider,
  ProjectSummary,
  WorktreeSummary,
} from "@tiller/shared";

type ConnectionState = "connecting" | "connected" | "disconnected";

type HelmCard = {
  key: string;
  isCurrent: boolean;
};

export function dedupeHelmCards<T extends HelmCard>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.key)) {
      return false;
    }
    seen.add(item.key);
    return true;
  });
}

export function resolveHelmConnectionState(
  helm: Pick<HelmCard, "key">,
  currentHelmKey: string,
  connection: ConnectionState,
  helmConnectionStates: Record<string, ConnectionState>,
) {
  if (helm.key === currentHelmKey) {
    return connection;
  }
  return helmConnectionStates[helm.key] ?? "disconnected";
}

export function createProjectId(projects: ProjectSummary[], projectName?: string) {
  const ids = new Set(projects.map((project) => project.id));
  const namedProjectId = sanitizeProjectId(projectName ?? "");
  if (namedProjectId) {
    return createUniqueProjectId(namedProjectId, ids);
  }

  let index = projects.length + 1;
  let candidate = `project-${index}`;
  while (ids.has(candidate)) {
    index += 1;
    candidate = `project-${index}`;
  }
  return candidate;
}

function createUniqueProjectId(baseId: string, ids: Set<string>) {
  if (!ids.has(baseId)) {
    return baseId;
  }

  let index = 2;
  let candidate = `${baseId}-${index}`;
  while (ids.has(candidate)) {
    index += 1;
    candidate = `${baseId}-${index}`;
  }
  return candidate;
}

function sanitizeProjectId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  );
}


export function resolveProjectDisplayId(
  project: ProjectSummary,
  siblings: ProjectSummary[],
) {
  const sameNameProjects = siblings.filter((item) => item.name === project.name);
  return sameNameProjects.length > 1 ? project.id : project.name;
}

export function resolveProjectWorktrees(
  project: ProjectSummary,
  worktrees: WorktreeSummary[],
) {
  const projectWorktrees = project.worktrees ?? [];
  if (projectWorktrees.length) {
    return projectWorktrees.filter(isManagedWorktreeWorktree);
  }
  const projectPath = normalizePath(project.path);
  return worktrees.filter((worktree) => {
    const worktreePath = normalizePath(worktree.path);
    return (
      Boolean(projectPath && worktreePath?.startsWith(`${projectPath}/`)) &&
      isManagedWorktreeWorktree(worktree)
    );
  });
}

function isManagedWorktreeWorktree(worktree: Pick<WorktreeSummary, "path">) {
  const normalizedPath = worktree.path.replace(/\\/g, "/");
  return Boolean(
    normalizedPath.includes("/.worktrees/") ||
      normalizedPath.includes("/.tiller/worktrees/"),
  );
}

function normalizePath(path: string | undefined) {
  return path?.replace(/\\/g, "/").replace(/\/+$/u, "");
}
