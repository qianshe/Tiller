import type { SessionStatus } from "@tiller/shared";

const ACTIVE_SESSION_STATUSES: ReadonlySet<SessionStatus> = new Set([
  "starting",
  "running",
  "waiting_for_permission",
]);

export function isSessionCompletionUnreadTransition(
  previousStatus: SessionStatus | undefined,
  nextStatus: SessionStatus,
) {
  return nextStatus === "idle" && Boolean(previousStatus && ACTIVE_SESSION_STATUSES.has(previousStatus));
}

export function isUnacknowledgedSessionCompletion(
  completedAt: string | undefined,
  acknowledgedAt: string | undefined,
): boolean {
  if (!completedAt) {
    return false;
  }
  const completedTime = Date.parse(completedAt);
  if (!Number.isFinite(completedTime)) {
    return false;
  }
  const acknowledgedTime = acknowledgedAt ? Date.parse(acknowledgedAt) : Number.NaN;
  return !Number.isFinite(acknowledgedTime) || completedTime > acknowledgedTime;
}
