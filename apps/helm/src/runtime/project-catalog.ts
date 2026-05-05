import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  listAvailableHelms as listConfiguredHelms,
  listAvailableProjects as listConfiguredProjects,
  listAvailableProviders,
  readTillerConfig,
} from "@tiller/agent-registry";
import type { AcpAgentProvider, HelmSummary, ProjectSummary, WorkspaceSummary } from "@tiller/shared";

type ProjectCatalogOptions = {
  configPath: string;
  host: string;
  port: number;
  defaultWorkspaceRoot: string;
};

export function createProjectCatalog(options: ProjectCatalogOptions) {
  const projectContextSummaryCache = new Map<string, string>();

  function loadAvailableHelms() {
    const configuredHelms = listConfiguredHelms(options.configPath);
    if (configuredHelms.length) {
      return configuredHelms;
    }

    return [
      {
        id: "local-helm",
        name: "Local Helm",
        host: options.host,
        port: options.port,
      },
    ] satisfies HelmSummary[];
  }

  function loadAvailableWorkspaces() {
    const configuredWorkspaces = dedupeWorkspaces(
      readTillerConfig(options.configPath).workspaces ?? [],
    );
    if (configuredWorkspaces.length) {
      return configuredWorkspaces;
    }

    return [
      {
        id: "current-workspace",
        name: basename(options.defaultWorkspaceRoot),
        path: options.defaultWorkspaceRoot.replace(/\\/g, "/"),
      },
    ];
  }

  function loadAvailableProjects(): ProjectSummary[] {
    const configuredProjects = listConfiguredProjects(options.configPath);
    const availableAgents = listAvailableProviders(options.configPath);
    if (configuredProjects.length) {
      return configuredProjects.map((project) => ({
        ...project,
        defaultAgentId: resolveDefaultProjectAgentId(availableAgents, project.defaultAgentId),
      }));
    }

    const helms = loadAvailableHelms();
    const workspaces = loadAvailableWorkspaces();
    const fallbackHelm = helms[0] ?? {
      id: "local-helm",
      name: "Local Helm",
      host: options.host,
      port: options.port,
    };
    return [
      {
        id: "current-project",
        name: basename(options.defaultWorkspaceRoot),
        helmId: fallbackHelm.id,
        workspaceIds: workspaces.map((workspace) => workspace.id),
        defaultWorkspaceId: workspaces[0]?.id,
        defaultAgentId: resolveDefaultProjectAgentId(availableAgents, undefined),
      },
    ] satisfies ProjectSummary[];
  }

  async function loadAvailableProjectsWithSemanticSummaries() {
    const baseProjects = loadAvailableProjects();
    return Promise.all(baseProjects.map((project) => enrichProjectSummary(project)));
  }

  async function enrichProjectSummary(project: ProjectSummary): Promise<ProjectSummary> {
    const projectWorkspaces = resolveProjectWorkspaces(project, loadAvailableWorkspaces());
    const cacheKey = [
      project.id,
      project.summary ?? "",
      projectWorkspaces
        .map((workspace) => `${workspace.id}:${workspace.path}:${workspace.summary ?? ""}`)
        .join("|"),
    ].join("::");
    const cached = projectContextSummaryCache.get(cacheKey);
    if (cached) {
      return { ...project, summary: cached };
    }

    const source = await collectProjectSummarySource(project, projectWorkspaces);
    const summary = compactProjectContextSource(source) || project.summary;
    if (!summary) {
      return project;
    }
    projectContextSummaryCache.set(cacheKey, summary);
    return { ...project, summary };
  }

  return {
    loadAvailableHelms,
    loadAvailableProjects,
    loadAvailableProjectsWithSemanticSummaries,
    loadAvailableWorkspaces,
    resolveDefaultProjectAgentId,
  };
}

function dedupeWorkspaces(items: WorkspaceSummary[]) {
  const seen = new Set<string>();
  const next: WorkspaceSummary[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    next.push(item);
  }
  return next;
}

function resolveDefaultProjectAgentId(
  agents: AcpAgentProvider[],
  existingDefaultAgentId: string | undefined,
) {
  const codex = agents.find((agent) => agent.id === "codex");
  return codex?.id ?? existingDefaultAgentId ?? agents[0]?.id;
}

function resolveProjectWorkspaces(
  project: ProjectSummary,
  availableWorkspaces: WorkspaceSummary[],
) {
  return project.workspaceIds?.length
    ? availableWorkspaces.filter((workspace) => project.workspaceIds?.includes(workspace.id))
    : availableWorkspaces;
}

function sanitizeConfiguredProjectSummary(projectName: string, summary: string | undefined) {
  const normalized = summary?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  const generatedPrefix = `Project: ${projectName} Configured summary:`;
  const withoutGeneratedPrefix = normalized.includes(generatedPrefix)
    ? (normalized
        .split(generatedPrefix)
        .map((part) => part.trim())
        .filter(Boolean)[0] ?? normalized.replaceAll(generatedPrefix, "").trim())
    : normalized;
  const compact = withoutGeneratedPrefix || normalized;
  return compact.length > 900 ? `${compact.slice(0, 900)}…` : compact;
}

async function collectProjectSummarySource(
  project: ProjectSummary,
  projectWorkspaces: WorkspaceSummary[],
) {
  const configuredSummary = sanitizeConfiguredProjectSummary(project.name, project.summary);
  const snippets = await Promise.all(
    projectWorkspaces.slice(0, 3).map(async (workspace) => {
      const agents = await readOptionalSnippet(resolve(workspace.path, "AGENTS.md"), 2800);
      const claude = await readOptionalSnippet(resolve(workspace.path, "CLAUDE.md"), 2200);
      const readme = await readOptionalSnippet(resolve(workspace.path, "README.md"), 1600);
      const packageJson = await readOptionalSnippet(resolve(workspace.path, "package.json"), 1000);
      return [
        `Workspace: ${workspace.name}`,
        `Path: ${workspace.path}`,
        workspace.summary ? `Workspace summary: ${workspace.summary}` : "",
        agents ? `AGENTS.md:\n${agents}` : "",
        claude ? `CLAUDE.md:\n${claude}` : "",
        readme ? `README.md:\n${readme}` : "",
        packageJson ? `package.json:\n${packageJson}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }),
  );

  return [
    `Project: ${project.name}`,
    configuredSummary ? `Configured summary: ${configuredSummary}` : "",
    ...snippets,
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 9000);
}

function compactProjectContextSource(source: string) {
  return source
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 72)
    .join("\n")
    .slice(0, 5000);
}

async function readOptionalSnippet(path: string, maxLength: number) {
  try {
    return (await readFile(path, "utf8")).slice(0, maxLength);
  } catch {
    return "";
  }
}
