import type { SessionStatus } from "@tiller/shared";
import type { SessionRuntimeEvent } from "./runtime-types";
import type { UnknownRecord } from "./session-update";

export function projectSessionMetadataEvent(
  updateType: string | undefined,
  update: UnknownRecord,
): SessionRuntimeEvent | null {
  if (updateType === "current_mode_update" && typeof update.currentModeId === "string") {
    return { type: "mode-update", agentMode: update.currentModeId };
  }
  if (updateType === "session_info_update") {
    return {
      type: "session-info",
      ...("title" in update && (typeof update.title === "string" || update.title === null)
        ? { title: update.title }
        : {}),
      ...("updatedAt" in update && (typeof update.updatedAt === "string" || update.updatedAt === null)
        ? { updatedAt: update.updatedAt }
        : {}),
    };
  }
  if (updateType === "usage_update" && typeof update.used === "number" && typeof update.size === "number") {
    const cost = update.cost;
    return {
      type: "usage-update",
      usage: {
        used: update.used,
        size: update.size,
        ...(cost === null
          ? { cost: null }
          : (cost && typeof cost === "object" &&
              typeof (cost as UnknownRecord).amount === "number" &&
              typeof (cost as UnknownRecord).currency === "string"
            ? { cost: {
                amount: (cost as UnknownRecord).amount as number,
                currency: (cost as UnknownRecord).currency as string,
              } }
            : {})),
      },
    };
  }
  return null;
}

export function projectSessionStatusEvent(
  updateType: string | undefined,
  update: UnknownRecord,
): Extract<SessionRuntimeEvent, { type: "status" }> | null {
  const status = normalizeSessionStatus(updateType);
  return status
    ? { type: "status", status, message: typeof update.message === "string" ? update.message : undefined }
    : null;
}

function normalizeSessionStatus(updateType: string | undefined): SessionStatus | null {
  switch (updateType) {
    case "completed":
    case "idle":
    case "session_idle":
      return "idle";
    case "running":
    case "started":
    case "session_running":
      return "running";
    case "cancelled":
    case "session_cancelled":
      return "cancelled";
    case "error":
    case "session_error":
      return "error";
    default:
      return null;
  }
}
