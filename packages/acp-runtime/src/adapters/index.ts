import type { AcpAgentProvider, AgentCapabilities } from "@tiller/shared";
import { createClaudeAcpAdapter } from "./claude";
import { createCodexAcpAdapter } from "./codex";
import { createGenericAcpAdapter } from "./generic";
import { createOpenClawAcpAdapter } from "./openclaw";
import { createOpenCodeAcpAdapter } from "./opencode";
import type { AcpAgentAdapter, AcpLaunchContext } from "./types";

const ACP_AGENT_ADAPTERS: AcpAgentAdapter[] = [
  createOpenCodeAcpAdapter(),
  createCodexAcpAdapter(),
  createClaudeAcpAdapter(),
  createOpenClawAcpAdapter(),
  createGenericAcpAdapter(),
];

export function resolveAcpAgentAdapter(provider: AcpAgentProvider) {
  return ACP_AGENT_ADAPTERS.find((adapter) => adapter.isMatch(provider)) ?? ACP_AGENT_ADAPTERS[ACP_AGENT_ADAPTERS.length - 1]!;
}

export function resolveAcpLaunchConfig(provider: AcpAgentProvider, context: AcpLaunchContext) {
  return resolveAcpAgentAdapter(provider).resolveLaunch(provider, context);
}

export function resolveAdapterCapabilities(provider: AcpAgentProvider, initializeResult: unknown, detected: AgentCapabilities) {
  return resolveAcpAgentAdapter(provider).resolveCapabilities(provider, initializeResult, detected);
}

export function resolveAdapterCleanupPlan(provider: AcpAgentProvider, runtimeSessionId: string) {
  return resolveAcpAgentAdapter(provider).resolveCleanup({ provider, runtimeSessionId });
}

export function resolveAdapterRequestTimeout(provider: AcpAgentProvider, method: string) {
  return resolveAcpAgentAdapter(provider).resolveRequestTimeout?.({ provider, method });
}

export function loadAdapterAuthoritativeHistory(
  provider: AcpAgentProvider,
  runtimeSessionId: string,
  cwd: string,
) {
  return (
    resolveAcpAgentAdapter(provider).loadAuthoritativeHistory?.({
      provider,
      runtimeSessionId,
      cwd,
    }) ?? Promise.resolve(null)
  );
}

export { createClaudeAcpAdapter } from "./claude";
export { createCodexAcpAdapter } from "./codex";
export { createGenericAcpAdapter } from "./generic";
export { createOpenClawAcpAdapter } from "./openclaw";
export { createOpenCodeAcpAdapter } from "./opencode";
export { OPENCODE_ACP_SESSION_REQUEST_TIMEOUT_MS } from "./opencode";
export type { AcpAgentAdapter, AcpAuthoritativeHistory, AcpCleanupContext, AcpHistoryContext, AcpLaunchContext, AcpLaunchSpec, AcpRequestTimeoutContext, ProviderCleanupPlan } from "./types";
