import type { HelmHandlerContext } from "../../../handlers/context";
import { broadcastErrorRaised, broadcastSessionUpdate } from "../../../rpc/notifications";
import { emitHelmPromptTrace } from "../../prompt-trace";
import type { SessionRealtimeUpdate } from "../update-contracts";

export type SessionEventPublisher = {
  sessionUpdate(sessionId: string, update: SessionRealtimeUpdate): void;
  errorRaised(input: { sessionId?: string; code?: string; message: string; data?: unknown }): void;
};

export function createSessionEventPublisher(context: HelmHandlerContext): SessionEventPublisher {
  return {
    sessionUpdate(sessionId, update) {
      emitHelmPromptTrace(context, {
        sessionId,
        phase: "helm.session_update.broadcast",
        meta: { kind: update.kind },
      });
      broadcastSessionUpdate(context, sessionId, update);
    },
    errorRaised(input) {
      broadcastErrorRaised(context, input);
    },
  };
}
