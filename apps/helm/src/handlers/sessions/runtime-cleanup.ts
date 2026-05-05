import type { ProviderCleanupResult } from "@tiller/acp-runtime";

export async function cleanupActiveRuntime(
  runtime: {
    sessionCapabilities?: { sessionDelete?: boolean; sessionClose?: boolean };
    deleteSession?: () => Promise<ProviderCleanupResult>;
    close?: () => Promise<ProviderCleanupResult>;
    cancel: () => void;
  },
  providerId: string,
): Promise<ProviderCleanupResult> {
  if (runtime.sessionCapabilities?.sessionDelete && runtime.deleteSession) {
    try {
      const deleted = await runtime.deleteSession();
      runtime.cancel();
      if (deleted.kind === "remote-deleted") {
        return deleted;
      }
    } catch (error) {
      runtime.cancel();
      return {
        kind: "remote-delete-failed",
        providerId,
        message: error instanceof Error ? error.message : "Failed to delete remote ACP session.",
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
        message: error instanceof Error ? error.message : "Failed to close remote ACP session.",
      };
    }
  }

  runtime.cancel();
  return {
    kind: "unsupported",
    providerId,
    message:
      "ACP agent did not advertise session/delete or session/close; cleaned local Tiller session and terminated the local runtime process only.",
  };
}
