import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { SessionLiveStateSnapshot } from "@tiller/shared";
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
        const snapshot = deps.liveStateStore.patch(sessionId, {
          compactionState: {
            phase: "started",
            source: event.source,
            timestamp: event.timestamp,
          },
        });
        publishLiveState(sessionId, snapshot, deps.context);
        return "live_state" as const;
      }
      const worker = deps.workers.forSession(sessionId);
      worker.enqueue(event);
      const batches = worker.flush();
      for (const batch of batches) {
        deps.dispatcher.dispatch(sessionId, batch);
      }
      const snapshot = deps.liveStateStore.patch(sessionId, {
        compactionState: undefined,
      });
      publishLiveState(sessionId, snapshot, deps.context);
      return "timeline" as const;
    }
    case "plan-update": {
      const snapshot = deps.liveStateStore.patch(sessionId, { plan: event.plan });
      publishLiveState(sessionId, snapshot, deps.context);
      return "live_state" as const;
    }
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

function publishLiveState(
  sessionId: string,
  snapshot: SessionLiveStateSnapshot,
  context: HelmHandlerContext,
) {
  createSessionEventPublisher(context).sessionUpdate(sessionId, {
    kind: "live_state",
    snapshot,
  });
}
