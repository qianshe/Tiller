import type { HelmHandlerContext } from "../handlers/context";
import { broadcastErrorRaised, broadcastSessionUpdate } from "../rpc/notifications";

export type SessionEventPublisher = {
  sessionUpdate(sessionId: string, update: unknown): void;
  errorRaised(input: { sessionId?: string; code?: string; message: string; data?: unknown }): void;
};

export function createSessionEventPublisher(context: HelmHandlerContext): SessionEventPublisher {
  return {
    sessionUpdate(sessionId, update) {
      broadcastSessionUpdate(context, sessionId, update);
    },
    errorRaised(input) {
      broadcastErrorRaised(context, input);
    },
  };
}
