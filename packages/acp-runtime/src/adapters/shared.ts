import { existsSync } from "node:fs";
import type { AcpAgentProvider } from "@tiller/shared";
import { applySessionLaunchOverrides, resolveSessionEnvOverrides } from "./session-config";
import type { AcpLaunchContext, AcpLaunchSpec } from "./types";

export function resolveDefaultLaunch(provider: AcpAgentProvider, context: AcpLaunchContext): AcpLaunchSpec {
  const sessionEnv = resolveSessionEnvOverrides(provider.command, context.sessionConfig);
  return {
    command: provider.command,
    args: applySessionLaunchOverrides(provider.command, provider.args ?? [], context.sessionConfig),
    cwd: resolveLaunchCwd(provider, context.fallbackCwd),
    env: mergeLaunchEnv(provider.env, sessionEnv),
  };
}

function mergeLaunchEnv(
  providerEnv: Record<string, string> | undefined,
  sessionEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...providerEnv, ...sessionEnv };
  const providerConfig = providerEnv?.OPENCODE_CONFIG_CONTENT;
  const sessionConfig = sessionEnv.OPENCODE_CONFIG_CONTENT;
  if (providerConfig && sessionConfig) {
    merged.OPENCODE_CONFIG_CONTENT = mergeJsonConfigStrings(providerConfig, sessionConfig);
  }
  return merged;
}

function mergeJsonConfigStrings(base: string, override: string) {
  const baseJson = parseJsonObject(base);
  const overrideJson = parseJsonObject(override);
  if (!baseJson || !overrideJson) {
    return override;
  }
  return JSON.stringify(mergeJsonObjects(baseJson, overrideJson));
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mergeJsonObjects(base: Record<string, unknown>, override: Record<string, unknown>) {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    merged[key] = isPlainObject(current) && isPlainObject(value)
      ? mergeJsonObjects(current, value)
      : value;
  }
  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
