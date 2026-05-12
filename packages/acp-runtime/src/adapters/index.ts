import type { AcpAgentProvider, AgentCapabilities } from "@tiller/shared";
import { createClaudeAcpAdapter } from "./claude/index";
import { createCodexAcpAdapter } from "./codex/index";
import { createGenericAcpAdapter } from "./generic/index";
import { createOpenClawAcpAdapter } from "./openclaw/index";
import { createOpenCodeAcpAdapter } from "./opencode/index";
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

export { createClaudeAcpAdapter } from "./claude/index";
export { createCodexAcpAdapter } from "./codex/index";
export { createGenericAcpAdapter } from "./generic/index";
export { createOpenClawAcpAdapter } from "./openclaw/index";
export { createOpenCodeAcpAdapter } from "./opencode/index";
export { OPENCODE_ACP_SESSION_REQUEST_TIMEOUT_MS } from "./opencode/index";
export type { AcpAgentAdapter, AcpAuthoritativeHistory, AcpCleanupContext, AcpHistoryContext, AcpLaunchContext, AcpLaunchSpec, AcpRequestTimeoutContext, ProviderCleanupPlan } from "./types";
