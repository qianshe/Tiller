import {
  expandAdapterRuntimeEvent,
  type SessionRuntimeEvent,
} from "@tiller/acp-runtime";
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
import {
  flushPendingRunningToolCall,
} from "./session/event/tool-call";
import {
  flushIgnoredUserEchoSummary,
  isRuntimeUserMessageEvent,
  shouldIgnoreLateRuntimeEvent,
} from "./session/event/user-echo";
import {
  logRuntimeDebug,
  runtimeLogFields,
} from "./session/event/support";

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
export { flushRuntimeUserEchoLogSummaryForTest } from "./session/event/user-echo";

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
  return expandAdapterRuntimeEvent(resolveRuntimeProviderId(sessionId, context), event) ?? [event];
}

export function handleRuntimeEvent(
  sessionId: string,
  event: SessionRuntimeEvent,
  context: HelmHandlerContext,
) {
  if (!context.sessions.has(sessionId) && !context.sessionStore.get(sessionId)) {
    return;
  }
  if (
    (event.type === "message" || event.type === "tool-call" || event.type === "command-output") &&
    event.origin?.scope === "subagent"
  ) {
    context.sessionSubagentDetailService?.handleEvent(
      sessionId,
      event.origin.parentToolCallId,
      event,
    );
    return;
  }
  if (event.type === "tool-call" && event.toolCall.kind === "subagent") {
    context.sessionSubagentDetailService?.registerRoot(sessionId, event.toolCall);
  }
  if (
    event.type === "status" &&
    (event.status === "idle" || event.status === "error" || event.status === "cancelled")
  ) {
    context.sessionSubagentDetailService?.flush(sessionId);
  }
  assertCanonicalTimelinePipeline(context);
  ensureLiveEventSequenceForSession(sessionId, context);
  if (shouldIgnoreLateRuntimeEvent(sessionId, event, context)) {
    flushIgnoredUserEchoSummary(sessionId, context);
    logRuntimeDebug(context, "runtime.event.ignored_late", {
      ...runtimeLogFields(sessionId, context),
      seq: sequenceFromRuntimeEvent(event) ?? peekLiveEventSequence(sessionId, context),
      type: event.type,
    });
    return;
  }
  if (!isRuntimeUserMessageEvent(event)) {
    flushIgnoredUserEchoSummary(sessionId, context);
  }
  if (event.type !== "command-output") {
    flushPendingCommandOutput(sessionId, context);
    flushCommandOutputSummaries(sessionId, context);
  }
  if (event.type !== "tool-call" || event.toolCall.kind === "think") {
    flushPendingRunningToolCall(sessionId, context);
  }
  const expandedEvents = expandProviderRuntimeEvents(sessionId, event, context);
  const skipPendingCompactionInference =
    expandedEvents.length !== 1 || expandedEvents[0] !== event;
  if (hasPendingTimelineCompaction(sessionId, context) && !skipPendingCompactionInference) {
    inferPendingCompactionCompletion(sessionId, event, context);
  }
  for (const expandedEvent of expandedEvents) {
    dispatchNormalizedRuntimeEvent(sessionId, expandedEvent, context);
  }
}
