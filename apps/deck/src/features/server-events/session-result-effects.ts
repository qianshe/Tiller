import type {
  SessionCleanupResult,
} from "@tiller/shared";

export type SessionResultToast = {
  tone: "success" | "warning" | "info";
  message: string;
};

export function resolveSessionCleanupToast(result: SessionCleanupResult): SessionResultToast {
  if (result.remoteDeleted) {
    return { tone: "success", message: "会话已删除" };
  }
  if (result.remoteDeletionAttempted) {
    return { tone: "warning", message: result.message };
  }
  return { tone: "info", message: result.message };
}
