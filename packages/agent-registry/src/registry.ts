import { resolveSessionConfigSupport, type AcpAgentProvider, type ApprovalPolicy, type HelmSummary, type ProjectSummary, type WorktreeSummary } from "@tiller/shared";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
  logging?: {
    level?: string;
    format?: string;
    acpTrace?: string;
  };
  approvalPolicy?: ApprovalPolicy;
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
  return join(homedir(), ".config", "tiller", "config.json");
}

function resolveLegacyConfigDir(configPath: string) {
  const configDir = dirname(configPath);
  const configParent = dirname(configDir);
  if (basename(configDir) !== "tiller" || basename(configParent) !== ".config") {
    return null;
  }
  return join(dirname(configParent), ".tiller");
}

function migrateLegacyConfigDir(configPath: string) {
  const legacyConfigDir = resolveLegacyConfigDir(configPath);
  const configDir = dirname(configPath);
  if (!legacyConfigDir || existsSync(configDir) || !existsSync(legacyConfigDir)) {
    return;
  }

  mkdirSync(dirname(configDir), { recursive: true });
  renameSync(legacyConfigDir, configDir);
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

function isGenericProjectId(projectId: string) {
  return /^project-\d+$/u.test(projectId);
}

function projectStoragePath(project: Pick<ProjectSummary, "id" | "name">, configPath: string) {
  if (isGenericProjectId(project.id)) {
    return join(getProjectsDir(configPath), slugProjectId(project.name), "project.yaml");
  }
  return projectYamlPath(project.id, configPath);
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
  migrateLegacyConfigDir(configPath);
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
  const next: TillerConfig = {};
  if (config.helms?.length) {
    next.helms = config.helms;
  }
  const agents = (config.agents ?? []).map(sanitizeProviderForConfig);
  if (agents.length) {
    next.agents = agents;
  }
  if (config.daemon) {
    next.daemon = config.daemon;
  }
  if (config.updates) {
    next.updates = config.updates;
  }
  if (config.logging) {
    next.logging = config.logging;
  }
  if (config.approvalPolicy) {
    next.approvalPolicy = config.approvalPolicy;
  }
  return next;
}

function sanitizeProviderForConfig(provider: AcpAgentProvider): AcpAgentProvider {
  const normalized = normalizeLegacyProvider(provider);
  const sanitized: AcpAgentProvider = {
    id: normalized.id,
    name: normalized.name,
    ...(normalized.description ? { description: normalized.description } : {}),
    ...(normalized.kind ? { kind: normalized.kind } : {}),
    command: normalized.command,
    ...(normalized.args?.length ? { args: normalized.args } : {}),
    ...(normalized.env && Object.keys(normalized.env).length ? { env: normalized.env } : {}),
    ...(normalized.mcpServers?.length ? { mcpServers: normalized.mcpServers } : {}),
    ...(normalized.cwd ? { cwd: normalized.cwd } : {}),
    ...(typeof normalized.initializeTimeoutMs === "number"
      ? { initializeTimeoutMs: normalized.initializeTimeoutMs }
      : {}),
    ...(typeof normalized.promptTimeoutMs === "number"
      ? { promptTimeoutMs: normalized.promptTimeoutMs }
      : {}),
    ...(normalized.defaultAgent ? { defaultAgent: normalized.defaultAgent } : {}),
    transport: normalized.transport,
    protocol: normalized.protocol,
  };
  const capabilities = sanitizeProviderCapabilities(normalized);
  if (capabilities) {
    sanitized.capabilities = capabilities;
  }
  return sanitized;
}

function sanitizeProviderCapabilities(provider: AcpAgentProvider) {
  const capabilities = provider.capabilities;
  if (!capabilities) {
    return undefined;
  }
  const next = { ...capabilities };
  if (next.sessionConfig && isInferredSessionConfig(provider, next.sessionConfig)) {
    delete next.sessionConfig;
  }
  return Object.keys(next).length ? next : undefined;
}

function isInferredSessionConfig(
  provider: AcpAgentProvider,
  sessionConfig: NonNullable<AcpAgentProvider["capabilities"]>["sessionConfig"],
) {
  const declared = {
    model: sessionConfig?.model ?? "none",
    reasoningEffort: sessionConfig?.reasoningEffort ?? "none",
    modelFormat: sessionConfig?.modelFormat,
  };
  const capabilities = { ...(provider.capabilities ?? {}) };
  delete capabilities.sessionConfig;
  const inferred = resolveLegacySessionConfigSupport({
    ...provider,
    capabilities: Object.keys(capabilities).length ? capabilities : undefined,
  });
  return (
    declared.model === inferred.model &&
    declared.reasoningEffort === inferred.reasoningEffort &&
    declared.modelFormat === inferred.modelFormat
  );
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
    summary: sanitizeSummaryForConfig(item.summary),
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
    summary: sanitizeSummaryForConfig(project.summary, project.name),
    summaryFile: sanitizeSummaryFileForConfig(project.summaryFile),
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
  const byId = new Map<string, ProjectSummary>();
  for (const path of listProjectFiles(configPath)) {
    if (!existsSync(path)) {
      continue;
    }
    const project = readProjectYamlFile(path);
    const targetPath = projectStoragePath(project, configPath);
    if (path !== targetPath) {
      byId.set(project.id, saveProjectYaml(project, configPath).project);
      continue;
    }
    byId.set(project.id, project);
  }
  return Array.from(byId.values());
}

export function readProjectYaml(projectId: string, configPath = getDefaultConfigPath()) {
  return readProjectYamlFile(findProjectYamlPathById(projectId, configPath));
}

function findProjectYamlPathById(projectId: string, configPath: string) {
  const directPath = projectYamlPath(projectId, configPath);
  if (existsSync(directPath)) {
    return directPath;
  }

  const projectFile = listProjectFiles(configPath).find((path) => hasProjectId(path, projectId));
  return projectFile ?? directPath;
}

function hasProjectId(path: string, projectId: string) {
  try {
    const parsed = parseYaml(readFileSync(path, "utf8")) as Partial<ProjectSummary>;
    return parsed.id === projectId;
  } catch {
    return false;
  }
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
    summary:
      typeof sanitized.summary === "string"
        ? sanitizeSummaryForConfig(sanitized.summary, String(sanitized.name))
        : undefined,
    summaryFile:
      typeof sanitized.summaryFile === "string"
        ? sanitizeSummaryFileForConfig(sanitized.summaryFile)
        : undefined,
    gitBranches: Array.isArray(sanitized.gitBranches)
      ? sanitized.gitBranches.filter((branch): branch is string => typeof branch === "string")
      : undefined,
    gitCurrentBranch:
      typeof sanitized.gitCurrentBranch === "string" ? sanitized.gitCurrentBranch : undefined,
    worktrees: dedupeWorktrees((sanitized.worktrees as WorktreeSummary[] | undefined) ?? []).map(
      sanitizeWorktreeForConfig,
    ),
  };
}

function sanitizeWorktreeForConfig(worktree: WorktreeSummary): WorktreeSummary {
  const summary = sanitizeSummaryForConfig(worktree.summary);
  return summary === worktree.summary ? worktree : { ...worktree, summary };
}

function sanitizeSummaryFileForConfig(path: string | undefined) {
  const slashed = path?.replace(/\\/gu, "/").trim();
  if (!slashed) {
    return undefined;
  }
  if (slashed.startsWith("/") || /^[a-zA-Z]:\//u.test(slashed)) {
    return undefined;
  }
  const normalized = slashed.replace(/^\/+/, "");
  if (normalized.split("/").some((part) => part === "..")) {
    return undefined;
  }
  return normalized;
}

function sanitizeSummaryForConfig(summary: string | undefined, projectName?: string) {
  const normalized = summary?.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return undefined;
  }

  const configuredLabel = "Configured summary:";
  const configuredIndex = normalized.indexOf(configuredLabel);
  const configured =
    configuredIndex >= 0
      ? normalized.slice(configuredIndex + configuredLabel.length).trim()
      : normalized;
  const projectPrefix = projectName ? `Project: ${projectName} ` : "";
  const candidate =
    projectPrefix && configured.startsWith(projectPrefix)
      ? configured.slice(projectPrefix.length).trim()
      : configured;
  const contentEnd = findGeneratedSummaryMarker(candidate);
  const content = (contentEnd >= 0 ? candidate.slice(0, contentEnd) : candidate).trim();

  if (!content || isGeneratedSummaryShell(content)) {
    return undefined;
  }
  return content;
}

function findGeneratedSummaryMarker(summary: string) {
  const markerIndexes = [
    " Worktree:",
    " Path:",
    " AGENTS.md:",
    " CLAUDE.md:",
    " README.md:",
    " package.json:",
  ]
    .map((marker) => summary.indexOf(marker))
    .filter((index) => index >= 0);
  return markerIndexes.length ? Math.min(...markerIndexes) : -1;
}

function isGeneratedSummaryShell(summary: string) {
  return /^(?:Project|Worktree|Path|AGENTS\.md|CLAUDE\.md|README\.md|package\.json)\s*:/iu.test(summary);
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
  const path = projectStoragePath(sanitized, configPath);
  migrateGenericProjectDirectory(sanitized, path, configPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, stringifyYaml(sanitized), "utf8");
  return { configPath: path, project: sanitized };
}

function migrateGenericProjectDirectory(project: ProjectSummary, targetPath: string, configPath: string) {
  if (!isGenericProjectId(project.id)) {
    return;
  }

  const legacyPath = projectYamlPath(project.id, configPath);
  if (legacyPath === targetPath || !existsSync(legacyPath)) {
    return;
  }

  if (!existsSync(targetPath)) {
    renameSync(dirname(legacyPath), dirname(targetPath));
    return;
  }

  if (hasProjectId(legacyPath, project.id)) {
    rmSync(dirname(legacyPath), { recursive: true, force: true });
  }
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
  const result = saveProjectYaml({ ...project, worktrees }, configPath);
  return { configPath: result.configPath, worktree };
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
  const path = findProjectYamlPathById(projectId, configPath);
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

export function saveLoggingToConfig(
  logging: NonNullable<TillerConfig["logging"]>,
  configPath = getDefaultConfigPath(),
) {
  const current = readTillerConfig(configPath);
  return writeGlobalConfig({ ...current, logging }, configPath, { logging });
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
