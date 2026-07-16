import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import { applyAgentMessageToSummary, applyUserPromptToSummary } from "../../../sessions/facade";
import type { HelmHandlerContext } from "../../../handlers/context";
import { emitFirstHelmPromptTrace } from "../../prompt-trace";
import {
  normalizeRuntimeAssistantMessageId,
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
  const prepared = prepareRuntimeSessionUpdate(
    sessionId,
    { type: "message", message: finalizedMessage },
    context,
    finalizedMessage.sequence,
  );
  routeCanonicalTimelineEvent(
    sessionId,
    {
      type: "message",
      message: {
        ...finalizedMessage,
        sequence: finalizedMessage.sequence ?? prepared.resolvedSequence,
      },
    },
    context,
    prepared.resolvedSequence,
    prepared.update,
  );
  context.updateSessionSummary(sessionId, (current) =>
    applyAgentMessageToSummary(current, finalizedMessage),
  );
  return true;
}
