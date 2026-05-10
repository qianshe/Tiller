import { resolveSessionConfigSupport, type AcpAgentProvider, type HelmSummary, type ProjectSummary, type WorkspaceSummary } from "@tiller/shared";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type TillerConfig = {
  helms?: HelmSummary[];
  projects?: ProjectSummary[];
  workspaces?: WorkspaceSummary[];
  agents?: AcpAgentProvider[];
  daemon?: {
    host?: string;
    port?: number;
    auth?: "none" | "pairing";
  };
};

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

  return parseTillerConfig(stub.raw, configPath);
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

export function listAvailableHelms(configPath = getDefaultConfigPath()) {
  return readTillerConfig(configPath).helms ?? [];
}

export function listAvailableProjects(configPath = getDefaultConfigPath()) {
  return readTillerConfig(configPath).projects ?? [];
}

export function getConfiguredProviders(configPath = getDefaultConfigPath()) {
  return (readTillerConfig(configPath).agents ?? []).map(hydrateProvider);
}

export function listAvailableProviders(configPath = getDefaultConfigPath()) {
  return getConfiguredProviders(configPath);
}


export function saveHelmToConfig(helm: HelmSummary, configPath = getDefaultConfigPath()) {
  const current = readTillerConfig(configPath);
  const nextHelms = [...(current.helms ?? []).filter((item) => item.id !== helm.id), helm];

  const nextConfig: TillerConfig = {
    helms: nextHelms,
    projects: current.projects ?? [],
    workspaces: current.workspaces ?? [],
    agents: current.agents ?? [],
    daemon: current.daemon ?? {
      host: "127.0.0.1",
      port: 47631,
    },
  };

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), "utf8");

  return {
    configPath,
    helm,
  };
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

  const nextConfig: TillerConfig = {
    helms: current.helms ?? [],
    projects: current.projects ?? [],
    workspaces: current.workspaces ?? [],
    agents: nextAgents,
    daemon: current.daemon ?? {
      host: "127.0.0.1",
      port: 47631,
    },
  };

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), "utf8");

  return {
    configPath,
    provider: normalizedProvider,
  };
}


export function saveProjectToConfig(project: ProjectSummary, configPath = getDefaultConfigPath()) {
  const current = readTillerConfig(configPath);
  const nextProjects = [...(current.projects ?? []).filter((item) => item.id !== project.id), project];

  const nextConfig: TillerConfig = {
    helms: current.helms ?? [],
    projects: nextProjects,
    workspaces: current.workspaces ?? [],
    agents: current.agents ?? [],
    daemon: current.daemon ?? {
      host: "127.0.0.1",
      port: 47631,
    },
  };

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), "utf8");

  return {
    configPath,
    project,
  };
}

export function saveWorkspaceToConfig(workspace: WorkspaceSummary, configPath = getDefaultConfigPath()) {
  const current = readTillerConfig(configPath);
  const nextWorkspaces = [...(current.workspaces ?? []).filter((item) => item.id !== workspace.id), workspace];

  const nextConfig: TillerConfig = {
    helms: current.helms ?? [],
    projects: current.projects ?? [],
    workspaces: nextWorkspaces,
    agents: current.agents ?? [],
    daemon: current.daemon ?? {
      host: "127.0.0.1",
      port: 47631,
    },
  };

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), "utf8");

  return {
    configPath,
    workspace,
  };
}

export function deleteProjectFromConfig(projectId: string, configPath = getDefaultConfigPath()) {
  const current = readTillerConfig(configPath);
  const project = (current.projects ?? []).find((item) => item.id === projectId);
  const workspaceIds = new Set(project?.workspaceIds ?? []);
  const nextConfig: TillerConfig = {
    helms: current.helms ?? [],
    projects: (current.projects ?? []).filter((item) => item.id !== projectId),
    workspaces: workspaceIds.size
      ? (current.workspaces ?? []).filter((item) => !workspaceIds.has(item.id))
      : (current.workspaces ?? []),
    agents: current.agents ?? [],
    daemon: current.daemon ?? {
      host: "127.0.0.1",
      port: 47631,
    },
  };

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), "utf8");

  return {
    configPath,
    projectId,
    deleted: Boolean(project),
  };
}

export function deleteProviderFromConfig(providerId: string, configPath = getDefaultConfigPath()) {
  const current = readTillerConfig(configPath);
  const nextAgents = (current.agents ?? []).filter(
    (item) => normalizeLegacyProvider(item).id !== providerId,
  );
  const nextProjects = (current.projects ?? []).map((project) => {
    if (project.defaultAgentId !== providerId) {
      return project;
    }
    const { defaultAgentId: _defaultAgentId, ...rest } = project;
    return rest;
  });
  const nextConfig: TillerConfig = {
    helms: current.helms ?? [],
    projects: nextProjects,
    workspaces: current.workspaces ?? [],
    agents: nextAgents,
    daemon: current.daemon ?? {
      host: "127.0.0.1",
      port: 47631,
    },
  };

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), "utf8");

  return {
    configPath,
    providerId,
    deleted: nextAgents.length !== (current.agents ?? []).length,
  };
}
