import type {
  AcpAgentProvider,
  ProjectSummary,
  WorkspaceSummary,
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

export function defaultAgentId(agents: AcpAgentProvider[]) {
  return agents.find((agent) => agent.id)?.id ?? null;
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
  workspaces: WorkspaceSummary[],
) {
  const workspaceIds = new Set(project.workspaceIds ?? []);
  return workspaces.filter(
    (workspace) =>
      (workspaceIds.has(workspace.id) ||
        workspace.id.startsWith(`${project.id}-worktree-`)) &&
      isManagedWorktreeWorkspace(workspace),
  );
}

function isManagedWorktreeWorkspace(workspace: Pick<WorkspaceSummary, "id" | "path">) {
  const normalizedPath = workspace.path.replace(/\\/g, "/");
  return Boolean(
    workspace.id.includes("-worktree-") ||
      normalizedPath.includes("/.worktrees/") ||
      normalizedPath.includes("/.tiller/worktrees/"),
  );
}
