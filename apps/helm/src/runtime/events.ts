import { expandAdapterRuntimeEvent, type SessionRuntimeEvent } from "@tiller/acp-runtime";
import { compactBinaryToolCallOutput } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import {
  assertCanonicalTimelinePipeline,
  ensureLiveEventSequenceForSession,
  peekLiveEventSequence,
  sequenceFromRuntimeEvent,
} from "./session/event/canonical";
import {
  flushCommandOutputSummaries,
  flushPendingCommandOutput,
} from "./session/event/command-output";
import {
  hasPendingTimelineCompaction,
  inferPendingCompactionCompletion,
} from "./session/event/compaction";
import { dispatchNormalizedRuntimeEvent } from "./session/event/dispatch";
import { flushLiveAssistantMessage } from "./session/event/message-stream";
import {
  flushPendingRunningToolCall,
  persistActiveRuntimeToolCalls,
} from "./session/event/tool-call";
import {
  flushIgnoredUserEchoSummary,
  isRuntimeUserMessageEvent,
  shouldIgnoreLateRuntimeEvent,
} from "./session/event/user-echo";
import { logRuntimeDebug, runtimeLogFields } from "./session/event/support";

export {
  allocateLiveEventSequence,
  cleanupRuntimeEventState,
  commitCanonicalStateEvent,
  ensureLiveEventSequenceForSession,
  nextLiveEventSequenceForTest,
  persistRuntimeSessionUpdate,
  prepareRuntimeSessionUpdate,
  publishCanonicalSessionStateEvent,
  publishPromptQueueState,
  seedLiveEventSequenceForSession,
} from "./session/event/canonical";
export { flushLiveAssistantMessage } from "./session/event/message-stream";
export { flushPendingCommandOutput } from "./session/event/command-output";
export {
  flushPendingRunningToolCall,
  persistActiveRuntimeToolCalls,
} from "./session/event/tool-call";
export { flushRuntimeUserEchoLogSummaryForTest } from "./session/event/user-echo";

export function flushRuntimeSessionState(sessionId: string, context: HelmHandlerContext) {
  assertCanonicalTimelinePipeline(context);
  flushLiveAssistantMessage(sessionId, context);
  flushPendingCommandOutput(sessionId, context);
  const persistedToolCallIds = new Set<string>();
  flushPendingRunningToolCall(sessionId, context, {
    persistHistorical: true,
    persistedToolCallIds,
  });
  persistActiveRuntimeToolCalls(sessionId, context, {
    skipToolCallIds: persistedToolCallIds,
  });
  context.sessionTimelineFlushScheduler.flushNow(sessionId);
}

function resolveRuntimeProviderId(
  sessionId: string,
  context: Pick<HelmHandlerContext, "sessions" | "sessionStore">,
) {
  const record = context.sessions.get(sessionId);
  const summary = context.sessionStore.get(sessionId);
  return record?.agent?.id ?? record?.summary?.agentId ?? summary?.agentId;
}

function expandProviderRuntimeEvents(
  sessionId: string,
  event: SessionRuntimeEvent,
  context: Pick<HelmHandlerContext, "sessions" | "sessionStore">,
) {
  return (
    expandAdapterRuntimeEvent(resolveRuntimeProviderId(sessionId, context), event) ?? [event]
  ).map(compactRuntimeToolCallEvent);
}

function compactRuntimeToolCallEvent(event: SessionRuntimeEvent): SessionRuntimeEvent {
  if (event.type !== "tool-call") {
    return event;
  }
  const toolCall = compactBinaryToolCallOutput(event.toolCall);
  return toolCall === event.toolCall ? event : { ...event, toolCall };
}

export function handleRuntimeEvent(
  sessionId: string,
  event: SessionRuntimeEvent,
  context: HelmHandlerContext,
) {
  if (!context.sessions.has(sessionId) && !context.sessionStore.get(sessionId)) {
    return;
  }
  const compactedEvent = compactRuntimeToolCallEvent(event);
  if (
    (compactedEvent.type === "message" ||
      compactedEvent.type === "tool-call" ||
      compactedEvent.type === "command-output") &&
    compactedEvent.origin?.scope === "subagent"
  ) {
    context.sessionSubagentDetailService?.handleEvent(
      sessionId,
      compactedEvent.origin.parentToolCallId,
      compactedEvent,
    );
    return;
  }
  if (compactedEvent.type === "tool-call" && compactedEvent.toolCall.kind === "subagent") {
    context.sessionSubagentDetailService?.registerRoot(sessionId, compactedEvent.toolCall);
  }
  if (
    compactedEvent.type === "status" &&
    (compactedEvent.status === "idle" ||
      compactedEvent.status === "error" ||
      compactedEvent.status === "cancelled")
  ) {
    context.sessionSubagentDetailService?.flush(sessionId);
  }
  assertCanonicalTimelinePipeline(context);
  ensureLiveEventSequenceForSession(sessionId, context);
  if (shouldIgnoreLateRuntimeEvent(sessionId, compactedEvent, context)) {
    flushIgnoredUserEchoSummary(sessionId, context);
    logRuntimeDebug(context, "runtime.event.ignored_late", {
      ...runtimeLogFields(sessionId, context),
      seq: sequenceFromRuntimeEvent(compactedEvent) ?? peekLiveEventSequence(sessionId, context),
      type: compactedEvent.type,
    });
    return;
  }
  if (!isRuntimeUserMessageEvent(compactedEvent)) {
    flushIgnoredUserEchoSummary(sessionId, context);
  }
  if (compactedEvent.type !== "command-output") {
    flushPendingCommandOutput(sessionId, context);
    flushCommandOutputSummaries(sessionId, context);
  }
  if (compactedEvent.type !== "tool-call") {
    flushPendingRunningToolCall(sessionId, context);
  }
  const expandedEvents = expandProviderRuntimeEvents(sessionId, compactedEvent, context);
  const skipPendingCompactionInference =
    expandedEvents.length !== 1 || expandedEvents[0] !== compactedEvent;
  if (hasPendingTimelineCompaction(sessionId, context) && !skipPendingCompactionInference) {
    inferPendingCompactionCompletion(sessionId, compactedEvent, context);
  }
  for (const expandedEvent of expandedEvents) {
    dispatchNormalizedRuntimeEvent(sessionId, expandedEvent, context);
  }
}
