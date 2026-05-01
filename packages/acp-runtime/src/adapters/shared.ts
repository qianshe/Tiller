import { existsSync } from "node:fs";
import type { AcpAgentProvider } from "@tiller/shared";
import { applySessionLaunchOverrides, resolveSessionEnvOverrides } from "../config-adapters";
import type { AcpLaunchContext, AcpLaunchSpec } from "./types";

export function resolveDefaultLaunch(provider: AcpAgentProvider, context: AcpLaunchContext): AcpLaunchSpec {
  return {
    command: provider.command,
    args: applySessionLaunchOverrides(provider.command, provider.args ?? [], context.sessionConfig),
    cwd: resolveLaunchCwd(provider, context.fallbackCwd),
    env: {
      ...provider.env,
      ...resolveSessionEnvOverrides(provider.command, context.sessionConfig),
    },
  };
}

export function resolveUnsupportedCleanup(provider: AcpAgentProvider) {
  return {
    kind: "unsupported" as const,
    providerId: provider.id,
    message: `${provider.name} does not expose remote session deletion yet.`,
  };
}

export function isCommandNamed(command: string, expected: string) {
  const normalized = command.replace(/\\/gu, "/").split("/").pop()?.toLowerCase() ?? command.toLowerCase();
  return normalized === expected || normalized === `${expected}.exe` || normalized === `${expected}.cmd` || normalized === `${expected}.ps1`;
}

function resolveLaunchCwd(provider: AcpAgentProvider, fallbackCwd: string) {
  if (existsSync(provider.cwd ?? "")) {
    return provider.cwd!;
  }
  if (existsSync(fallbackCwd)) {
    return fallbackCwd;
  }
  return process.cwd();
}
