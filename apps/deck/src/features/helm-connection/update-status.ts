import type { HelmUpdateState } from "../../store/facade";
import { isHelmVersionAtLeast } from "./update-intent";

export type HelmUpdateStatusIntent =
  | { kind: "write"; targetVersion: string }
  | { kind: "clear" }
  | { kind: "keep" };

export function resolveHelmUpdateStatus(
  payload: Record<string, unknown>,
  previous: HelmUpdateState | undefined,
  pendingTarget?: string,
): { update: HelmUpdateState; intent: HelmUpdateStatusIntent } {
  const currentVersion = typeof payload.currentVersion === "string" ? payload.currentVersion : "";
  const status = payload.status as HelmUpdateState["status"];
  const targetVersion = status === "up-to-date"
    ? undefined
    : typeof payload.targetVersion === "string"
      ? payload.targetVersion
      : previous?.status === "restarting"
        ? previous.targetVersion ?? pendingTarget
        : pendingTarget;
  const targetConfirmed = Boolean(
    targetVersion &&
    typeof payload.currentVersion === "string" &&
    isHelmVersionAtLeast(currentVersion, targetVersion),
  );
  const effectiveStatus = status === "installing"
    ? "installing"
    : targetVersion
      ? targetConfirmed || status !== "failed"
        ? "restarting"
        : status
      : status;
  const update: HelmUpdateState = {
    ...previous,
    status: effectiveStatus,
    currentVersion,
    latestVersion: typeof payload.latestVersion === "string" ? payload.latestVersion : undefined,
    targetVersion,
    checkStatus: typeof payload.checkStatus === "string" ? payload.checkStatus as HelmUpdateState["checkStatus"] : previous?.checkStatus,
    cannotUpdateReason: typeof payload.cannotUpdateReason === "string" ? payload.cannotUpdateReason : previous?.cannotUpdateReason,
    manualCommand: typeof payload.manualCommand === "string" ? payload.manualCommand : previous?.manualCommand,
    checkedAt: typeof payload.checkedAt === "string" ? payload.checkedAt : previous?.checkedAt,
    message: typeof payload.message === "string" ? payload.message : undefined,
    updateAvailable: effectiveStatus === "available"
      ? true
      : effectiveStatus === "up-to-date" || effectiveStatus === "failed" || effectiveStatus === "unsupported"
        ? false
        : previous?.updateAvailable ?? false,
    canUpdate: typeof payload.canUpdate === "boolean" ? payload.canUpdate : previous?.canUpdate ?? false,
  };

  if (targetVersion && !targetConfirmed && status !== "failed") {
    return { update, intent: { kind: "write", targetVersion } };
  }
  if (
    targetConfirmed ||
    status === "failed" ||
    (!targetVersion && (status === "up-to-date" || status === "unsupported" || status === "available"))
  ) {
    return { update, intent: { kind: "clear" } };
  }
  return { update, intent: { kind: "keep" } };
}
