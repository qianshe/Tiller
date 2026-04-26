import type { AcpAgentProvider, WorkspaceSummary } from "@tiller/shared";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type TillerConfig = {
  workspaces?: WorkspaceSummary[];
  agents?: AcpAgentProvider[];
  daemon?: {
    host?: string;
    port?: number;
  };
};

export function getMockWorkspaces(): WorkspaceSummary[] {
  return [
    {
      id: "mock-workspace",
      name: "Tiller Demo Workspace",
      path: "D:/projects/demo-workspace",
    },
  ];
}

export function getMockProviders(): AcpAgentProvider[] {
  return [
    {
      id: "mock-agent",
      name: "Mock ACP Agent",
      kind: "custom",
      command: "mock-agent",
      args: ["--demo"],
      transport: "stdio",
      protocol: "acp",
      installHint: "Built-in development mock provider for validating the Tiller UI loop.",
      capabilities: {
        streaming: true,
        permissionRequests: true,
        fileDiffs: true,
        commandOutput: true,
        cancellation: true,
      },
    },
  ];
}

export function resolveProviderById(id: string, providers: AcpAgentProvider[]) {
  return providers.find((provider) => provider.id === id);
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

export function getConfiguredProviders(configPath = getDefaultConfigPath()) {
  return readTillerConfig(configPath).agents ?? [];
}

export function listAvailableProviders(configPath = getDefaultConfigPath()) {
  return [...getConfiguredProviders(configPath), ...getMockProviders()];
}

export function saveProviderToConfig(provider: AcpAgentProvider, configPath = getDefaultConfigPath()) {
  const current = readTillerConfig(configPath);
  const nextAgents = [...(current.agents ?? []).filter((item) => item.id !== provider.id), provider];

  const nextConfig: TillerConfig = {
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
    provider,
  };
}

// TODO(real-acp): add stronger schema validation before persisting arbitrary provider shapes.
// TODO(real-acp): preserve future provider quirks and richer capability metadata when config editing expands.
