import { expandAdapterRuntimeEvent, type SessionRuntimeEvent } from "@tiller/acp-runtime";
import { applyAgentMessageToSummary, applyUserPromptToSummary } from "../../../sessions/facade";
import { hydrateRuntimeCompactionEventSummary } from "../../../sessions/compaction-summary";
import type { HelmHandlerContext } from "../../../handlers/context";
import { emitFirstHelmPromptTrace } from "../../prompt-trace";
import {
  normalizeRuntimeAssistantMessageId,
  shouldFlushActiveAssistantSegment,
  startNextAssistantResponseSegment,
} from "../../segment-state";
import {
  assertCanonicalTimelinePipeline,
  nextLiveEventSequence,
  prepareRuntimeSessionUpdate,
  routeCanonicalTimelineEvent,
} from "./canonical";
import { createSessionEventPublisher } from "./publisher";
import {
  clearRuntimeEventTimer,
  resolveRuntimeEventThrottleConfig,
  RUNTIME_EVENT_STATE_KEY,
  runtimeEventState,
  scheduleRuntimeEventTimer,
  type TimerHandle,
} from "./support";
import {
  flushIgnoredUserEchoSummary,
  recordIgnoredUserEcho,
  shouldIgnoreRuntimeUserMessage,
} from "./user-echo";

function clearAssistantDeltaTimer(
  sessionId: string,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  clearRuntimeEventTimer(
    context,
    state.get<TimerHandle>(sessionId, RUNTIME_EVENT_STATE_KEY.assistantDeltaTimer),
  );
  state.delete(sessionId, RUNTIME_EVENT_STATE_KEY.assistantDeltaTimer);
}

function flushPendingAssistantDelta(
  sessionId: string,
  context: HelmHandlerContext,
) {
  clearAssistantDeltaTimer(sessionId, context);
  const deltaMessage = context.liveMessageBuffer.flushPending(sessionId);
  if (!deltaMessage) {
    return false;
  }
  const streamingDelta = {
    ...deltaMessage,
    streaming: true,
  };
  const orderedDelta = {
    ...streamingDelta,
    sequence: streamingDelta.sequence ?? nextLiveEventSequence(sessionId, context),
  };
  createSessionEventPublisher(context).sessionUpdate(sessionId, {
    kind: "agent_message",
    message: orderedDelta,
    streaming: true,
  });
  return true;
}

export function scheduleAssistantDeltaFlush(
  sessionId: string,
  context: HelmHandlerContext,
) {
  const pendingChars = context.liveMessageBuffer.pendingLength(sessionId);
  if (pendingChars <= 0) {
    clearAssistantDeltaTimer(sessionId, context);
    return false;
  }
  const config = resolveRuntimeEventThrottleConfig(context);
  if (pendingChars >= config.assistantMaxChars || config.assistantWindowMs <= 0) {
    return flushPendingAssistantDelta(sessionId, context);
  }
  const state = runtimeEventState(context);
  if (state.has(sessionId, RUNTIME_EVENT_STATE_KEY.assistantDeltaTimer)) {
    return false;
  }
  state.set(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.assistantDeltaTimer,
    scheduleRuntimeEventTimer(
      context,
      () => {
        flushPendingAssistantDelta(sessionId, context);
      },
      config.assistantWindowMs,
    ),
  );
  return false;
}

export function handleRuntimeUserMessage(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "message" }>,
  context: HelmHandlerContext,
) {
  assertCanonicalTimelinePipeline(context);
  startNextAssistantResponseSegment(sessionId);
  flushLiveAssistantMessage(sessionId, context);
  if (shouldIgnoreRuntimeUserMessage(sessionId, event.message, context)) {
    recordIgnoredUserEcho(sessionId, event.message, context);
    return;
  }
  flushIgnoredUserEchoSummary(sessionId, context);
  const prepared = prepareRuntimeSessionUpdate(sessionId, event, context);
  routeCanonicalTimelineEvent(
    sessionId,
    {
      ...event,
      message: {
        ...event.message,
        sequence: event.message.sequence ?? prepared.resolvedSequence,
      },
    },
    context,
    prepared.resolvedSequence,
    prepared.update,
  );
  context.updateSessionSummary(sessionId, (current) =>
    applyUserPromptToSummary(current, event.message.text, event.message.timestamp),
  );
}

export function handleRuntimeAssistantMessage(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "message" }>,
  context: HelmHandlerContext,
) {
  if (shouldFlushActiveAssistantSegment(sessionId, event.message.id)) {
    flushLiveAssistantMessage(sessionId, context);
    startNextAssistantResponseSegment(sessionId);
  }
  const message = {
    ...event.message,
    id: normalizeRuntimeAssistantMessageId(sessionId, event.message),
    sequence: event.message.sequence ?? nextLiveEventSequence(sessionId, context),
  };
  emitFirstHelmPromptTrace(context, {
    sessionId,
    phase: "helm.runtime.first_message",
    meta: { chars: message.text.length },
  });
  if (context.liveMessageBuffer.peek(sessionId)?.id !== message.id) {
    flushLiveAssistantMessage(sessionId, context);
  }
  context.liveMessageBuffer.append(sessionId, message);
  if (message.streaming === false) {
    flushLiveAssistantMessage(sessionId, context);
    return true;
  }
  scheduleAssistantDeltaFlush(sessionId, context);
  return false;
}

export function flushLiveAssistantMessage(
  sessionId: string,
  context: HelmHandlerContext,
) {
  assertCanonicalTimelinePipeline(context);
  clearAssistantDeltaTimer(sessionId, context);
  const message = context.liveMessageBuffer.finalize(sessionId);
  if (!message) {
    return false;
  }
  const finalizedMessage = {
    ...message,
    streaming: false,
  };
  const originalEvent = {
    type: "message" as const,
    message: finalizedMessage,
  };
  const expandedEvents = expandAdapterRuntimeEvent(
    resolveFinalizedMessageProviderId(sessionId, context),
    originalEvent,
  );
  if (expandedEvents?.length && expandedEvents.every(isFinalizedAssistantMessageOrCompaction)) {
    for (const event of expandedEvents) {
      if (event.type === "compaction") {
        routeFinalizedAssistantCompaction(
          sessionId,
          event,
          context,
          finalizedMessage.sequence,
        );
        continue;
      }
      routeFinalizedAssistantMessage(sessionId, event.message, context);
    }
    return true;
  }
  routeFinalizedAssistantMessage(sessionId, finalizedMessage, context);
  return true;
}

function resolveFinalizedMessageProviderId(
  sessionId: string,
  context: Pick<HelmHandlerContext, "sessions" | "sessionStore">,
) {
  const record = context.sessions.get(sessionId);
  return (
    record?.agent?.id ?? record?.summary?.agentId ?? context.sessionStore.get(sessionId)?.agentId
  );
}

function isFinalizedAssistantMessageOrCompaction(
  event: SessionRuntimeEvent,
): event is Extract<SessionRuntimeEvent, { type: "message" | "compaction" }> {
  return event.type === "message" || event.type === "compaction";
}

function routeFinalizedAssistantMessage(
  sessionId: string,
  message: Extract<SessionRuntimeEvent, { type: "message" }>["message"],
  context: HelmHandlerContext,
) {
  assertCanonicalTimelinePipeline(context);
  const prepared = prepareRuntimeSessionUpdate(
    sessionId,
    { type: "message", message },
    context,
    message.sequence,
  );
  routeCanonicalTimelineEvent(
    sessionId,
    {
      type: "message",
      message: {
        ...message,
        sequence: message.sequence ?? prepared.resolvedSequence,
      },
    },
    context,
    prepared.resolvedSequence,
    prepared.update,
  );
  context.updateSessionSummary(sessionId, (current) =>
    applyAgentMessageToSummary(current, message),
  );
}

function routeFinalizedAssistantCompaction(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "compaction" }>,
  context: HelmHandlerContext,
  sequence?: number,
) {
  assertCanonicalTimelinePipeline(context);
  startNextAssistantResponseSegment(sessionId);
  const hydratedEvent = hydrateRuntimeCompactionEventSummary(sessionId, event, context);
  const prepared = prepareRuntimeSessionUpdate(
    sessionId,
    hydratedEvent,
    context,
    sequence,
  );
  routeCanonicalTimelineEvent(
    sessionId,
    hydratedEvent,
    context,
    prepared.resolvedSequence,
    prepared.update,
  );
}
