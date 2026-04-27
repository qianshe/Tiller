import { normalizeProviderCleanupResult, type ProviderCleanupResult } from "@tiller/acp-runtime";
import type { AcpAgentProvider, SessionSummary } from "@tiller/shared";
import { executeProviderCleanup } from "./provider-cleanup";

type CleanupExecutor = (provider: AcpAgentProvider, runtimeSessionId: string) => ProviderCleanupResult;

export function resolveSessionCleanupOutcome(
  summary: SessionSummary,
  provider: AcpAgentProvider | undefined,
  cleanupExecutor: CleanupExecutor = executeProviderCleanup,
) {
  if (!summary.runtimeSessionId) {
    return {
      remoteDeleted: false,
      remoteDeletionAttempted: false,
      providerId: provider?.id,
      message: "Legacy session had no tracked ACP runtimeSessionId; deleted local Tiller history only.",
    };
  }

  if (!provider) {
    return {
      remoteDeleted: false,
      remoteDeletionAttempted: false,
      providerId: summary.agentId,
      message: "Session data deleted locally, but the original ACP provider could not be resolved for remote cleanup.",
    };
  }

  return normalizeProviderCleanupResult(cleanupExecutor(provider, summary.runtimeSessionId));
}
