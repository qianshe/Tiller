import { existsSync } from "node:fs";
import type { AcpRuntimeProviderConfig } from "@tiller/shared";
import type { AcpLaunchContext, AcpLaunchSpec } from "./types";

export function resolveDefaultLaunch(
  provider: AcpRuntimeProviderConfig,
  context: AcpLaunchContext,
): AcpLaunchSpec {
  return {
    command: provider.command,
    args: provider.args ?? [],
    cwd: resolveLaunchCwd(provider, context.fallbackCwd),
    env: provider.env ?? {},
  };
}

export function resolveUnsupportedCleanup(provider: AcpRuntimeProviderConfig) {
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

function resolveLaunchCwd(provider: AcpRuntimeProviderConfig, fallbackCwd: string) {
  if (existsSync(provider.cwd ?? "")) {
    return provider.cwd!;
  }
  if (existsSync(fallbackCwd)) {
    return fallbackCwd;
  }
  return process.cwd();
}
