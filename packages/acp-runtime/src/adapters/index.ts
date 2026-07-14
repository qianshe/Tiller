import type {
  AcpRuntimeProviderConfig,
  AgentCapabilities,
  AgentPlan,
  AgentToolCall,
} from "@tiller/shared";
import type { SessionRuntimeEvent } from "../runtime-types";
import { createClaudeAcpAdapter } from "./claude/index";
import { createCodexAcpAdapter } from "./codex/index";
import { createGenericAcpAdapter } from "./generic/index";
import { normalizeGenericToolCall } from "./generic/tool-calls";
import { createOpenClawAcpAdapter } from "./openclaw/index";
import { createOpenCodeAcpAdapter } from "./opencode/index";
import type { AcpAgentAdapter, AcpCompactionDetailsVisibility, AcpLaunchContext, AcpPromptObservationContext, AcpSessionUpdateProjectionContext, AcpToolCallNormalizationContext } from "./types";

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

export function mapAdapterMessageUpdate(
  provider: AcpRuntimeProviderConfig | undefined,
  context: AcpSessionUpdateProjectionContext,
) {
  return provider
    ? resolveAcpAgentAdapter(provider).mapMessageUpdate?.(context) ?? null
    : null;
}

export function mapAdapterToolCallUpdate(
  provider: AcpRuntimeProviderConfig | undefined,
  context: AcpSessionUpdateProjectionContext,
) {
  return provider
    ? resolveAcpAgentAdapter(provider).mapToolCallUpdate?.(context) ?? null
    : null;
}

export function mapAdapterUnknownUpdate(
  provider: AcpRuntimeProviderConfig | undefined,
  context: AcpSessionUpdateProjectionContext,
) {
  return provider
    ? resolveAcpAgentAdapter(provider).mapUnknownUpdate?.(context) ?? null
    : null;
}

export function beginAdapterPromptObservation(
  provider: AcpRuntimeProviderConfig,
  context: AcpPromptObservationContext,
) {
  resolveAcpAgentAdapter(provider).beginPromptObservation?.(context);
}

export function pollAdapterPromptEvents(
  provider: AcpRuntimeProviderConfig,
  context: AcpPromptObservationContext,
) {
  return resolveAcpAgentAdapter(provider).pollPromptEvents?.(context) ?? [];
}

export function disposeAdapterSession(
  provider: AcpRuntimeProviderConfig | undefined,
  sessionId: string,
) {
  provider && resolveAcpAgentAdapter(provider).disposeSession?.(sessionId);
}

export function normalizeAdapterToolCall(
  provider: AcpRuntimeProviderConfig | undefined,
  providerId: string | undefined,
  context: AcpToolCallNormalizationContext,
): AgentToolCall | null {
  const resolvedProvider = provider ?? inferProviderFromId(providerId);
  if (!resolvedProvider) {
    return normalizeGenericToolCall(context.toolCall);
  }
  const adapter = resolveAcpAgentAdapter(resolvedProvider);
  const normalized = adapter.normalizeToolCall
    ? adapter.normalizeToolCall(context)
    : context.toolCall;
  if (!normalized) {
    return null;
  }
  return adapter.id === "generic" ? normalized : normalizeGenericToolCall(normalized);
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

export function extractAdapterPlanFromToolCall(
  providerId: string | undefined,
  toolCall: AgentToolCall,
): AgentPlan | null {
  const provider = inferProviderFromId(providerId);
  if (!provider) {
    return null;
  }
  return resolveAcpAgentAdapter(provider).extractPlanFromToolCall?.(toolCall) ?? null;
}

export function isAdapterPlanToolCall(
  providerId: string | undefined,
  toolCall: AgentToolCall,
) {
  const provider = inferProviderFromId(providerId);
  if (!provider) {
    return false;
  }
  return resolveAcpAgentAdapter(provider).isPlanToolCall?.(toolCall) ?? false;
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
export type { AcpAgentAdapter, AcpCleanupContext, AcpCompactionDetailsVisibility, AcpLaunchContext, AcpLaunchSpec, AcpPromptObservationContext, AcpRequestTimeoutContext, AcpSessionUpdateProjection, AcpSessionUpdateProjectionContext, AcpToolCallNormalizationContext, ProviderAdapterPluginManifest, ProviderCleanupPlan } from "./types";
