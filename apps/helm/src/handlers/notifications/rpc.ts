import type { HelmHandlerContext } from "../context";
import { broadcastNotificationCleared } from "../../rpc/notifications";

export function handleNotificationRpcRequest(
  method: string,
  params: unknown,
  context: HelmHandlerContext,
): unknown | undefined {
  if (method === "notification/clear") {
    const clearedAt = context.notificationStore.clear?.();
    if (!clearedAt) {
      throw new Error("Notification store does not support clearing");
    }
    broadcastNotificationCleared(context, clearedAt);
    return { ok: true, clearedAt };
  }
  if (method === "notification/list") {
    const { limit } = params as { limit?: number };
    const clearedAt = context.notificationStore.getClearedAt?.() ?? undefined;
    return {
      notifications: context.notificationStore.list({ limit }),
      ...(clearedAt ? { clearedAt } : {}),
    };
  }
  return undefined;
}
