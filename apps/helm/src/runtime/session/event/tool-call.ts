import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import {
  compactBinaryToolCallOutput,
  resolveMergedAgentToolCallKind,
  type AgentToolCall,
} from "@tiller/shared";
import type { HelmHandlerContext } from "../../../handlers/context";
import { emitFirstHelmPromptTrace } from "../../prompt-trace";
import { bumpAssistantStreamSegment, markAssistantStreamBoundary } from "../../segment-state";
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

type RuntimeToolCallSnapshotOptions = {
  persistHistorical?: boolean;
  persistCanonicalOnly?: boolean;
  persistedToolCallIds?: Set<string>;
};

function estimateToolCallGrowth(previous: AgentToolCall | undefined, next: AgentToolCall) {
  const previousLength = previous?.output?.length ?? 0;
  const nextLength = next.output?.length ?? 0;
  return Math.max(0, nextLength - previousLength);
}

function consumePendingRunningToolCall(sessionId: string, context: HelmHandlerContext) {
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
  options: RuntimeToolCallSnapshotOptions = {},
) {
  assertCanonicalTimelinePipeline(context);
  const stableToolCall = stabilizeRuntimeToolCallClassification(sessionId, toolCall, context);
  const orderedToolCall = stabilizeRuntimeToolCallOccurrence(
    sessionId,
    {
      ...stableToolCall,
      sequence: stableToolCall.sequence ?? nextLiveEventSequence(sessionId, context),
    },
    context,
  );
  trackActiveRuntimeToolCall(sessionId, orderedToolCall, context);
  const persistHistorical =
    options.persistHistorical || shouldPersistHistoricalToolCall(orderedToolCall);
  const persistCanonicalOnly =
    options.persistCanonicalOnly ||
    (isActiveToolCallStatus(orderedToolCall.status) && orderedToolCall.kind !== "subagent");
  if (!persistHistorical && !persistCanonicalOnly) {
    createSessionEventPublisher(context).sessionUpdate(sessionId, {
      kind: "tool_call",
      toolCall: orderedToolCall,
    });
    return orderedToolCall;
  }
  const prepared = persistHistorical
    ? prepareRuntimeSessionUpdate(
        sessionId,
        { type: "tool-call", toolCall: orderedToolCall },
        context,
        updateSequence ?? orderedToolCall.sequence,
      )
    : undefined;
  routeCanonicalTimelineEvent(
    sessionId,
    { type: "tool-call", toolCall: orderedToolCall },
    context,
    prepared?.resolvedSequence ?? orderedToolCall.sequence,
    prepared?.update,
  );
  if (persistHistorical) {
    markHistoricalRuntimeToolCall(sessionId, orderedToolCall.id, context);
  }
  return orderedToolCall;
}

export function flushPendingRunningToolCall(
  sessionId: string,
  context: HelmHandlerContext,
  options: RuntimeToolCallSnapshotOptions = {},
) {
  const pending = runtimeEventState(context).get<PendingRunningToolCall>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.pendingRunningToolCall,
  );
  if (!pending) {
    return false;
  }
  clearRuntimeEventTimer(context, pending.timer);
  pending.timer = undefined;
  if (!pending.hasUnflushedChanges) {
    return false;
  }
  emitRuntimeToolCallSnapshot(sessionId, pending.toolCall, context, undefined, options);
  if (options.persistHistorical) {
    options.persistedToolCallIds?.add(pending.toolCall.id);
  }
  pending.bufferedChars = 0;
  pending.hasUnflushedChanges = false;
  return true;
}

function scheduleRunningToolCallFlush(sessionId: string, context: HelmHandlerContext) {
  const pending = runtimeEventState(context).get<PendingRunningToolCall>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.pendingRunningToolCall,
  );
  if (!pending) {
    return false;
  }
  const config = resolveRuntimeEventThrottleConfig(context);
  if (pending.bufferedChars >= config.toolCallMaxChars || config.toolCallWindowMs <= 0) {
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
    pending.hasUnflushedChanges = true;
    scheduleRunningToolCallFlush(sessionId, context);
    return;
  }
  const previous = consumePendingRunningToolCall(sessionId, context);
  if (previous?.hasUnflushedChanges) {
    emitRuntimeToolCallSnapshot(sessionId, previous.toolCall, context);
  }
  emitRuntimeToolCallSnapshot(sessionId, toolCall, context);
  state.set(sessionId, RUNTIME_EVENT_STATE_KEY.pendingRunningToolCall, {
    toolCall,
    bufferedChars: 0,
    hasUnflushedChanges: false,
  });
}

function mergeToolCallOutput(current: string | undefined, incoming: string | undefined) {
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

function mergeBufferedToolCallSnapshot(current: AgentToolCall, incoming: AgentToolCall) {
  return compactBinaryToolCallOutput({
    ...current,
    ...incoming,
    kind: resolveMergedAgentToolCallKind(current, incoming),
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
  const pending =
    state.get<PendingToolCallPlaceholders>(
      sessionId,
      RUNTIME_EVENT_STATE_KEY.pendingToolCallPlaceholders,
    ) ?? new Map();
  state.set(sessionId, RUNTIME_EVENT_STATE_KEY.pendingToolCallPlaceholders, pending);
  const current = pending.get(toolCall.id);
  const placeholder = {
    toolCall: current ? mergeBufferedToolCallSnapshot(current.toolCall, toolCall) : toolCall,
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
  return (
    /^(?:tool|shell|read|write|search|grep|glob|diagnostics|skill|todo|fetch|mcp|unknown)$/iu.test(
      title,
    ) && !hasMeaningfulToolCallPayload(toolCall.input)
  );
}

function hasMeaningfulToolCallPayload(value: string | undefined) {
  const normalized = value?.trim();
  return Boolean(normalized && !/^(?:\{\}|\[\]|null)$/u.test(normalized));
}

function stabilizeRuntimeToolCallClassification(
  sessionId: string,
  toolCall: AgentToolCall,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  const classifications =
    state.get<Map<string, StableToolCallClassification>>(
      sessionId,
      RUNTIME_EVENT_STATE_KEY.toolCallClassifications,
    ) ?? new Map<string, StableToolCallClassification>();
  state.set(sessionId, RUNTIME_EVENT_STATE_KEY.toolCallClassifications, classifications);
  const current = classifications.get(toolCall.id);
  const shouldUpgradeWeakKind = Boolean(
    current && isWeakToolCallKind(current.kind) && !isWeakToolCallKind(toolCall.kind),
  );
  const resolvedKind =
    !current || shouldUpgradeWeakKind
      ? toolCall.kind
      : resolveMergedAgentToolCallKind(current, toolCall);
  if (!current || resolvedKind !== current.kind || shouldUpgradeWeakKind) {
    classifications.set(toolCall.id, {
      kind: resolvedKind,
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
    return resolvedKind === toolCall.kind ? toolCall : { ...toolCall, kind: resolvedKind };
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
  const occurrences =
    state.get<Map<string, StableToolCallOccurrence>>(
      sessionId,
      RUNTIME_EVENT_STATE_KEY.toolCallOccurrences,
    ) ?? new Map<string, StableToolCallOccurrence>();
  state.set(sessionId, RUNTIME_EVENT_STATE_KEY.toolCallOccurrences, occurrences);
  const current = occurrences.get(toolCall.id);
  const status =
    current &&
    isTerminalToolCallStatus(current.status) &&
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

function hasRuntimeToolCallOccurrence(
  sessionId: string,
  toolCallId: string,
  context: HelmHandlerContext,
) {
  return (
    runtimeEventState(context)
      .get<
        Map<string, StableToolCallOccurrence>
      >(sessionId, RUNTIME_EVENT_STATE_KEY.toolCallOccurrences)
      ?.has(toolCallId) ?? false
  );
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
  const active =
    state.get<Map<string, AgentToolCall>>(sessionId, RUNTIME_EVENT_STATE_KEY.activeToolCalls) ??
    new Map<string, AgentToolCall>();
  state.set(sessionId, RUNTIME_EVENT_STATE_KEY.activeToolCalls, active);
  if (toolCall.status === "pending" || toolCall.status === "running") {
    const current = active.get(toolCall.id);
    active.set(toolCall.id, current ? mergeBufferedToolCallSnapshot(current, toolCall) : toolCall);
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

function isOpenCodeSession(sessionId: string, context: HelmHandlerContext) {
  const record = context.sessions.get(sessionId);
  const providerId =
    record?.agent?.id ?? record?.summary?.agentId ?? context.sessionStore.get(sessionId)?.agentId;
  return providerId?.trim().toLowerCase() === "opencode";
}

function isOpenCodeBackgroundOutputToolCall(toolCall: AgentToolCall) {
  return /^(?:tool:\s*)?background[_ -]?output$/iu.test(toolCall.title.trim());
}

function collectRuntimeToolCallRecords(value: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 6 || value === undefined || value === null) {
    return [];
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return [];
    }
    try {
      return collectRuntimeToolCallRecords(JSON.parse(trimmed) as unknown, depth + 1);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectRuntimeToolCallRecords(item, depth + 1));
  }
  if (typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  const records = [record];
  for (const key of ["metadata", "output", "result", "content", "data", "value", "text"]) {
    if (record[key] !== undefined) {
      records.push(...collectRuntimeToolCallRecords(record[key], depth + 1));
    }
  }
  return records;
}

function resolveOpenCodeBackgroundTaskId(
  toolCall: AgentToolCall,
  kind: "background-output" | "subagent",
) {
  const records = [
    ...collectRuntimeToolCallRecords(toolCall.input),
    ...collectRuntimeToolCallRecords(toolCall.output),
  ];
  const keys =
    kind === "background-output"
      ? ["task_id", "taskId"]
      : ["backgroundTaskId", "background_task_id"];
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return undefined;
}

function rememberOpenCodeSubagentCompletion(
  sessionId: string,
  toolCall: AgentToolCall,
  context: HelmHandlerContext,
) {
  if (
    !isOpenCodeSession(sessionId, context) ||
    toolCall.kind !== "subagent" ||
    !isTerminalToolCallStatus(toolCall.status)
  ) {
    return undefined;
  }
  const taskId = resolveOpenCodeBackgroundTaskId(toolCall, "subagent");
  if (!taskId) {
    return undefined;
  }
  const state = runtimeEventState(context);
  const completed =
    state.get<Map<string, AgentToolCall["status"]>>(
      sessionId,
      RUNTIME_EVENT_STATE_KEY.completedBackgroundTasks,
    ) ?? new Map<string, AgentToolCall["status"]>();
  completed.set(taskId, toolCall.status);
  while (completed.size > MAX_TRACKED_TOOL_CALL_CLASSIFICATIONS) {
    const oldest = completed.keys().next().value;
    if (typeof oldest !== "string") {
      break;
    }
    completed.delete(oldest);
  }
  state.set(sessionId, RUNTIME_EVENT_STATE_KEY.completedBackgroundTasks, completed);
  return { taskId, status: toolCall.status };
}

function clearPendingRunningToolCallForId(
  sessionId: string,
  toolCallId: string,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  const pending = state.get<PendingRunningToolCall>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.pendingRunningToolCall,
  );
  if (pending?.toolCall.id !== toolCallId) {
    return;
  }
  clearRuntimeEventTimer(context, pending.timer);
  state.delete(sessionId, RUNTIME_EVENT_STATE_KEY.pendingRunningToolCall);
}

function completeOpenCodeBackgroundOutputForTask(
  sessionId: string,
  taskId: string,
  status: Extract<AgentToolCall["status"], "completed" | "failed" | "cancelled">,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  const active = state.get<Map<string, AgentToolCall>>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.activeToolCalls,
  );
  const backgroundOutput = [...(active?.values() ?? [])].find(
    (toolCall) =>
      isOpenCodeBackgroundOutputToolCall(toolCall) &&
      resolveOpenCodeBackgroundTaskId(toolCall, "background-output") === taskId &&
      isActiveToolCallStatus(toolCall.status),
  );
  if (!backgroundOutput) {
    return false;
  }
  clearPendingRunningToolCallForId(sessionId, backgroundOutput.id, context);
  emitRuntimeToolCallSnapshot(
    sessionId,
    {
      ...backgroundOutput,
      status,
      updatedAt: new Date().toISOString(),
    },
    context,
    nextLiveEventSequence(sessionId, context),
  );
  return true;
}

function completeKnownOpenCodeBackgroundOutput(
  sessionId: string,
  toolCall: AgentToolCall,
  context: HelmHandlerContext,
) {
  if (
    !isOpenCodeSession(sessionId, context) ||
    !isOpenCodeBackgroundOutputToolCall(toolCall) ||
    !isActiveToolCallStatus(toolCall.status)
  ) {
    return false;
  }
  const taskId = resolveOpenCodeBackgroundTaskId(toolCall, "background-output");
  if (!taskId) {
    return false;
  }
  const status = runtimeEventState(context)
    .get<
      Map<string, AgentToolCall["status"]>
    >(sessionId, RUNTIME_EVENT_STATE_KEY.completedBackgroundTasks)
    ?.get(taskId);
  return status && isTerminalToolCallStatus(status)
    ? completeOpenCodeBackgroundOutputForTask(sessionId, taskId, status, context)
    : false;
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
    emitRuntimeToolCallSnapshot(
      sessionId,
      {
        ...toolCall,
        status,
        updatedAt: now,
      },
      context,
      nextLiveEventSequence(sessionId, context),
    );
    active.delete(toolCall.id);
  }
  if (active.size === 0) {
    state.delete(sessionId, RUNTIME_EVENT_STATE_KEY.activeToolCalls);
  }
}

export function persistActiveRuntimeToolCalls(
  sessionId: string,
  context: HelmHandlerContext,
  options: { skipToolCallIds?: ReadonlySet<string> } = {},
) {
  const state = runtimeEventState(context);
  const active = state.get<Map<string, AgentToolCall>>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.activeToolCalls,
  );
  if (!active?.size) {
    return false;
  }

  let persisted = false;
  const historical = state.get<Set<string>>(sessionId, RUNTIME_EVENT_STATE_KEY.historicalToolCalls);
  for (const toolCall of active.values()) {
    if (historical?.has(toolCall.id) || options.skipToolCallIds?.has(toolCall.id)) {
      continue;
    }
    emitRuntimeToolCallSnapshot(sessionId, toolCall, context, toolCall.sequence, {
      persistHistorical: true,
    });
    persisted = true;
  }
  return persisted;
}

function resolveBufferedToolCallTitle(current: AgentToolCall, incoming: AgentToolCall) {
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
  return (
    toolCall.kind === "subagent" ||
    toolCall.status === "completed" ||
    toolCall.status === "failed" ||
    toolCall.status === "cancelled"
  );
}

function isActiveToolCallStatus(status: AgentToolCall["status"]) {
  return status === "pending" || status === "running";
}

function markHistoricalRuntimeToolCall(
  sessionId: string,
  toolCallId: string,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  const historical =
    state.get<Set<string>>(sessionId, RUNTIME_EVENT_STATE_KEY.historicalToolCalls) ??
    new Set<string>();
  historical.add(toolCallId);
  while (historical.size > MAX_TRACKED_TOOL_CALL_CLASSIFICATIONS) {
    const oldest = historical.values().next().value;
    if (typeof oldest !== "string") {
      break;
    }
    historical.delete(oldest);
  }
  state.set(sessionId, RUNTIME_EVENT_STATE_KEY.historicalToolCalls, historical);
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
  const stableToolCall = stabilizeRuntimeToolCallClassification(sessionId, event.toolCall, context);
  const startsNewToolCall = !hasRuntimeToolCallOccurrence(sessionId, stableToolCall.id, context);
  const updatesAssistantBoundary = stableToolCall.kind === "subagent" || startsNewToolCall;
  if (event.origin?.scope !== "subagent" && updatesAssistantBoundary) {
    flushLiveAssistantMessage(sessionId, context);
    if (stableToolCall.kind !== "subagent") {
      bumpAssistantStreamSegment(sessionId);
    } else {
      markAssistantStreamBoundary(sessionId);
    }
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
  if (resolvedPlaceholder.kind !== "subagent" && resolvedPlaceholder.status === "running") {
    bufferRunningToolCall(sessionId, resolvedPlaceholder, context);
    completeKnownOpenCodeBackgroundOutput(sessionId, resolvedPlaceholder, context);
    return;
  }
  const pendingRunningToolCall = consumePendingRunningToolCall(sessionId, context);
  if (
    pendingRunningToolCall?.hasUnflushedChanges &&
    pendingRunningToolCall.toolCall.id !== resolvedPlaceholder.id
  ) {
    emitRuntimeToolCallSnapshot(sessionId, pendingRunningToolCall.toolCall, context);
  }
  const resolvedToolCall =
    pendingRunningToolCall?.toolCall.id === resolvedPlaceholder.id
      ? mergeBufferedToolCallSnapshot(pendingRunningToolCall.toolCall, resolvedPlaceholder)
      : resolvedPlaceholder;
  emitRuntimeToolCallSnapshot(sessionId, resolvedToolCall, context, notificationSequence);
  completeKnownOpenCodeBackgroundOutput(sessionId, resolvedToolCall, context);
  const completedBackgroundTask = rememberOpenCodeSubagentCompletion(
    sessionId,
    resolvedToolCall,
    context,
  );
  if (completedBackgroundTask) {
    completeOpenCodeBackgroundOutputForTask(
      sessionId,
      completedBackgroundTask.taskId,
      completedBackgroundTask.status,
      context,
    );
  }
}
