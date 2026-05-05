import type { AcpAgentProvider } from "@tiller/shared";

export { createAcpRuntime } from "./runtime-session";
export { testAcpConnection } from "./connection-test";
export { listAcpAgentSessions, normalizeAcpAgentSessionListResult } from "./session-list";
export { DEFAULT_ACP_PROMPT_TIMEOUT_MS, DEFAULT_ACP_REQUEST_TIMEOUT_MS } from "./constants";

export function resolvePreferredAgentId(provider: Pick<AcpAgentProvider, "defaultAgent">) {
  return normalizePreferredAgentId(provider.defaultAgent);
}

function normalizePreferredAgentId(agent: string | undefined) {
  if (!agent) {
    return undefined;
  }

  const trimmed = agent.trim();
  if (!trimmed) {
    return undefined;
  }

  const canonical = trimmed
    .replace(/\s+-\s+.*/u, "")
    .replace(/\s+/gu, "-")
    .toLowerCase();

  const aliasMap: Record<string, string> = {
    sisyphus: "sisyphus",
    atlas: "atlas",
    prometheus: "prometheus",
    hephaestus: "hephaestus",
    oracle: "oracle",
    metis: "metis",
    momus: "momus",
    build: "build",
    plan: "plan",
    general: "general",
    explore: "explore",
    summary: "summary",
    title: "title",
    compaction: "compaction",
  };

  return aliasMap[canonical] ?? canonical;
}

// TODO(real-acp): introduce createAcpRuntime(provider, workspace) using stdio JSON-RPC notifications beyond initialize.
// TODO(real-acp): normalize ACP raw notifications into SessionRuntimeEvent here instead of leaking protocol details upward.

export { resolveRuntimeSessionId } from "./requests";
export { resolveSessionCapabilities, type DetectedAcpSessionCapabilities } from "./capabilities";
export type {
  AcpAgentSessionListResult,
  AcpRuntimeOptions,
  AcpSessionConfigOption,
  AcpSessionConfigOptionValue,
  AcpSessionConfigState,
  AcpSessionRestoreStrategy,
  ProviderCleanupResult,
  SessionRuntimeEvent,
} from "./runtime-types";

export { mapSessionUpdateNotification, normalizeProviderCleanupResult } from "./events";
export { sanitizeProtocolLogPayload } from "./protocol-logging";

export { applySessionLaunchOverrides, buildOpenCodeConfigOverride, resolveSessionEnvOverrides } from "./config-adapters";
export {
  createClaudeAcpAdapter,
  createCodexAcpAdapter,
  createGenericAcpAdapter,
  createOpenClawAcpAdapter,
  createOpenCodeAcpAdapter,
  resolveAcpAgentAdapter,
  resolveAcpLaunchConfig,
  resolveAdapterCleanupPlan,
  type AcpAgentAdapter,
  type AcpLaunchContext,
  type AcpLaunchSpec,
  type ProviderCleanupPlan,
} from "./adapters";
