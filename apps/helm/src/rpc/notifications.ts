import type { HelmHandlerContext } from "../handlers/context";

export function broadcastSessionUpdate(
  context: HelmHandlerContext,
  sessionId: string,
  update: unknown,
): void {
  context.broadcastNotification?.("session/update", { sessionId, update });
}

export function broadcastErrorRaised(
  context: HelmHandlerContext,
  input: { sessionId?: string; code?: string; message: string; data?: unknown },
): void {
  context.broadcastNotification?.("error/raised", input);
}
