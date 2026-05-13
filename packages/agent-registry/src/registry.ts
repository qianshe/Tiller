import { resolveSessionConfigSupport, type AcpAgentProvider, type HelmSummary, type ProjectSummary, type WorktreeSummary } from "@tiller/shared";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const LEGACY_WORKSPACE_IDS = `workspace${"Ids"}` as const;
const LEGACY_DEFAULT_WORKSPACE_ID = `defaultWorkspace${"Id"}` as const;
const LEGACY_DEFAULT_AGENT_ID = `defaultAgent${"Id"}` as const;

export type TillerConfig = {
  helms?: HelmSummary[];
  agents?: AcpAgentProvider[];
  worktrees?: WorktreeSummary[];
  daemon?: {
    host?: string;
    port?: number;
    auth?: "none" | "pairing";
  };
  updates?: {
    checkOnStart?: boolean;
    previewHint?: boolean;
  };
};

type LegacyProjectSummary = ProjectSummary & {
  worktreeIds?: string[];
  [LEGACY_WORKSPACE_IDS]?: string[];
  defaultWorktreeId?: string;
  [LEGACY_DEFAULT_WORKSPACE_ID]?: string;
  [LEGACY_DEFAULT_AGENT_ID]?: string;
};

type LegacyTillerConfig = TillerConfig & {
  projects?: LegacyProjectSummary[];
  worktrees?: Array<WorktreeSummary & { id?: string }>;
  workspaces?: Array<WorktreeSummary & { id?: string }>;
};

const DEFAULT_DAEMON_CONFIG: NonNullable<TillerConfig["daemon"]> = {
  host: "127.0.0.1",
  port: 47631,
  auth: "none",
};

function resolveDaemonConfig(daemon: TillerConfig["daemon"]) {
  if (!daemon) {
    return DEFAULT_DAEMON_CONFIG;
  }
  if (daemon.auth) {
    return daemon;
  }
  return { ...daemon, auth: "none" as const };
}

export function resolveProviderById(id: string, providers: AcpAgentProvider[]) {
  return providers.find((provider) => provider.id === id);
}

export function resolveHelmById(id: string, helms: HelmSummary[]) {
  return helms.find((helm) => helm.id === id);
}

export function resolveProjectById(id: string, projects: ProjectSummary[]) {
  return projects.find((project) => project.id === id);
}

function hydrateProvider(provider: AcpAgentProvider): AcpAgentProvider {
  const normalized = normalizeLegacyProvider(provider);
  const sessionConfig = resolveLegacySessionConfigSupport(normalized);
  return {
    ...normalized,
    capabilities: {
      ...normalized.capabilities,
      sessionConfig: {
        model: sessionConfig.model,
        reasoningEffort: sessionConfig.reasoningEffort,
        modelFormat: sessionConfig.modelFormat,
        ...normalized.capabilities?.sessionConfig,
      },
    },
  };
}

function resolveLegacySessionConfigSupport(provider: AcpAgentProvider) {
  if (provider.capabilities?.sessionConfig) {
    return resolveSessionConfigSupport(provider);
  }
  if (provider.command === "codex-acp") {
    return { model: "startup" as const, reasoningEffort: "startup" as const, modelFormat: "model" as const };
  }
  if (provider.command === "opencode") {
    return { model: "startup" as const, reasoningEffort: "none" as const, modelFormat: "provider/model" as const };
  }
  return resolveSessionConfigSupport(provider);
}

function normalizeLegacyProvider(provider: AcpAgentProvider): AcpAgentProvider {
  const name = provider.name === "CloudeCode" ? "ClaudeCode" : provider.name;
  const id = provider.id === "cloudecode" ? "claudecode" : provider.id;
  return name === provider.name && id === provider.id ? provider : { ...provider, id, name };
}

export function getDefaultConfigPath() {
  return join(homedir(), ".tiller", "config.json");
}

export function getProjectsDir(configPath = getDefaultConfigPath()) {
  return join(dirname(configPath), "projects");
}

export function projectYamlPath(projectId: string, configPath = getDefaultConfigPath()) {
  return join(getProjectsDir(configPath), slugProjectId(projectId), "project.yaml");
}

function slugProjectId(projectId: string) {
  return projectId.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

export function loadTillerConfigStub(configPath = getDefaultConfigPath()) {
  if (!existsSync(configPath)) {
    return {
      configPath,
      exists: false,
      raw: null,
    };
  }

  return {
    configPath,
    exists: true,
    raw: readFileSync(configPath, "utf8"),
  };
}

export function readTillerConfig(configPath = getDefaultConfigPath()): TillerConfig {
  const stub = loadTillerConfigStub(configPath);
  if (!stub.exists || !stub.raw) {
    return {};
  }

  return stripProjectState(parseTillerConfig(stub.raw, configPath));
}

export function ensureTillerConfigDefaults(configPath = getDefaultConfigPath()) {
  const legacy = readRawTillerConfig(configPath);
  const migrated = migrateLegacyProjectState(legacy, configPath);
  const current = migrated.config;
  const nextDaemon = resolveDaemonConfig(current.daemon);
  const updated = migrated.updated || current.daemon !== nextDaemon;
  if (updated) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ ...current, daemon: nextDaemon }, null, 2), "utf8");
  }
  return { configPath, updated };
}

function readRawTillerConfig(configPath: string): LegacyTillerConfig {
  const stub = loadTillerConfigStub(configPath);
  if (!stub.exists || !stub.raw) {
    return {};
  }
  return parseTillerConfig(stub.raw, configPath) as LegacyTillerConfig;
}

function stripProjectState(config: LegacyTillerConfig): TillerConfig {
  return {
    helms: config.helms ?? [],
    agents: config.agents ?? [],
    daemon: config.daemon,
    updates: config.updates,
  };
}

export function parseTillerConfig(raw: string, configPath = "<memory>"): TillerConfig {
  try {
    return JSON.parse(raw) as TillerConfig;
  } catch (error) {
    try {
      return JSON.parse(stripJsonTrailingCommas(raw)) as TillerConfig;
    } catch {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid Tiller config JSON at ${configPath}: ${message}`);
    }
  }
}

function stripJsonTrailingCommas(raw: string) {
  return raw.replace(/,(\s*[}\]])/g, "$1");
}

function migrateLegacyProjectState(config: LegacyTillerConfig, configPath: string) {
  const legacyProjects = config.projects ?? [];
  const legacyWorktrees = [...(config.worktrees ?? []), ...(config.workspaces ?? [])];
  if (!legacyProjects.length && !("projects" in config) && !("workspaces" in config) && !("worktrees" in config)) {
    return { config: stripProjectState(config), updated: false };
  }

  if (existsSync(configPath)) {
    const backupPath = `${configPath}.bak`;
    if (!existsSync(backupPath)) {
      writeFileSync(backupPath, readFileSync(configPath, "utf8"), "utf8");
    }
  }

  for (const legacyProject of legacyProjects) {
    const project = normalizeLegacyProject(legacyProject, legacyWorktrees);
    const path = projectYamlPath(project.id, configPath);
    if (existsSync(path)) {
      const backupPath = `${path}.bak`;
      if (!existsSync(backupPath)) {
        writeFileSync(backupPath, readFileSync(path, "utf8"), "utf8");
      }
    }
    saveProjectYaml(project, configPath);
  }

  return { config: stripProjectState(config), updated: true };
}

function normalizeLegacyProject(
  project: LegacyProjectSummary,
  legacyWorktrees: Array<WorktreeSummary & { id?: string }>,
): ProjectSummary {
  const legacyIds = new Set([...(project.worktreeIds ?? []), ...(project[LEGACY_WORKSPACE_IDS] ?? [])]);
  const matchedById = legacyWorktrees.filter((item) => item.id && legacyIds.has(item.id));
  const matchedByPath = legacyWorktrees.filter(
    (item) => project.path && normalizePath(item.path) === normalizePath(project.path),
  );
  const worktrees = dedupeWorktrees([...matchedById, ...matchedByPath].map((item) => ({
    name: item.name,
    path: item.path,
    branch: item.branch ?? item.name,
    kind: normalizePath(item.path) === normalizePath(project.path) ? "root" as const : (item.kind ?? "git-worktree" as const),
    summary: item.summary,
  })));
  if (project.path && !worktrees.some((item) => normalizePath(item.path) === normalizePath(project.path))) {
    worktrees.unshift({
      name: project.gitCurrentBranch ?? basename(project.path),
      path: project.path,
      branch: project.gitCurrentBranch,
      kind: "root",
    });
  }

  return {
    id: project.id,
    name: project.name,
    helmId: project.helmId,
    path: project.path,
    summary: project.summary,
    gitBranches: project.gitBranches,
    gitCurrentBranch: project.gitCurrentBranch,
    worktrees,
  };
}

function normalizePath(path: string | undefined) {
  return path?.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function dedupeWorktrees(items: WorktreeSummary[]) {
  const byPath = new Map<string, WorktreeSummary>();
  for (const item of items) {
    byPath.set(normalizePath(item.path) ?? item.path, item);
  }
  return Array.from(byPath.values());
}

export function listAvailableHelms(configPath = getDefaultConfigPath()) {
  return readTillerConfig(configPath).helms ?? [];
}

export function listProjectFiles(configPath = getDefaultConfigPath()) {
  const projectsDir = getProjectsDir(configPath);
  if (!existsSync(projectsDir)) {
    return [] as string[];
  }
  return readdirSync(projectsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(projectsDir, entry.name, "project.yaml"))
    .filter((path) => existsSync(path));
}

export function listAvailableProjects(configPath = getDefaultConfigPath()) {
  return listProjectFiles(configPath).map((path) => readProjectYamlFile(path));
}

export function readProjectYaml(projectId: string, configPath = getDefaultConfigPath()) {
  return readProjectYamlFile(projectYamlPath(projectId, configPath));
}

function sanitizeProjectYaml(project: ProjectSummary): ProjectSummary {
  const record = project as ProjectSummary & Record<string, unknown>;
  const legacyKeys = [
    ["workspace", "Ids"].join(""),
    ["default", "Workspace", "Id"].join(""),
    ["default", "Agent", "Id"].join(""),
    "workspaces",
  ];
  const sanitized: Record<string, unknown> = { ...record };
  for (const key of legacyKeys) {
    delete sanitized[key];
  }
  return {
    id: String(sanitized.id),
    name: String(sanitized.name),
    helmId: String(sanitized.helmId),
    path: typeof sanitized.path === "string" ? sanitized.path : undefined,
    summary: typeof sanitized.summary === "string" ? sanitized.summary : undefined,
    gitBranches: Array.isArray(sanitized.gitBranches)
      ? sanitized.gitBranches.filter((branch): branch is string => typeof branch === "string")
      : undefined,
    gitCurrentBranch:
      typeof sanitized.gitCurrentBranch === "string" ? sanitized.gitCurrentBranch : undefined,
    worktrees: dedupeWorktrees((sanitized.worktrees as WorktreeSummary[] | undefined) ?? []),
  };
}

function readProjectYamlFile(path: string): ProjectSummary {
  const raw = readFileSync(path, "utf8");
  const parsed = parseYaml(raw) as ProjectSummary;
  const project = sanitizeProjectYaml(parsed);
  const normalized = stringifyYaml(project);
  if (normalized !== raw) {
    writeFileSync(path, normalized, "utf8");
  }
  return project;
}

export function saveProjectYaml(project: ProjectSummary, configPath = getDefaultConfigPath()) {
  const sanitized = sanitizeProjectYaml(project);
  const path = projectYamlPath(sanitized.id, configPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyYaml(sanitized), "utf8");
  return { configPath: path, project: sanitized };
}


export function saveWorktreeToConfig(worktree: WorktreeSummary, configPath = getDefaultConfigPath()) {
  const projects = listAvailableProjects(configPath);
  const project = projects.find((item) =>
    item.path && normalizePath(item.path) === normalizePath(worktree.path),
  ) ?? projects[0];
  if (!project) {
    return { configPath, worktree };
  }
  const worktrees = dedupeWorktrees([...(project.worktrees ?? []), worktree]);
  saveProjectYaml({ ...project, worktrees }, configPath);
  return { configPath: projectYamlPath(project.id, configPath), worktree };
}

export function deleteWorktreesFromConfig(cwds: string[], configPath = getDefaultConfigPath()) {
  const remove = new Set(cwds.map((item) => normalizePath(item)));
  let deleted = 0;
  for (const project of listAvailableProjects(configPath)) {
    const before = project.worktrees ?? [];
    const worktrees = before.filter((item) => !remove.has(normalizePath(item.path)));
    deleted += before.length - worktrees.length;
    if (worktrees.length !== before.length) {
      saveProjectYaml({ ...project, worktrees }, configPath);
    }
  }
  return { configPath, deleted };
}

export const saveProjectToConfig = saveProjectYaml;

export function deleteProjectYaml(projectId: string, configPath = getDefaultConfigPath()) {
  const path = projectYamlPath(projectId, configPath);
  const deleted = existsSync(path);
  if (deleted) {
    rmSync(dirname(path), { recursive: true, force: true });
  }
  return { configPath: path, projectId, deleted };
}

export const deleteProjectFromConfig = deleteProjectYaml;

export function getConfiguredProviders(configPath = getDefaultConfigPath()) {
  return (readTillerConfig(configPath).agents ?? []).map(hydrateProvider);
}

export function listAvailableProviders(configPath = getDefaultConfigPath()) {
  return getConfiguredProviders(configPath);
}

export function saveHelmToConfig(helm: HelmSummary, configPath = getDefaultConfigPath()) {
  const current = readTillerConfig(configPath);
  const nextHelms = [...(current.helms ?? []).filter((item) => item.id !== helm.id), helm];
  return writeGlobalConfig({ ...current, helms: nextHelms, daemon: resolveDaemonConfig(current.daemon) }, configPath, { helm });
}

export function saveProviderToConfig(provider: AcpAgentProvider, configPath = getDefaultConfigPath()) {
  const current = readTillerConfig(configPath);
  const normalizedProvider = hydrateProvider(provider);
  const nextAgents = [
    ...(current.agents ?? []).filter(
      (item) => normalizeLegacyProvider(item).id !== normalizedProvider.id,
    ),
    normalizedProvider,
  ];
  return writeGlobalConfig({ ...current, agents: nextAgents, daemon: resolveDaemonConfig(current.daemon) }, configPath, { provider: normalizedProvider });
}

export function deleteProviderFromConfig(providerId: string, configPath = getDefaultConfigPath()) {
  const current = readTillerConfig(configPath);
  const nextAgents = (current.agents ?? []).filter(
    (item) => normalizeLegacyProvider(item).id !== providerId,
  );
  return writeGlobalConfig({ ...current, agents: nextAgents, daemon: resolveDaemonConfig(current.daemon) }, configPath, {
    providerId,
    deleted: nextAgents.length !== (current.agents ?? []).length,
  });
}

function writeGlobalConfig<T extends Record<string, unknown>>(config: TillerConfig, configPath: string, result: T) {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(stripProjectState(config), null, 2), "utf8");
  return { configPath, ...result };
}
