import type { AcpAgentProvider } from "@tiller/shared";

export {
  connectAcpConnection,
  createAcpRuntime,
  disposeAcpConnections,
  listAcpConnectionInventory,
  reconnectAcpConnection,
} from "./runtime-session";
export { AcpConnection } from "./connection/lifecycle";
export { createAcpConnectionManager } from "./connection/manager";
export type { AcpConnectionLifecycleEvent } from "./connection/manager";
export { resolveAcpConnectionKey } from "./connection/key";
export type { AcpConnectionInventoryItem } from "./connection/types";
export {
  markAcpPromptFailureReported,
  wasAcpPromptFailureReported,
} from "./connection/prompt-failure";
export { testAcpConnection } from "./connection-test";
export {
  listAcpAgentSessions,
  normalizeAcpAgentSessionListResult,
} from "./session-list";
export {
  DEFAULT_ACP_PROMPT_TIMEOUT_MS,
  DEFAULT_ACP_REQUEST_TIMEOUT_MS,
  resolveAcpRequestTimeout,
} from "./constants";

export function resolvePreferredAgentId(
  provider: Pick<AcpAgentProvider, "defaultAgent">,
) {
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

export { resolveRuntimeSessionId } from "./requests";
export {
  resolveSessionCapabilities,
  type DetectedAcpSessionCapabilities,
} from "./capabilities";
export type {
  AcpAgentSessionListResult,
  AcpRuntimeOptions,
  AcpSessionConfigOption,
  AcpSessionConfigOptionValue,
  AcpSessionConfigState,
  AcpSessionRestoreStrategy,
  ProviderCleanupResult,
  MappedSessionRuntimeEvents,
  SessionRuntimeEvent,
} from "./runtime-types";

export {
  mapSessionUpdateNotificationBatch,
  normalizeProviderCleanupResult,
  summarizeSessionUpdateNotification,
} from "./events";
export {
  sanitizeProtocolLogPayload,
  type AcpProtocolLoggingOptions,
  type AcpProtocolTraceMode,
} from "./protocol-logging";

export { buildOpenCodeConfigOverride } from "./config-adapters";
export {
  CLAUDE_ACP_SESSION_REQUEST_TIMEOUT_MS,
  createClaudeAcpAdapter,
  createCodexAcpAdapter,
  createGenericAcpAdapter,
  createOpenClawAcpAdapter,
  createOpenCodeAcpAdapter,
  extractAdapterPlanFromToolCall,
  expandAdapterRuntimeEvent,
  isAdapterPlanToolCall,
  OPENCODE_ACP_SESSION_REQUEST_TIMEOUT_MS,
  resolveAcpAgentAdapter,
  resolveAcpLaunchConfig,
  resolveAdapterCleanupPlan,
  resolveAdapterCompactionDetailsVisibility,
  resolveAdapterCompactionSummary,
  resolveAdapterRequestTimeout,
  resolveAdapterPluginManifest,
  type AcpAgentAdapter,
  type AcpCompactionSummary,
  type AcpCompactionSummaryContext,
  type AcpLaunchContext,
  type AcpLaunchSpec,
  type ProviderAdapterPluginManifest,
  type ProviderCleanupPlan,
} from "./adapters";
