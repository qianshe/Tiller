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
  const sessionConfig = resolveSessionConfigSupport(provider);
  return {
    ...provider,
    capabilities: {
      ...provider.capabilities,
      sessionConfig: {
        model: sessionConfig.model,
        reasoningEffort: sessionConfig.reasoningEffort,
        modelFormat: sessionConfig.modelFormat,
        ...provider.capabilities?.sessionConfig,
      },
    },
  };
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

  return JSON.parse(stub.raw) as TillerConfig;
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

export function saveProviderToConfig(provider: AcpAgentProvider, configPath = getDefaultConfigPath()) {
  const current = readTillerConfig(configPath);
  const normalizedProvider = hydrateProvider(provider);
  const nextAgents = [...(current.agents ?? []).filter((item) => item.id !== normalizedProvider.id), normalizedProvider];

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
