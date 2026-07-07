import type { AcpAgentAdapter } from "../types";
import { isCommandNamed, resolveDefaultLaunch } from "../shared";
import {
  applyOpenCodeSessionLaunchArgs,
  resolveOpenCodeSessionEnv,
} from "../session-config";
import { extractOpenCodePlanFromToolCall, isOpenCodePlanToolCall, mapOpenCodePlanUpdate } from "./plan-events";
import { normalizeOpenCodeToolCall } from "./tool-calls";

export const OPENCODE_ACP_SESSION_REQUEST_TIMEOUT_MS = 120_000;

function isOpenCodeSessionRequest(method: string) {
  return method === "session/new" || method === "session/load" || method === "session/resume";
}

export function createOpenCodeAcpAdapter(): AcpAgentAdapter {
  return {
    id: "opencode",
    isMatch: (provider) => provider.id === "opencode" || isCommandNamed(provider.command, "opencode"),
    resolveLaunch: (provider, context) => {
      const launch = resolveDefaultLaunch(provider, context);
      return {
        ...launch,
        args: applyOpenCodeSessionLaunchArgs(launch.args),
        env: mergeOpenCodeEnv(provider.env, resolveOpenCodeSessionEnv(context.sessionConfig)),
      };
    },
    resolveCapabilities: (_provider, _initializeResult, detected) => detected,
    resolveCleanup: ({ provider, runtimeSessionId }) => {
      const pureArgs = provider.args?.includes("--pure") ? ["--pure"] : [];
      return {
        kind: "remote-delete",
        providerId: provider.id,
        runtimeSessionId,
        command: "opencode",
        args: ["session", "delete", runtimeSessionId, ...pureArgs],
      };
    },
    resolveRequestTimeout: ({ method }) =>
      isOpenCodeSessionRequest(method) ? OPENCODE_ACP_SESSION_REQUEST_TIMEOUT_MS : undefined,
    mapSessionUpdate: mapOpenCodePlanUpdate,
    extractPlanFromToolCall: extractOpenCodePlanFromToolCall,
    isPlanToolCall: isOpenCodePlanToolCall,
    normalizeToolCall: ({ toolCall, update }) => normalizeOpenCodeToolCall(toolCall, update),
  };
}

function mergeOpenCodeEnv(
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
