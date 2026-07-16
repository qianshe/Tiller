import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import { compactBinaryToolCallOutput, type AgentToolCall } from "@tiller/shared";
import type { HelmHandlerContext } from "../../../handlers/context";
import { emitFirstHelmPromptTrace } from "../../prompt-trace";
import {
  bumpAssistantStreamSegment,
  finalizeActiveRuntimeThinking,
  markAssistantStreamBoundary,
  normalizeRuntimeThinkingToolCall,
} from "../../segment-state";
import {
  assertCanonicalTimelinePipeline,
  nextLiveEventSequence,
  prepareRuntimeSessionUpdate,
  routeCanonicalTimelineEvent,
} from "./canonical";
import { flushLiveAssistantMessage } from "./message-stream";
import { createSessionEventPublisher } from "./publisher";
import {
  clearRuntimeEventTimer,
  MAX_TRACKED_TOOL_CALL_CLASSIFICATIONS,
  type PendingRunningToolCall,
  type PendingToolCallPlaceholders,
  resolveRuntimeEventThrottleConfig,
  RUNTIME_EVENT_STATE_KEY,
  runtimeEventState,
  scheduleRuntimeEventTimer,
  type StableToolCallClassification,
  type StableToolCallOccurrence,
} from "./support";

const TOOL_CALL_PLACEHOLDER_GRACE_MS = 750;

function estimateToolCallGrowth(
  previous: AgentToolCall | undefined,
  next: AgentToolCall,
) {
  const previousLength = previous?.output?.length ?? 0;
  const nextLength = next.output?.length ?? 0;
  return Math.max(0, nextLength - previousLength);
}

function consumePendingRunningToolCall(
  sessionId: string,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  const pending = state.get<PendingRunningToolCall>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.pendingRunningToolCall,
  );
  if (!pending) {
    return null;
  }
  clearRuntimeEventTimer(context, pending.timer);
  state.delete(sessionId, RUNTIME_EVENT_STATE_KEY.pendingRunningToolCall);
  return pending;
}

function emitRuntimeToolCallSnapshot(
  sessionId: string,
  toolCall: AgentToolCall,
  context: HelmHandlerContext,
  updateSequence?: number,
) {
  assertCanonicalTimelinePipeline(context);
  const stableToolCall = stabilizeRuntimeToolCallClassification(sessionId, toolCall, context);
  const orderedToolCall = stabilizeRuntimeToolCallOccurrence(sessionId, {
    ...stableToolCall,
    sequence: stableToolCall.sequence ?? nextLiveEventSequence(sessionId, context),
  }, context);
  trackActiveRuntimeToolCall(sessionId, orderedToolCall, context);
  if (!shouldPersistHistoricalToolCall(orderedToolCall)) {
    createSessionEventPublisher(context).sessionUpdate(sessionId, {
      kind: "tool_call",
      toolCall: orderedToolCall,
    });
    return orderedToolCall;
  }
  const prepared = prepareRuntimeSessionUpdate(
    sessionId,
    { type: "tool-call", toolCall: orderedToolCall },
    context,
    updateSequence ?? orderedToolCall.sequence,
  );
  routeCanonicalTimelineEvent(
    sessionId,
    { type: "tool-call", toolCall: orderedToolCall },
    context,
    prepared.resolvedSequence,
    prepared.update,
  );
  return orderedToolCall;
}

export function flushPendingRunningToolCall(
  sessionId: string,
  context: HelmHandlerContext,
) {
  const pending = consumePendingRunningToolCall(sessionId, context);
  if (!pending) {
    return false;
  }
  emitRuntimeToolCallSnapshot(sessionId, pending.toolCall, context);
  return true;
}

function scheduleRunningToolCallFlush(
  sessionId: string,
  context: HelmHandlerContext,
) {
  const pending = runtimeEventState(context).get<PendingRunningToolCall>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.pendingRunningToolCall,
  );
  if (!pending) {
    return false;
  }
  const config = resolveRuntimeEventThrottleConfig(context);
  if (
    pending.bufferedChars >= config.toolCallMaxChars ||
    config.toolCallWindowMs <= 0
  ) {
    return flushPendingRunningToolCall(sessionId, context);
  }
  if (pending.timer) {
    return false;
  }
  pending.timer = scheduleRuntimeEventTimer(
    context,
    () => {
      flushPendingRunningToolCall(sessionId, context);
    },
    config.toolCallWindowMs,
  );
  return false;
}

function bufferRunningToolCall(
  sessionId: string,
  toolCall: AgentToolCall,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  const pending = state.get<PendingRunningToolCall>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.pendingRunningToolCall,
  );
  if (pending && pending.toolCall.id === toolCall.id) {
    clearRuntimeEventTimer(context, pending.timer);
    pending.timer = undefined;
    const mergedToolCall = {
      ...pending.toolCall,
      ...toolCall,
      kind: pending.toolCall.kind,
      output: mergeToolCallOutput(pending.toolCall.output, toolCall.output),
      timestamp: pending.toolCall.timestamp,
      updatedAt: toolCall.updatedAt,
      sequence: pending.toolCall.sequence ?? toolCall.sequence,
    };
    pending.bufferedChars += estimateToolCallGrowth(pending.toolCall, mergedToolCall);
    pending.toolCall = mergedToolCall;
    scheduleRunningToolCallFlush(sessionId, context);
    return;
  }
  const previous = consumePendingRunningToolCall(sessionId, context);
  if (previous) {
    emitRuntimeToolCallSnapshot(sessionId, previous.toolCall, context);
  }
  state.set(sessionId, RUNTIME_EVENT_STATE_KEY.pendingRunningToolCall, {
    toolCall,
    bufferedChars: estimateToolCallGrowth(undefined, toolCall),
  });
  scheduleRunningToolCallFlush(sessionId, context);
}

function mergeToolCallOutput(
  current: string | undefined,
  incoming: string | undefined,
) {
  if (!incoming) {
    return current;
  }
  if (!current || incoming.startsWith(current)) {
    return incoming;
  }
  if (current.startsWith(incoming) || current.endsWith(incoming)) {
    return current;
  }
  return `${current}${incoming}`;
}

function mergeBufferedToolCallSnapshot(
  current: AgentToolCall,
  incoming: AgentToolCall,
) {
  return compactBinaryToolCallOutput({
    ...current,
    ...incoming,
    kind: current.kind,
    title: resolveBufferedToolCallTitle(current, incoming),
    mcp: incoming.mcp ?? current.mcp,
    input: incoming.input ?? current.input,
    output: mergeToolCallOutput(current.output, incoming.output),
    timestamp: current.timestamp,
    updatedAt: incoming.updatedAt,
    sequence: current.sequence ?? incoming.sequence,
  });
}

function consumePendingToolCallPlaceholder(
  sessionId: string,
  toolCallId: string,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  const pending = state.get<PendingToolCallPlaceholders>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.pendingToolCallPlaceholders,
  );
  if (!pending) {
    return null;
  }
  const placeholder = pending.get(toolCallId);
  if (!placeholder) {
    return null;
  }
  clearRuntimeEventTimer(context, placeholder.timer);
  pending.delete(toolCallId);
  if (pending.size === 0) {
    state.delete(sessionId, RUNTIME_EVENT_STATE_KEY.pendingToolCallPlaceholders);
  }
  return placeholder.toolCall;
}

function bufferToolCallPlaceholder(
  sessionId: string,
  toolCall: AgentToolCall,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  const pending = state.get<PendingToolCallPlaceholders>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.pendingToolCallPlaceholders,
  ) ?? new Map();
  state.set(sessionId, RUNTIME_EVENT_STATE_KEY.pendingToolCallPlaceholders, pending);
  const current = pending.get(toolCall.id);
  const placeholder = {
    toolCall: current
      ? mergeBufferedToolCallSnapshot(current.toolCall, toolCall)
      : toolCall,
    timer: current?.timer,
  };
  pending.set(toolCall.id, placeholder);
  if (!placeholder.timer && isLiveToolCallPlaceholder(placeholder.toolCall)) {
    placeholder.timer = scheduleRuntimeEventTimer(
      context,
      () => {
        const fallback = consumePendingToolCallPlaceholder(sessionId, toolCall.id, context);
        if (fallback) {
          emitRuntimeToolCallSnapshot(sessionId, fallback, context);
        }
      },
      TOOL_CALL_PLACEHOLDER_GRACE_MS,
    );
  }
  while (pending.size > MAX_TRACKED_TOOL_CALL_CLASSIFICATIONS) {
    const oldestId = pending.keys().next().value;
    if (typeof oldestId !== "string") {
      break;
    }
    clearRuntimeEventTimer(context, pending.get(oldestId)?.timer);
    pending.delete(oldestId);
  }
}

function isLiveToolCallPlaceholder(toolCall: AgentToolCall) {
  return toolCall.status === "pending" || toolCall.status === "running";
}

function isWeakToolCallKind(kind: AgentToolCall["kind"]) {
  return kind === "tool" || kind === "unknown";
}

function shouldDeferToolCallPlaceholder(toolCall: AgentToolCall) {
  if (toolCall.kind === "subagent" || toolCall.mcp) {
    return false;
  }
  const title = toolCall.title.trim();
  if (!title || /^Tool call\b/iu.test(title) || /^call_[A-Za-z0-9]+$/u.test(title)) {
    return true;
  }
  return /^(?:tool|shell|read|write|search|grep|glob|diagnostics|skill|todo|fetch|mcp|unknown)$/iu.test(title) &&
    !hasMeaningfulToolCallPayload(toolCall.input);
}

function hasMeaningfulToolCallPayload(value: string | undefined) {
  const normalized = value?.trim();
  return Boolean(normalized && !/^(?:\{\}|\[\]|null)$/u.test(normalized));
}

export function hasMeaningfulRuntimeThinkingOutput(output: string | undefined) {
  const normalized = output?.replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "").trim();
  const marker = normalized?.toLowerCase();
  return Boolean(marker && marker !== "{}" && marker !== "[]" && marker !== "null");
}

function stabilizeRuntimeToolCallClassification(
  sessionId: string,
  toolCall: AgentToolCall,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  const classifications = state.get<Map<string, StableToolCallClassification>>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.toolCallClassifications,
  ) ?? new Map<string, StableToolCallClassification>();
  state.set(sessionId, RUNTIME_EVENT_STATE_KEY.toolCallClassifications, classifications);
  const current = classifications.get(toolCall.id);
  if (!current || (isWeakToolCallKind(current.kind) && !isWeakToolCallKind(toolCall.kind))) {
    classifications.set(toolCall.id, {
      kind: toolCall.kind,
      ...(toolCall.mcp ? { mcp: toolCall.mcp } : {}),
      ...(toolCall.kind === "mcp" ? { title: toolCall.title } : {}),
    });
    while (classifications.size > MAX_TRACKED_TOOL_CALL_CLASSIFICATIONS) {
      const oldestId = classifications.keys().next().value;
      if (typeof oldestId !== "string") {
        break;
      }
      classifications.delete(oldestId);
    }
    return toolCall;
  }
  return {
    ...toolCall,
    kind: current.kind,
    ...(current.mcp ? { mcp: current.mcp } : {}),
    ...(current.kind === "mcp" && current.title ? { title: current.title } : {}),
  };
}

function stabilizeRuntimeToolCallOccurrence(
  sessionId: string,
  toolCall: AgentToolCall,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  const occurrences = state.get<Map<string, StableToolCallOccurrence>>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.toolCallOccurrences,
  ) ?? new Map<string, StableToolCallOccurrence>();
  state.set(sessionId, RUNTIME_EVENT_STATE_KEY.toolCallOccurrences, occurrences);
  const current = occurrences.get(toolCall.id);
  const status = current && isTerminalToolCallStatus(current.status) &&
      !isTerminalToolCallStatus(toolCall.status)
    ? current.status
    : toolCall.status;
  if (!current) {
    occurrences.set(toolCall.id, {
      sequence: toolCall.sequence,
      timestamp: toolCall.timestamp,
      status,
    });
    while (occurrences.size > MAX_TRACKED_TOOL_CALL_CLASSIFICATIONS) {
      const oldestId = occurrences.keys().next().value;
      if (typeof oldestId !== "string") break;
      occurrences.delete(oldestId);
    }
    return toolCall;
  }
  occurrences.set(toolCall.id, { ...current, status });
  return {
    ...toolCall,
    sequence: current.sequence ?? toolCall.sequence,
    timestamp: current.timestamp,
    status,
  };
}

function isTerminalToolCallStatus(status: AgentToolCall["status"]) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function trackActiveRuntimeToolCall(
  sessionId: string,
  toolCall: AgentToolCall,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  const active = state.get<Map<string, AgentToolCall>>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.activeToolCalls,
  ) ?? new Map<string, AgentToolCall>();
  state.set(sessionId, RUNTIME_EVENT_STATE_KEY.activeToolCalls, active);
  if (toolCall.status === "pending" || toolCall.status === "running") {
    const current = active.get(toolCall.id);
    active.set(
      toolCall.id,
      current ? mergeBufferedToolCallSnapshot(current, toolCall) : toolCall,
    );
    return;
  }
  active.delete(toolCall.id);
}

function mergeActiveRuntimeToolCallSnapshot(
  sessionId: string,
  toolCall: AgentToolCall,
  context: HelmHandlerContext,
) {
  const active = runtimeEventState(context).get<Map<string, AgentToolCall>>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.activeToolCalls,
  );
  const current = active?.get(toolCall.id);
  return current ? mergeBufferedToolCallSnapshot(current, toolCall) : toolCall;
}

export function finalizeActiveRuntimeToolCalls(
  sessionId: string,
  status: Extract<AgentToolCall["status"], "completed" | "failed" | "cancelled">,
  context: HelmHandlerContext,
  options: { includeSubagents?: boolean } = {},
) {
  const state = runtimeEventState(context);
  const active = state.get<Map<string, AgentToolCall>>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.activeToolCalls,
  );
  if (!active?.size) {
    return;
  }
  const now = new Date().toISOString();
  for (const toolCall of [...active.values()]) {
    if (toolCall.kind === "subagent" && options.includeSubagents === false) {
      continue;
    }
    emitRuntimeToolCallSnapshot(sessionId, {
      ...toolCall,
      status,
      updatedAt: now,
    }, context, nextLiveEventSequence(sessionId, context));
    active.delete(toolCall.id);
  }
  if (active.size === 0) {
    state.delete(sessionId, RUNTIME_EVENT_STATE_KEY.activeToolCalls);
  }
}

export function finalizeRuntimeThinking(
  sessionId: string,
  status: Extract<AgentToolCall["status"], "completed" | "failed" | "cancelled">,
  context: HelmHandlerContext,
) {
  assertCanonicalTimelinePipeline(context);
  const finalizedThinking = finalizeActiveRuntimeThinking(sessionId, status);
  if (!finalizedThinking) {
    return;
  }
  const prepared = prepareRuntimeSessionUpdate(
    sessionId,
    { type: "tool-call", toolCall: finalizedThinking },
    context,
    nextLiveEventSequence(sessionId, context),
  );
  routeCanonicalTimelineEvent(
    sessionId,
    {
      type: "tool-call",
      toolCall: {
        ...finalizedThinking,
        sequence: finalizedThinking.sequence ?? prepared.resolvedSequence,
      },
    },
    context,
    prepared.resolvedSequence,
    prepared.update,
  );
}

function resolveBufferedToolCallTitle(
  current: AgentToolCall,
  incoming: AgentToolCall,
) {
  const title = incoming.title.trim();
  if (!title || /^Tool call\b/iu.test(title) || /^call_[A-Za-z0-9]+$/u.test(title)) {
    return current.title;
  }
  if (
    /^(?:tool|shell|read|write|search|grep|glob|diagnostics|skill|subagent|todo)$/iu.test(title) &&
    current.title.trim().length > title.length
  ) {
    return current.title;
  }
  return incoming.title;
}

function shouldPersistHistoricalToolCall(toolCall: AgentToolCall) {
  return toolCall.kind === "subagent" ||
    toolCall.status === "completed" ||
    toolCall.status === "failed" ||
    toolCall.status === "cancelled";
}

export function handleRuntimeToolCallEvent(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "tool-call" }>,
  context: HelmHandlerContext,
) {
  emitFirstHelmPromptTrace(context, {
    sessionId,
    phase: "helm.runtime.first_tool_call",
    meta: { kind: event.toolCall.kind },
  });
  if (event.toolCall.kind === "think") {
    if (!hasMeaningfulRuntimeThinkingOutput(event.toolCall.output)) {
      return;
    }
    assertCanonicalTimelinePipeline(context);
    const notificationSequence = event.toolCall.sequence ?? nextLiveEventSequence(sessionId, context);
    const toolCall = normalizeRuntimeThinkingToolCall(sessionId, {
      ...event.toolCall,
      sequence: notificationSequence,
    });
    const prepared = prepareRuntimeSessionUpdate(
      sessionId,
      { ...event, toolCall },
      context,
      notificationSequence,
    );
    routeCanonicalTimelineEvent(
      sessionId,
      {
        ...event,
        toolCall: {
          ...toolCall,
          sequence: toolCall.sequence ?? prepared.resolvedSequence,
        },
      },
      context,
      prepared.resolvedSequence,
      prepared.update,
    );
    return;
  }
  const stableToolCall = stabilizeRuntimeToolCallClassification(
    sessionId,
    event.toolCall,
    context,
  );
  flushLiveAssistantMessage(sessionId, context);
  if (stableToolCall.kind !== "subagent") {
    finalizeRuntimeThinking(sessionId, "completed", context);
    bumpAssistantStreamSegment(sessionId);
  } else {
    markAssistantStreamBoundary(sessionId);
  }
  const notificationSequence = stableToolCall.sequence ?? nextLiveEventSequence(sessionId, context);
  const compactedToolCall = compactBinaryToolCallOutput({
    ...stableToolCall,
    sequence: notificationSequence,
  });
  const activeToolCall = stabilizeRuntimeToolCallOccurrence(
    sessionId,
    mergeActiveRuntimeToolCallSnapshot(sessionId, compactedToolCall, context),
    context,
  );
  trackActiveRuntimeToolCall(sessionId, activeToolCall, context);
  const pendingPlaceholder = consumePendingToolCallPlaceholder(
    sessionId,
    activeToolCall.id,
    context,
  );
  const resolvedPlaceholder = pendingPlaceholder
    ? mergeBufferedToolCallSnapshot(pendingPlaceholder, activeToolCall)
    : activeToolCall;
  if (shouldDeferToolCallPlaceholder(resolvedPlaceholder)) {
    bufferToolCallPlaceholder(sessionId, resolvedPlaceholder, context);
    return;
  }
  if (
    resolvedPlaceholder.kind !== "subagent" &&
    resolvedPlaceholder.status === "running"
  ) {
    bufferRunningToolCall(sessionId, resolvedPlaceholder, context);
    return;
  }
  const pendingRunningToolCall = consumePendingRunningToolCall(sessionId, context);
  if (pendingRunningToolCall && pendingRunningToolCall.toolCall.id !== resolvedPlaceholder.id) {
    emitRuntimeToolCallSnapshot(sessionId, pendingRunningToolCall.toolCall, context);
  }
  const resolvedToolCall = pendingRunningToolCall?.toolCall.id === resolvedPlaceholder.id
    ? mergeBufferedToolCallSnapshot(pendingRunningToolCall.toolCall, resolvedPlaceholder)
    : resolvedPlaceholder;
  emitRuntimeToolCallSnapshot(
    sessionId,
    resolvedToolCall,
    context,
    notificationSequence,
  );
}
