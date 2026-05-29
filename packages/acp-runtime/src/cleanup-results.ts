import type { ProviderCleanupResult } from "./runtime-types";

export function normalizeProviderCleanupResult(result: ProviderCleanupResult) {
  switch (result.kind) {
    case "remote-deleted":
      return {
        remoteDeleted: true,
        remoteDeletionAttempted: true,
        providerId: result.providerId,
        message: result.message,
      };
    case "remote-delete-failed":
      return {
        remoteDeleted: false,
        remoteDeletionAttempted: true,
        providerId: result.providerId,
        message: result.message,
      };
    case "remote-closed":
      return {
        remoteDeleted: false,
        remoteDeletionAttempted: true,
        providerId: result.providerId,
        message: result.message,
      };
    case "remote-close-failed":
      return {
        remoteDeleted: false,
        remoteDeletionAttempted: true,
        providerId: result.providerId,
        message: result.message,
      };
    case "unsupported":
    default:
      return {
        remoteDeleted: false,
        remoteDeletionAttempted: false,
        providerId: result.providerId,
        message: result.message,
      };
  }
}
