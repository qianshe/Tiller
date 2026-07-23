import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { SessionPromptQueueSnapshot, SessionUpdateRecord } from "@tiller/shared";
import type { HelmHandlerContext } from "../../../handlers/context";
import { removeRuntimeSegmentState } from "../../segment-state";
import { routeSessionRuntimeEvent } from "../../session-timeline/event-router";
import {
  createSessionUpdateRecord,
  type PersistedSessionEvent,
} from "../../session-updates/reducer";
import { createSessionEventPublisher } from "./publisher";
import type { CanonicalSessionStateEvent } from "./state-reducer";
import {
  clearRuntimeEventTimer,
  logRuntimeDebug,
  logRuntimeError,
  type PendingCommandOutput,
  type PendingRunningToolCall,
  type PendingToolCallPlaceholders,
  RUNTIME_EVENT_STATE_KEY,
  runtimeEventState,
  runtimeLogFields,
  type RuntimePlanLogState,
  type TimerHandle,
} from "./support";

type CanonicalTimelineContext = HelmHandlerContext & Required<Pick<
  HelmHandlerContext,
  | "sessionTimelineWorkers"
  | "sessionTimelineDispatcher"
  | "sessionTimelineFlushScheduler"
  | "sessionLiveStateStore"
>>;

export function seedLiveEventSequenceForSession(
  sessionId: string,
  sequences: ReadonlyArray<number | undefined>,
  context: HelmHandlerContext,
) {
  runtimeEventState(context).seedSequence(sessionId, sequences);
}

export function ensureLiveEventSequenceForSession(
  sessionId: string,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  if (state.isSequenceInitialized(sessionId)) {
    return;
  }
  state.ensureSequence(sessionId, [
    context.sessionLiveStateStore?.get(sessionId)?.sequence,
    context.sessionUpdateStore?.getMaxSequence?.(sessionId),
  ]);
}

export function allocateLiveEventSequence(
  sessionId: string,
  context: HelmHandlerContext,
) {
  ensureLiveEventSequenceForSession(sessionId, context);
  return runtimeEventState(context).allocateSequence(sessionId);
}

export function nextLiveEventSequence(sessionId: string, context: HelmHandlerContext) {
  return allocateLiveEventSequence(sessionId, context);
}

export function peekLiveEventSequence(sessionId: string, context: HelmHandlerContext) {
  return runtimeEventState(context).peekSequence(sessionId);
}

export function hasCanonicalTimelinePipeline(
  context: HelmHandlerContext,
): context is CanonicalTimelineContext {
  return Boolean(
    context.sessionTimelineWorkers &&
      context.sessionTimelineDispatcher &&
      context.sessionTimelineFlushScheduler &&
      context.sessionLiveStateStore,
  );
}

export function assertCanonicalTimelinePipeline(
  context: HelmHandlerContext,
): asserts context is CanonicalTimelineContext {
  if (!hasCanonicalTimelinePipeline(context)) {
    throw new Error("Canonical runtime services are required.");
  }
}

export function routeCanonicalTimelineEvent(
  sessionId: string,
  event: PersistedSessionEvent,
  context: CanonicalTimelineContext,
  sequence?: number,
  update?: SessionUpdateRecord,
) {
  return routeSessionRuntimeEvent(sessionId, event, {
    workers: context.sessionTimelineWorkers,
    flushScheduler: context.sessionTimelineFlushScheduler,
    context,
  }, sequence, update);
}

export function nextLiveEventSequenceForTest(
  sessionId: string,
  context: HelmHandlerContext,
) {
  return allocateLiveEventSequence(sessionId, context);
}

export function persistRuntimeSessionUpdate(
  sessionId: string,
  event: PersistedSessionEvent,
  context: HelmHandlerContext,
  sequence?: number,
) {
  if (!isPersistedSessionStateEvent(event)) {
    throw new Error("Timeline updates must be committed by the timeline dispatcher.");
  }
  return commitCanonicalStateEvent(sessionId, event, context, sequence)?.sequence;
}

export function commitCanonicalStateEvent(
  sessionId: string,
  event: Exclude<CanonicalSessionStateEvent, { type: "pending-approval-count" }>,
  context: HelmHandlerContext,
  sequence?: number,
) {
  assertCanonicalTimelinePipeline(context);
  const prepared = prepareRuntimeSessionUpdate(sessionId, event, context, sequence);
  try {
    const snapshot = context.sessionLiveStateStore.commit(
      sessionId,
      event,
      prepared.resolvedSequence,
      prepared.update,
    );
    if (!snapshot) {
      throw new Error("Canonical session state persistence is unavailable.");
    }
    createSessionEventPublisher(context).sessionUpdate(sessionId, {
      kind: "live_state",
      snapshot,
    });
    return { sequence: prepared.resolvedSequence, snapshot };
  } catch (error) {
    logRuntimeError(context, "runtime.session_state.commit_failed", {
      ...runtimeLogFields(sessionId, context),
      seq: prepared.resolvedSequence,
      type: event.type,
      message: error instanceof Error ? error.message : "Failed to commit canonical session state.",
    });
    return undefined;
  }
}

export function prepareRuntimeSessionUpdate(
  sessionId: string,
  event: PersistedSessionEvent,
  context: HelmHandlerContext,
  sequence?: number,
) {
  ensureLiveEventSequenceForSession(sessionId, context);
  const resolvedSequence = sequence ?? sequenceFromRuntimeEvent(event) ?? nextLiveEventSequence(sessionId, context);
  const record = context.sessions?.get?.(sessionId);
  const summary = record?.summary ?? context.sessionStore?.get?.(sessionId);
  const update = createSessionUpdateRecord({
    sessionId,
    runtimeSessionId: record?.runtime?.runtimeSessionId ?? summary?.runtimeSessionId ?? sessionId,
    providerId: record?.agent?.id ?? summary?.agentId ?? "unknown",
    sequence: resolvedSequence,
    source: "acp_live",
    event,
  });
  context.runtimeMetrics?.observe(sessionId, {
    providerId: update.providerId,
    sequence: resolvedSequence,
    eventType: event.type,
    payloadBytes: Buffer.byteLength(update.payloadJson),
  });
  return {
    resolvedSequence,
    update,
  };
}

function isPersistedSessionStateEvent(
  event: PersistedSessionEvent,
): event is Exclude<CanonicalSessionStateEvent, { type: "pending-approval-count" }> {
  switch (event.type) {
    case "status":
    case "config-options":
    case "model-options":
    case "mode-update":
    case "plan-update":
    case "available-commands":
    case "usage-update":
    case "session-info":
    case "diff-update":
    case "prompt-queue":
      return true;
    default:
      return false;
  }
}

export function cleanupRuntimeEventState(
  sessionId: string,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  clearRuntimeEventTimer(
    context,
    state.get<TimerHandle>(sessionId, RUNTIME_EVENT_STATE_KEY.assistantDeltaTimer),
  );
  clearRuntimeEventTimer(
    context,
    state.get<PendingCommandOutput>(
      sessionId,
      RUNTIME_EVENT_STATE_KEY.pendingCommandOutput,
    )?.timer,
  );
  clearRuntimeEventTimer(
    context,
    state.get<PendingRunningToolCall>(
      sessionId,
      RUNTIME_EVENT_STATE_KEY.pendingRunningToolCall,
    )?.timer,
  );
  const pendingToolCallPlaceholders = state.get<PendingToolCallPlaceholders>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.pendingToolCallPlaceholders,
  );
  for (const placeholder of pendingToolCallPlaceholders?.values() ?? []) {
    clearRuntimeEventTimer(context, placeholder.timer);
  }
  state.remove(sessionId);
  removeRuntimeSegmentState(sessionId);
}

export function sequenceFromRuntimeEvent(event: PersistedSessionEvent) {
  switch (event.type) {
    case "message":
      return event.message.sequence;
    case "tool-call":
      return event.toolCall.sequence;
    case "command-output":
      return event.chunk.sequence;
    default:
      return undefined;
  }
}

export function publishPromptQueueState(
  sessionId: string,
  snapshot: SessionPromptQueueSnapshot,
  context: HelmHandlerContext,
) {
  publishCanonicalSessionStateEvent(
    sessionId,
    { type: "prompt-queue", snapshot },
    context,
  );
}

/** Publishes a non-timeline runtime state change through the canonical path. */
export function publishCanonicalSessionStateEvent(
  sessionId: string,
  event: Exclude<CanonicalSessionStateEvent, { type: "pending-approval-count" }>,
  context: HelmHandlerContext,
) {
  return commitCanonicalStateEvent(sessionId, event, context)?.sequence;
}

export function logRuntimePlanUpdate(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "plan-update" }>,
  context: HelmHandlerContext,
  sequence?: number,
) {
  const entries = event.plan.entries.length;
  const state = runtimeEventState(context);
  const previousEntries = state.get<RuntimePlanLogState>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.planLogState,
  )?.lastEntryCount ?? 0;
  state.set(sessionId, RUNTIME_EVENT_STATE_KEY.planLogState, { lastEntryCount: entries });
  if (entries > 0) {
    logRuntimeDebug(context, "runtime.plan.updated", {
      ...runtimeLogFields(sessionId, context),
      seq: sequence ?? peekLiveEventSequence(sessionId, context),
      entries,
    });
    return;
  }
  if (previousEntries > 0) {
    logRuntimeDebug(context, "runtime.plan.cleared", {
      ...runtimeLogFields(sessionId, context),
      seq: sequence ?? peekLiveEventSequence(sessionId, context),
      previousEntries,
    });
  }
}
