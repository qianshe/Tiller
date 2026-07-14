import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { PersistedSessionEvent } from "../session-updates/reducer";
import type { SessionUpdateRecord } from "@tiller/shared";
import type { HelmHandlerContext } from "../../handlers/context";
import type { SessionTimelineWorkerRegistry } from "./worker-registry";
import type { SessionTimelineFlushScheduler } from "./flush-scheduler";

export type SessionEventRouterDeps = {
  workers: SessionTimelineWorkerRegistry;
  flushScheduler: SessionTimelineFlushScheduler;
  context: HelmHandlerContext;
};

export function routeSessionRuntimeEvent(
  sessionId: string,
  event: PersistedSessionEvent,
  deps: SessionEventRouterDeps,
  sequence?: number,
  update?: SessionUpdateRecord,
) {
  void sequence;
  const providerId = resolveSessionProviderId(sessionId, deps.context);
  switch (event.type) {
    case "message":
    case "tool-call":
    case "command-output": {
      const worker = deps.workers.forSession(sessionId, { providerId });
      worker.enqueue(event, update);
      deps.flushScheduler.schedule(sessionId, event);
      return "timeline" as const;
    }
    case "compaction": {
      const worker = deps.workers.forSession(sessionId, { providerId });
      worker.enqueue(event, update);
      deps.flushScheduler.schedule(sessionId, event);
      return "timeline" as const;
    }
    case "permission-request":
    case "error":
      return "passthrough" as const;
    default:
      return "passthrough" as const;
  }
}

function resolveSessionProviderId(
  sessionId: string,
  context: HelmHandlerContext,
) {
  const record = context.sessions.get(sessionId);
  const summary = context.sessionStore?.get?.(sessionId);
  return record?.agent?.id ?? record?.summary?.agentId ?? summary?.agentId;
}
