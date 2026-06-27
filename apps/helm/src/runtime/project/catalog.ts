import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  listAvailableHelms as listConfiguredHelms,
  listAvailableProjects as listConfiguredProjects,
} from "@tiller/agent-registry";
import type { HelmSummary, ProjectSummary, WorktreeSummary } from "@tiller/shared";
import { loadProjectSummarySource } from "./summary-source.js";

type ProjectCatalogOptions = {
  configPath: string;
  host: string;
  port: number;
  defaultWorktreeRoot: string;
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

  function loadAvailableWorktrees() {
    const configuredWorktrees = dedupeWorktrees(
      listConfiguredProjects(options.configPath).flatMap(projectWorktrees),
    );
    if (configuredWorktrees.length) {
      return configuredWorktrees;
    }

    return [
      {
        name: basename(options.defaultWorktreeRoot),
        path: options.defaultWorktreeRoot.replace(/\\/g, "/"),
      },
    ];
  }

  function loadAvailableProjects(): ProjectSummary[] {
    const configuredProjects = listConfiguredProjects(options.configPath);
    if (configuredProjects.length) {
      return configuredProjects;
    }

    const helms = loadAvailableHelms();
    const worktrees = loadAvailableWorktrees();
    const fallbackHelm = helms[0] ?? {
      id: "local-helm",
      name: "Local Helm",
      host: options.host,
      port: options.port,
    };
    return [
      {
        id: "current-project",
        name: basename(options.defaultWorktreeRoot),
        helmId: fallbackHelm.id,
        path: options.defaultWorktreeRoot,
        worktrees,
      },
    ] satisfies ProjectSummary[];
  }

  async function loadAvailableProjectsWithSemanticSummaries() {
    const baseProjects = loadAvailableProjects();
    return Promise.all(baseProjects.map((project) => enrichProjectSummary(project)));
  }

  async function enrichProjectSummary(project: ProjectSummary): Promise<ProjectSummary> {
    const projectWorktrees = resolveProjectWorktrees(project, loadAvailableWorktrees());
    const cacheKey = [
      project.id,
      project.summary ?? "",
      project.summaryFile ?? "",
      projectWorktrees
        .map((worktree) => `${worktree.path}:${worktree.summary ?? ""}`)
        .join("|"),
    ].join("::");
    const cached = projectContextSummaryCache.get(cacheKey);
    if (cached) {
      return { ...project, summary: cached };
    }

    const source = await collectProjectSummarySource(project, projectWorktrees);
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
    loadAvailableWorktrees,
  };
}

function projectWorktrees(project: ProjectSummary): WorktreeSummary[] {
  if (project.worktrees?.length) {
    return project.worktrees;
  }
  if (!project.path) {
    return [];
  }
  return [
    {
      name: basename(normalizeWorktreePath(project.path)),
      path: normalizeWorktreePath(project.path),
      branch: project.gitCurrentBranch,
      kind: "root",
      summary: project.summary,
    },
  ];
}

function normalizeWorktreePath(path: string) {
  return path.replace(/\\/g, "/");
}

function dedupeWorktrees(items: WorktreeSummary[]) {
  const seen = new Set<string>();
  const next: WorktreeSummary[] = [];
  for (const item of items) {
    const key = normalizeWorktreePath(item.path).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(item);
  }
  return next;
}


function resolveProjectWorktrees(
  project: ProjectSummary,
  availableWorktrees: WorktreeSummary[],
) {
  return project.worktrees?.length
    ? project.worktrees
    : availableWorktrees;
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
  projectWorktrees: WorktreeSummary[],
) {
  const summarySource = await loadProjectSummarySource({
    project,
    worktrees: projectWorktrees,
  });
  const configuredSummary = sanitizeConfiguredProjectSummary(project.name, summarySource?.content);
  const snippets = await Promise.all(
    projectWorktrees.slice(0, 3).map(async (worktree) => {
      const agents = await readOptionalSnippet(resolve(worktree.path, "AGENTS.md"), 2800);
      const claude = await readOptionalSnippet(resolve(worktree.path, "CLAUDE.md"), 2200);
      const readme = await readOptionalSnippet(resolve(worktree.path, "README.md"), 1600);
      const packageJson = await readOptionalSnippet(resolve(worktree.path, "package.json"), 1000);
      return [
        `Worktree: ${worktree.name}`,
        `Path: ${worktree.path}`,
        worktree.summary ? `Worktree summary: ${worktree.summary}` : "",
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
