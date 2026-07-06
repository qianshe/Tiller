import type { AcpRuntimeProviderConfig, AgentCapabilities, AgentToolCall } from "@tiller/shared";
import type { SessionRuntimeEvent } from "../runtime-types";
import { createClaudeAcpAdapter } from "./claude/index";
import { createCodexAcpAdapter } from "./codex/index";
import { createGenericAcpAdapter } from "./generic/index";
import { createOpenClawAcpAdapter } from "./openclaw/index";
import { createOpenCodeAcpAdapter } from "./opencode/index";
import type { AcpAgentAdapter, AcpCompactionDetailsVisibility, AcpHistoryContext, AcpLaunchContext, AcpSessionUpdateProjectionContext, AcpToolCallNormalizationContext } from "./types";

const ACP_AGENT_ADAPTERS: AcpAgentAdapter[] = [
  createOpenCodeAcpAdapter(),
  createCodexAcpAdapter(),
  createClaudeAcpAdapter(),
  createOpenClawAcpAdapter(),
  createGenericAcpAdapter(),
];

export function resolveAcpAgentAdapter(provider: AcpRuntimeProviderConfig) {
  return ACP_AGENT_ADAPTERS.find((adapter) => adapter.isMatch(provider)) ?? ACP_AGENT_ADAPTERS[ACP_AGENT_ADAPTERS.length - 1]!;
}

export function resolveAcpLaunchConfig(provider: AcpRuntimeProviderConfig, context: AcpLaunchContext) {
  return resolveAcpAgentAdapter(provider).resolveLaunch(provider, context);
}

export function resolveAdapterCapabilities(
  provider: AcpRuntimeProviderConfig,
  initializeResult: unknown,
  detected: AgentCapabilities,
) {
  return resolveAcpAgentAdapter(provider).resolveCapabilities(provider, initializeResult, detected);
}

export function resolveAdapterCleanupPlan(provider: AcpRuntimeProviderConfig, runtimeSessionId: string) {
  return resolveAcpAgentAdapter(provider).resolveCleanup({ provider, runtimeSessionId });
}

export function resolveAdapterRequestTimeout(provider: AcpRuntimeProviderConfig, method: string) {
  return resolveAcpAgentAdapter(provider).resolveRequestTimeout?.({ provider, method });
}

export function mapAdapterSessionUpdate(
  provider: AcpRuntimeProviderConfig | undefined,
  context: AcpSessionUpdateProjectionContext,
) {
  return provider
    ? resolveAcpAgentAdapter(provider).mapSessionUpdate?.(context) ?? null
    : null;
}

export function normalizeAdapterToolCall(
  provider: AcpRuntimeProviderConfig | undefined,
  providerId: string | undefined,
  context: AcpToolCallNormalizationContext,
): AgentToolCall {
  const resolvedProvider = provider ?? inferProviderFromId(providerId);
  if (!resolvedProvider) {
    return context.toolCall;
  }
  return resolveAcpAgentAdapter(resolvedProvider).normalizeToolCall?.(context) ?? context.toolCall;
}

export function summarizeAdapterCompactionSignal(
  providerId: string | undefined,
  text: string,
) {
  const provider = inferProviderFromId(providerId);
  if (!provider) {
    return null;
  }
  return resolveAcpAgentAdapter(provider).summarizeCompactionSignal?.(text) ?? null;
}

export function expandAdapterRuntimeEvent(
  providerId: string | undefined,
  event: SessionRuntimeEvent,
) {
  const provider = inferProviderFromId(providerId);
  if (!provider) {
    return null;
  }
  return resolveAcpAgentAdapter(provider).expandRuntimeEvent?.(event) ?? null;
}

export function resolveAdapterCompactionDetailsVisibility(
  providerId: string | undefined,
): AcpCompactionDetailsVisibility | undefined {
  const provider = inferProviderFromId(providerId);
  if (!provider) {
    return undefined;
  }
  return resolveAcpAgentAdapter(provider).resolveCompactionDetailsVisibility?.();
}

export function readAdapterTranscriptPlan(context: AcpHistoryContext) {
  return resolveAcpAgentAdapter(context.provider).readTranscriptPlan?.(context) ?? null;
}

export function readAdapterTranscriptMessages(context: AcpHistoryContext) {
  return resolveAcpAgentAdapter(context.provider).readTranscriptMessages?.(context) ?? [];
}

function inferProviderFromId(providerId: string | undefined): AcpRuntimeProviderConfig | undefined {
  const id = providerId?.trim();
  if (!id) {
    return undefined;
  }
  return {
    id,
    name: id,
    command: id,
    transport: "stdio",
    protocol: "acp",
  };
}

export { createClaudeAcpAdapter } from "./claude/index";
export { createCodexAcpAdapter } from "./codex/index";
export { createGenericAcpAdapter } from "./generic/index";
export { createOpenClawAcpAdapter } from "./openclaw/index";
export { createOpenCodeAcpAdapter } from "./opencode/index";
export { OPENCODE_ACP_SESSION_REQUEST_TIMEOUT_MS } from "./opencode/index";
export { resolveAdapterPluginManifest } from "./plugin-loader";
export { SUPPRESS_SESSION_UPDATE } from "./types";
export type { AcpAgentAdapter, AcpAuthoritativeHistory, AcpCleanupContext, AcpCompactionDetailsVisibility, AcpHistoryContext, AcpLaunchContext, AcpLaunchSpec, AcpRequestTimeoutContext, AcpSessionUpdateProjection, AcpSessionUpdateProjectionContext, AcpToolCallNormalizationContext, ProviderAdapterPluginManifest, ProviderCleanupPlan } from "./types";
