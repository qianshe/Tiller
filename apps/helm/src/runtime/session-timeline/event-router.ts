import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { HelmHandlerContext } from "../../handlers/context";
import type { SessionTimelineWorkerRegistry } from "./worker-registry";
import type { SessionLiveStateStore } from "./live-state-store";
import type { SessionTimelineDispatcher } from "./dispatcher";
import { createSessionEventPublisher } from "../session/event/publisher";

export type SessionEventRouterDeps = {
  workers: SessionTimelineWorkerRegistry;
  liveStateStore: SessionLiveStateStore;
  dispatcher: SessionTimelineDispatcher;
  context: HelmHandlerContext;
};

export function routeSessionRuntimeEvent(
  sessionId: string,
  event: SessionRuntimeEvent,
  deps: SessionEventRouterDeps,
) {
  switch (event.type) {
    case "message":
    case "tool-call":
    case "command-output": {
      const worker = deps.workers.forSession(sessionId);
      worker.enqueue(event);
      const batches = worker.flush();
      for (const batch of batches) {
        deps.dispatcher.dispatch(sessionId, batch);
      }
      return "timeline" as const;
    }
    case "compaction": {
      if (event.phase === "started") {
        deps.liveStateStore.patch(sessionId, {});
        broadcastCompactionState(sessionId, event, deps.context);
        return "live_state" as const;
      }
      const worker = deps.workers.forSession(sessionId);
      worker.enqueue(event);
      const batches = worker.flush();
      for (const batch of batches) {
        deps.dispatcher.dispatch(sessionId, batch);
      }
      broadcastCompactionState(sessionId, event, deps.context);
      return "timeline" as const;
    }
    case "plan-update":
      deps.liveStateStore.patch(sessionId, { plan: event.plan });
      return "live_state" as const;
    case "permission-request":
    case "diff-update":
    case "error":
      return "passthrough" as const;
    case "status":
    case "config-options":
    case "model-options":
    case "available-commands":
      return "live_state" as const;
    default:
      return "passthrough" as const;
  }
}

function broadcastCompactionState(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "compaction" }>,
  context: HelmHandlerContext,
) {
  createSessionEventPublisher(context).sessionUpdate(sessionId, {
    kind: "compaction_state",
    phase: event.phase,
    source: event.source,
    timestamp: event.timestamp,
    summaryText: event.summaryText,
  });
}
