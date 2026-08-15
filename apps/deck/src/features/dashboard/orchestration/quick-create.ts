import type {
  AcpAgentProvider,
  ProjectSummary,
  SessionStatus,
  SessionSummary,
  WorktreeSummary,
} from "@tiller/shared";
import { daemonProfileKey } from "../../helm-connection/facade";
import type {
  DashboardQuickCreateAgent,
  DashboardQuickCreateHelm,
  DashboardQuickCreateProject,
} from "../types";

type DashboardQuickCreateInventory = {
  projects?: readonly ProjectSummary[];
  agents?: readonly AcpAgentProvider[];
  sessions?: readonly SessionSummary[];
  statuses?: Readonly<Record<string, SessionStatus | undefined>>;
};

type DashboardQuickCreateHelmProfile = {
  id?: string;
  name?: string;
  host: string;
  port: string | number;
};

export type BuildDashboardQuickCreateProjectsInput = {
  currentHelmKey: string;
  currentHelm?: {
    name?: string;
    host?: string;
    port?: string | number;
  } | null;
  currentProjects: readonly ProjectSummary[];
  currentAgents: readonly AcpAgentProvider[];
  currentSessions?: readonly SessionSummary[];
  currentStatuses?: Readonly<Record<string, SessionStatus | undefined>>;
  daemonProfiles: readonly DashboardQuickCreateHelmProfile[];
  helmInventories: Record<string, DashboardQuickCreateInventory | undefined>;
};

type QuickCreateHelmSource = {
  key: string;
  name: string;
  endpoint: string;
  projects: readonly ProjectSummary[];
  agents: readonly AcpAgentProvider[];
  sessions: readonly SessionSummary[];
  statuses: Readonly<Record<string, SessionStatus | undefined>>;
};

function formatEndpoint(host: string | undefined, port: string | number | undefined, fallback: string) {
  const normalizedHost = host?.trim();
  const normalizedPort = String(port ?? "").trim();
  return normalizedHost && normalizedPort ? `${normalizedHost}:${normalizedPort}` : fallback;
}

function normalizeHelmKey(key: string) {
  const trimmedKey = key.trim();
  const separatorIndex = trimmedKey.lastIndexOf(":");
  if (separatorIndex <= 0 || separatorIndex === trimmedKey.length - 1) {
    return trimmedKey;
  }
  return daemonProfileKey(
    trimmedKey.slice(0, separatorIndex),
    trimmedKey.slice(separatorIndex + 1),
  );
}

function findHelmInventory(
  helmInventories: Record<string, DashboardQuickCreateInventory | undefined>,
  helmKey: string,
) {
  return Object.entries(helmInventories).find(
    ([inventoryKey]) => normalizeHelmKey(inventoryKey) === helmKey,
  )?.[1];
}

type QuickCreateWorktreeTarget = {
  path: string;
  branch: string;
};

function normalizePath(path: string | undefined) {
  return path?.replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
}

function worktreeTarget(worktree: WorktreeSummary, project: ProjectSummary): QuickCreateWorktreeTarget | null {
  const path = worktree.path.trim();
  if (!path) {
    return null;
  }

  const isProjectRoot = normalizePath(path) === normalizePath(project.path);
  const branch = worktree.branch?.trim() || (isProjectRoot ? project.gitCurrentBranch?.trim() : undefined);
  if (!branch) {
    return null;
  }

  return { path, branch };
}

function projectWorktreeTargets(project: ProjectSummary): QuickCreateWorktreeTarget[] {
  const configuredWorktrees = project.worktrees ?? [];
  const targets = configuredWorktrees
    .map((worktree) => worktreeTarget(worktree, project))
    .filter((target): target is QuickCreateWorktreeTarget => target !== null);

  const projectPath = project.path?.trim();
  const currentBranch = project.gitCurrentBranch?.trim();
  const hasProjectRoot = targets.some(
    (target) => normalizePath(target.path) === normalizePath(projectPath),
  );
  if (projectPath && currentBranch && !hasProjectRoot) {
    targets.unshift({ path: projectPath, branch: currentBranch });
  }

  const uniqueTargets = new Map<string, QuickCreateWorktreeTarget>();
  for (const target of targets) {
    uniqueTargets.set(normalizePath(target.path) ?? target.path, target);
  }
  return Array.from(uniqueTargets.values());
}

function projectAgents(agents: readonly AcpAgentProvider[]): DashboardQuickCreateAgent[] {
  return agents.map((agent) => ({ id: agent.id, name: agent.name || agent.id }));
}

function projectIdleSessions(
  source: QuickCreateHelmSource,
  project: ProjectSummary,
  target: QuickCreateWorktreeTarget,
) {
  return source.sessions
    .filter((session) =>
      session.projectId === project.id &&
      normalizePath(session.cwd) === normalizePath(target.path) &&
      (source.statuses[session.id] ?? session.status) === "idle" &&
      Boolean(session.agentId?.trim()) &&
      Boolean((session.runtimeSessionId ?? session.resume?.runtimeSessionId)?.trim())
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((session) => ({
      id: session.id,
      title: session.title?.trim() || session.lastMessagePreview?.trim() || session.id,
      agentId: session.agentId,
      agentName: session.agentName || session.agentId,
      updatedAt: session.updatedAt,
    }));
}

function addSource(
  sources: Map<string, QuickCreateHelmSource>,
  source: QuickCreateHelmSource,
) {
  if (!sources.has(source.key)) {
    sources.set(source.key, source);
  }
}

function collectQuickCreateHelmSources({
  currentHelmKey,
  currentHelm,
  currentProjects,
  currentAgents,
  currentSessions = [],
  currentStatuses = {},
  daemonProfiles,
  helmInventories,
}: BuildDashboardQuickCreateProjectsInput): QuickCreateHelmSource[] {
  const sources = new Map<string, QuickCreateHelmSource>();
  const normalizedCurrentHelmKey = currentHelm?.host && currentHelm.port != null
    ? daemonProfileKey(currentHelm.host, String(currentHelm.port))
    : normalizeHelmKey(currentHelmKey);
  const currentEndpoint = formatEndpoint(
    currentHelm?.host,
    currentHelm?.port,
    currentHelmKey,
  );
  addSource(sources, {
    key: normalizedCurrentHelmKey,
    name: currentHelm?.name?.trim() || "Local Helm",
    endpoint: currentEndpoint,
    projects: currentProjects,
    agents: currentAgents,
    sessions: currentSessions,
    statuses: currentStatuses,
  });

  for (const profile of daemonProfiles) {
    const key = daemonProfileKey(profile.host, String(profile.port));
    if (key === normalizedCurrentHelmKey) {
      continue;
    }
    const inventory = findHelmInventory(helmInventories, key);
    addSource(sources, {
      key,
      name: profile.name?.trim() || key,
      endpoint: formatEndpoint(profile.host, profile.port, key),
      projects: inventory?.projects ?? [],
      agents: inventory?.agents ?? [],
      sessions: inventory?.sessions ?? [],
      statuses: inventory?.statuses ?? {},
    });
  }

  for (const [key, inventory] of Object.entries(helmInventories)) {
    const normalizedKey = normalizeHelmKey(key);
    if (normalizedKey === normalizedCurrentHelmKey || sources.has(normalizedKey)) {
      continue;
    }
    addSource(sources, {
      key: normalizedKey,
      name: key,
      endpoint: key,
      projects: inventory?.projects ?? [],
      agents: inventory?.agents ?? [],
      sessions: inventory?.sessions ?? [],
      statuses: inventory?.statuses ?? {},
    });
  }

  return Array.from(sources.values());
}

export function buildDashboardQuickCreateHelms(
  input: BuildDashboardQuickCreateProjectsInput,
): DashboardQuickCreateHelm[] {
  return collectQuickCreateHelmSources(input).map((source) => ({
    key: source.key,
    name: source.name,
    endpoint: source.endpoint,
    agents: projectAgents(source.agents),
  }));
}

export function buildDashboardQuickCreateProjects(
  input: BuildDashboardQuickCreateProjectsInput,
): DashboardQuickCreateProject[] {
  return collectQuickCreateHelmSources(input).flatMap((source) => {
    const agents = projectAgents(source.agents);
    return source.projects.flatMap((project) =>
      projectWorktreeTargets(project).map((target) => ({
        key: `${source.key}::${project.id}::${target.path}`,
        id: project.id,
        projectId: project.id,
        name: project.name || project.id,
        branch: target.branch,
        cwd: target.path,
        helmKey: source.key,
        helmName: source.name,
        helmEndpoint: source.endpoint,
        agents,
        idleSessions: projectIdleSessions(source, project, target),
      })),
    );
  });
}
