import type { AcpAgentProvider, AgentCapabilities } from "@tiller/shared";
import { createCodexAcpAdapter } from "./codex";
import { createGenericAcpAdapter } from "./generic";
import { createOpenCodeAcpAdapter } from "./opencode";
import type { AcpAgentAdapter, AcpLaunchContext } from "./types";

const ACP_AGENT_ADAPTERS: AcpAgentAdapter[] = [
  createOpenCodeAcpAdapter(),
  createCodexAcpAdapter(),
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

export { createCodexAcpAdapter } from "./codex";
export { createGenericAcpAdapter } from "./generic";
export { createOpenCodeAcpAdapter } from "./opencode";
export type { AcpAgentAdapter, AcpAuthoritativeHistory, AcpCleanupContext, AcpHistoryContext, AcpLaunchContext, AcpLaunchSpec, ProviderCleanupPlan } from "./types";
