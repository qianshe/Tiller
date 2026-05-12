import type { ProviderCleanupResult } from "@tiller/acp-runtime";
import type { AcpAgentProvider } from "@tiller/shared";
import { executeProviderCleanup } from "./cleanup";

type DraftRuntimeHandle = {
  runtimeSessionId: string;
  sessionCapabilities?: { sessionDelete?: boolean; sessionClose?: boolean };
  deleteSession?: () => Promise<ProviderCleanupResult>;
  close?: () => Promise<ProviderCleanupResult>;
  cancel: () => void;
};

type CleanupExecutor = Parameters<typeof executeProviderCleanup>[2];

export async function cleanupDraftProviderRuntime(
  runtime: DraftRuntimeHandle,
  provider: AcpAgentProvider,
  executor?: CleanupExecutor,
): Promise<ProviderCleanupResult> {
  const sdkCleanup = await cleanupDraftSdkRuntime(runtime, provider.id);
  if (sdkCleanup.kind === "remote-deleted") {
    return sdkCleanup;
  }

  const providerCleanup = executeProviderCleanup(provider, runtime.runtimeSessionId, executor);
  if (providerCleanup.kind === "unsupported") {
    return sdkCleanup;
  }
  return providerCleanup;
}

async function cleanupDraftSdkRuntime(
  runtime: DraftRuntimeHandle,
  providerId: string,
): Promise<ProviderCleanupResult> {
  if (runtime.sessionCapabilities?.sessionDelete && runtime.deleteSession) {
    try {
      return await runtime.deleteSession();
    } catch (error) {
      runtime.cancel();
      return {
        kind: "remote-delete-failed",
        providerId,
        message: error instanceof Error ? error.message : "Failed to delete unused ACP draft.",
      };
    }
  }

  if (runtime.sessionCapabilities?.sessionClose && runtime.close) {
    try {
      return await runtime.close();
    } catch (error) {
      runtime.cancel();
      return {
        kind: "remote-close-failed",
        providerId,
        message: error instanceof Error ? error.message : "Failed to close unused ACP draft.",
      };
    }
  }

  runtime.cancel();
  return {
    kind: "unsupported",
    providerId,
    message: "ACP agent did not advertise draft cleanup support; local draft runtime was terminated only.",
  };
}
