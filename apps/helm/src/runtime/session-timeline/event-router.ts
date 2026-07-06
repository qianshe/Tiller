import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { SessionSummary } from "@tiller/shared";
import type { SessionLiveStateSnapshot } from "@tiller/shared";
import type { HelmHandlerContext } from "../../handlers/context";
import type { SessionTimelineWorkerRegistry } from "./worker-registry";
import type { SessionTimelineFlushScheduler } from "./flush-scheduler";
import type { SessionLiveStateStore } from "./live-state-store";
import { createSessionEventPublisher } from "../session/event/publisher";

export type SessionEventRouterDeps = {
  workers: SessionTimelineWorkerRegistry;
  liveStateStore: SessionLiveStateStore;
  flushScheduler: SessionTimelineFlushScheduler;
  context: HelmHandlerContext;
};

export function routeSessionRuntimeEvent(
  sessionId: string,
  event: SessionRuntimeEvent,
  deps: SessionEventRouterDeps,
) {
  const providerId = resolveSessionProviderId(sessionId, deps.context);
  switch (event.type) {
    case "message":
    case "tool-call":
    case "command-output": {
      const worker = deps.workers.forSession(sessionId, { providerId });
      worker.enqueue(event);
      deps.flushScheduler.schedule(sessionId, event);
      return "timeline" as const;
    }
    case "compaction": {
      const worker = deps.workers.forSession(sessionId, { providerId });
      worker.enqueue(event);
      deps.flushScheduler.schedule(sessionId, event);
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

function resolveSessionProviderId(
  sessionId: string,
  context: HelmHandlerContext,
) {
  const record = context.sessions.get(sessionId);
  const summary = context.sessionStore?.list?.().find((item: SessionSummary) => item.id === sessionId);
  return record?.agent?.id ?? record?.summary?.agentId ?? summary?.agentId;
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
