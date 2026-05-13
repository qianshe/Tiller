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

export function createProjectId(projects: ProjectSummary[]) {
  let index = projects.length + 1;
  let candidate = `project-${index}`;
  const ids = new Set(projects.map((project) => project.id));
  while (ids.has(candidate)) {
    index += 1;
    candidate = `project-${index}`;
  }
  return candidate;
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
  const sameNameProjects = siblings.filter(
    (item) => item.name === project.name,
  );
  return sameNameProjects.length > 1 ? project.id : project.name;
}

export function resolveProjectWorktreeLabel(
  project: ProjectSummary,
  worktrees: WorktreeSummary[],
) {
  const projectWorktree = project.worktrees?.[0];
  const worktree = projectWorktree
    ? worktrees.find((item) => normalizePath(item.path) === normalizePath(projectWorktree.path))
    : undefined;
  return (
    worktree?.name ?? projectWorktree?.name ?? project.gitCurrentBranch ?? "-"
  );
}

function normalizePath(path: string | undefined) {
  return path?.replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
}
