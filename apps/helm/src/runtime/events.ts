import { applyAgentMessageToSummary, applyUserPromptToSummary } from "../sessions/facade";
import { expandAdapterRuntimeEvent, type SessionRuntimeEvent } from "@tiller/acp-runtime";
import type {
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  SessionPromptQueueSnapshot,
  SessionTimelineContextCompactionEntry,
  SessionTimelineEntry,
} from "@tiller/shared";
import { compactBinaryToolCallOutput } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import { handleRuntimePermissionRequest } from "./approval-boundary";
import { createSessionEventPublisher } from "./session/event/publisher";
import {
  materializeRuntimeCommandOutputChunk,
} from "./session/event/effects";
import { materializeDiffPayloads } from "./session/diff-payload";
import { emitFirstHelmPromptTrace } from "./prompt-trace";
import { routeSessionRuntimeEvent } from "./session-timeline/event-router";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "./session/config-options";
import {
  bumpAssistantStreamSegment,
  finalizeActiveRuntimeThinking,
  normalizeRuntimeAssistantMessageId,
  normalizeRuntimeThinkingToolCall,
  removeRuntimeSegmentState,
  startNextAssistantResponseSegment,
} from "./segment-state";
import type { TillerLogFields } from "../logging/logger";
import {
  createSessionUpdateRecord,
  type PersistedSessionEvent,
} from "./session-updates/reducer";
import type { CanonicalSessionStateEvent } from "./session/event/state-reducer";
import type { SessionRuntimeEventState } from "./session/event/runtime-state";

const RUNTIME_EVENT_STATE_KEY = {
  assistantDeltaTimer: "assistant-delta-timer",
  commandOutputSummaries: "command-output-summaries",
  ignoredUserEchoSummary: "ignored-user-echo-summary",
  pendingCommandOutput: "pending-command-output",
  pendingRunningToolCall: "pending-running-tool-call",
  planLogState: "plan-log-state",
  activeToolCalls: "active-tool-calls",
  toolCallClassifications: "tool-call-classifications",
} as const;

const DEFAULT_ASSISTANT_FLUSH_WINDOW_MS = 32;
const DEFAULT_ASSISTANT_MAX_CHARS = 256;
const DEFAULT_COMMAND_OUTPUT_FLUSH_WINDOW_MS = 32;
const DEFAULT_COMMAND_OUTPUT_MAX_CHARS = 256;
const DEFAULT_RUNNING_TOOL_CALL_FLUSH_WINDOW_MS = 64;
const DEFAULT_RUNNING_TOOL_CALL_MAX_CHARS = 512;
const MAX_TRACKED_TOOL_CALL_CLASSIFICATIONS = 2_048;

type TimerHandle = ReturnType<typeof setTimeout>;

type RuntimePlanLogState = {
  lastEntryCount: number;
};

type CommandOutputSummary = {
  chars: number;
  chunks: number;
  commandId: string;
  firstSeq: number;
  lastSeq: number;
  stream: string;
};

type PendingCommandOutput = {
  chunk: CommandChunk;
  inputChunks: number;
  timer?: TimerHandle;
};

type PendingRunningToolCall = {
  toolCall: AgentToolCall;
  bufferedChars: number;
  timer?: TimerHandle;
};

type StableToolCallClassification = Pick<AgentToolCall, "kind"> & {
  mcp?: AgentToolCall["mcp"];
  title?: string;
};

type IgnoredUserEchoSummary = {
  count: number;
  firstMessageId: string;
  firstSeq: number;
  lastMessageId: string;
  lastSeq: number;
  messageIds: Set<string>;
  totalChars: number;
};

function runtimeLogScope(sessionId: string, context: HelmHandlerContext) {
  const record = context.sessions.get(sessionId);
  return `session=${sessionId} agent=${record?.agent?.id ?? "<stored>"} cwd=${record?.worktree?.path ?? "<stored>"}`;
}

function runtimeLogFields(sessionId: string, context: HelmHandlerContext): TillerLogFields {
  const record = context.sessions.get(sessionId);
  return {
    sessionId,
    agentId: record?.agent?.id ?? "<stored>",
    cwd: record?.worktree?.path ?? "<stored>",
  };
}

function logRuntimeDebug(context: HelmHandlerContext, event: string, fields: TillerLogFields) {
  if (context.logger) {
    context.logger.debug(event, fields);
    return;
  }
  context.logDebug?.(`[tiller] ${event} ${formatLogFields(fields)}`);
}

function logRuntimeInfo(context: HelmHandlerContext, event: string, fields: TillerLogFields) {
  if (context.logger) {
    context.logger.info(event, fields);
    return;
  }
  context.logInfo?.(`[tiller] ${event} ${formatLogFields(fields)}`);
}

function logRuntimeError(context: HelmHandlerContext, event: string, fields: TillerLogFields) {
  if (context.logger) {
    context.logger.error(event, fields);
    return;
  }
  context.logError?.(`[tiller] ${event} ${formatLogFields(fields)}`);
}

function formatLogFields(fields: TillerLogFields) {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

function runtimeEventState(context: HelmHandlerContext): SessionRuntimeEventState {
  if (context.sessionRuntimeEventState) {
    return context.sessionRuntimeEventState;
  }
  throw new Error("Runtime event state is required.");
}

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

export function allocateLiveEventSequence(sessionId: string, context: HelmHandlerContext) {
  ensureLiveEventSequenceForSession(sessionId, context);
  return runtimeEventState(context).allocateSequence(sessionId);
}

function nextLiveEventSequence(sessionId: string, context: HelmHandlerContext) {
  return allocateLiveEventSequence(sessionId, context);
}

function peekLiveEventSequence(sessionId: string, context: HelmHandlerContext) {
  return runtimeEventState(context).peekSequence(sessionId);
}

function hasPendingTimelineCompaction(
  sessionId: string,
  context: Pick<HelmHandlerContext, "sessionTimelineStore">,
): context is Pick<HelmHandlerContext, "sessionTimelineStore"> & {
  sessionTimelineStore: NonNullable<HelmHandlerContext["sessionTimelineStore"]>;
} {
  return Boolean(findPendingTimelineCompactionEntry(sessionId, context));
}

function findPendingTimelineCompactionEntry(
  sessionId: string,
  context: Pick<HelmHandlerContext, "sessionTimelineStore">,
): SessionTimelineContextCompactionEntry | undefined {
  const entries = context.sessionTimelineStore?.list?.(sessionId) as SessionTimelineEntry[] | undefined;
  if (!entries?.length) {
    return undefined;
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind === "context_compaction" && entry.phase === "started") {
      return entry;
    }
  }
  return undefined;
}

function shouldInferCompactionCompletionFromEvent(event: SessionRuntimeEvent) {
  switch (event.type) {
    case "message":
      return event.message.role === "assistant";
    case "tool-call":
    case "command-output":
    case "permission-request":
      return true;
    default:
      return false;
  }
}

function resolveCompactionCompletionTimestamp(
  event: SessionRuntimeEvent,
  pending: SessionTimelineContextCompactionEntry,
) {
  switch (event.type) {
    case "message":
      return event.message.timestamp;
    case "tool-call":
      return event.toolCall.timestamp;
    case "command-output":
      return event.chunk.timestamp;
    default:
      return pending.updatedAt;
  }
}

function hasCanonicalTimelinePipeline(
  context: HelmHandlerContext,
): context is HelmHandlerContext & Required<Pick<
  HelmHandlerContext,
  | "sessionTimelineWorkers"
  | "sessionTimelineDispatcher"
  | "sessionTimelineFlushScheduler"
  | "sessionLiveStateStore"
>> {
  return Boolean(
    context.sessionTimelineWorkers &&
      context.sessionTimelineDispatcher &&
      context.sessionTimelineFlushScheduler &&
      context.sessionLiveStateStore,
  );
}

function assertCanonicalTimelinePipeline(
  context: HelmHandlerContext,
): asserts context is HelmHandlerContext & Required<Pick<
  HelmHandlerContext,
  | "sessionTimelineWorkers"
  | "sessionTimelineDispatcher"
  | "sessionTimelineFlushScheduler"
  | "sessionLiveStateStore"
>> {
  if (!hasCanonicalTimelinePipeline(context)) {
    throw new Error("Canonical runtime services are required.");
  }
}

function routeCanonicalTimelineEvent(
  sessionId: string,
  event: PersistedSessionEvent,
  context: HelmHandlerContext & Required<Pick<
    HelmHandlerContext,
    | "sessionTimelineWorkers"
    | "sessionTimelineDispatcher"
    | "sessionTimelineFlushScheduler"
    | "sessionLiveStateStore"
  >>,
  sequence?: number,
  update?: import("@tiller/shared").SessionUpdateRecord,
) {
  return routeSessionRuntimeEvent(sessionId, event, {
    workers: context.sessionTimelineWorkers,
    flushScheduler: context.sessionTimelineFlushScheduler,
    context,
  }, sequence, update);
}

function inferPendingCompactionCompletion(
  sessionId: string,
  event: SessionRuntimeEvent,
  context: HelmHandlerContext & Required<Pick<
    HelmHandlerContext,
    | "sessionTimelineWorkers"
    | "sessionTimelineDispatcher"
    | "sessionTimelineFlushScheduler"
    | "sessionLiveStateStore"
  >>,
) {
  if (!shouldInferCompactionCompletionFromEvent(event)) {
    return false;
  }
  const pending = findPendingTimelineCompactionEntry(sessionId, context);
  if (!pending) {
    return false;
  }
  const completionEvent = {
    type: "compaction",
    phase: "completed",
    source: pending.source,
    timestamp: resolveCompactionCompletionTimestamp(event, pending),
  } as const;
  const prepared = prepareRuntimeSessionUpdate(sessionId, completionEvent, context);
  routeCanonicalTimelineEvent(
    sessionId,
    completionEvent,
    context,
    prepared.resolvedSequence,
    prepared.update,
  );
  return true;
}

export function nextLiveEventSequenceForTest(sessionId: string, context: HelmHandlerContext) {
  return allocateLiveEventSequence(sessionId, context);
}

export function flushRuntimeUserEchoLogSummaryForTest(
  sessionId: string,
  context: HelmHandlerContext,
) {
  flushIgnoredUserEchoSummary(sessionId, context);
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
  clearRuntimeEventTimer(context, state.get<TimerHandle>(sessionId, RUNTIME_EVENT_STATE_KEY.assistantDeltaTimer));
  clearRuntimeEventTimer(
    context,
    state.get<PendingCommandOutput>(sessionId, RUNTIME_EVENT_STATE_KEY.pendingCommandOutput)?.timer,
  );
  clearRuntimeEventTimer(
    context,
    state.get<PendingRunningToolCall>(sessionId, RUNTIME_EVENT_STATE_KEY.pendingRunningToolCall)?.timer,
  );
  state.remove(sessionId);
  removeRuntimeSegmentState(sessionId);
}

function sequenceFromRuntimeEvent(event: PersistedSessionEvent) {
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

function resolveRuntimeEventThrottleConfig(context: HelmHandlerContext) {
  return {
    assistantWindowMs:
      context.runtimeEventThrottleConfig?.assistantWindowMs ?? DEFAULT_ASSISTANT_FLUSH_WINDOW_MS,
    assistantMaxChars:
      context.runtimeEventThrottleConfig?.assistantMaxChars ?? DEFAULT_ASSISTANT_MAX_CHARS,
    commandOutputWindowMs:
      context.runtimeEventThrottleConfig?.commandOutputWindowMs ?? DEFAULT_COMMAND_OUTPUT_FLUSH_WINDOW_MS,
    commandOutputMaxChars:
      context.runtimeEventThrottleConfig?.commandOutputMaxChars ?? DEFAULT_COMMAND_OUTPUT_MAX_CHARS,
    toolCallWindowMs:
      context.runtimeEventThrottleConfig?.toolCallWindowMs ?? DEFAULT_RUNNING_TOOL_CALL_FLUSH_WINDOW_MS,
    toolCallMaxChars:
      context.runtimeEventThrottleConfig?.toolCallMaxChars ?? DEFAULT_RUNNING_TOOL_CALL_MAX_CHARS,
    setTimeoutFn:
      context.runtimeEventThrottleConfig?.setTimeoutFn ??
      ((callback: () => void, delay: number) => setTimeout(callback, delay)),
    clearTimeoutFn:
      context.runtimeEventThrottleConfig?.clearTimeoutFn ??
      ((timer: TimerHandle) => clearTimeout(timer)),
  };
}

function scheduleRuntimeEventTimer(
  context: HelmHandlerContext,
  callback: () => void,
  delay: number,
) {
  const handle = resolveRuntimeEventThrottleConfig(context).setTimeoutFn(callback, delay);
  handle.unref?.();
  return handle;
}

function clearRuntimeEventTimer(
  context: HelmHandlerContext,
  timer: TimerHandle | undefined,
) {
  if (!timer) {
    return;
  }
  resolveRuntimeEventThrottleConfig(context).clearTimeoutFn(timer);
}

function clearAssistantDeltaTimer(sessionId: string, context: HelmHandlerContext) {
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

function scheduleAssistantDeltaFlush(sessionId: string, context: HelmHandlerContext) {
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

function mergeBufferedCommandChunk(current: CommandChunk, incoming: CommandChunk): CommandChunk {
  return {
    ...current,
    ...incoming,
    id: current.id,
    commandId: current.commandId,
    stream: current.stream,
    text: `${current.text}${incoming.text}`,
    timestamp: incoming.timestamp,
    sequence: current.sequence ?? incoming.sequence,
    truncated: undefined,
    byteSize: undefined,
    contentRef: undefined,
  };
}

function consumePendingCommandOutput(sessionId: string, context: HelmHandlerContext) {
  const state = runtimeEventState(context);
  const pending = state.get<PendingCommandOutput>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.pendingCommandOutput,
  );
  if (!pending) {
    return null;
  }
  clearRuntimeEventTimer(context, pending.timer);
  state.delete(sessionId, RUNTIME_EVENT_STATE_KEY.pendingCommandOutput);
  return pending;
}

function emitRuntimeCommandOutputChunk(
  sessionId: string,
  chunk: CommandChunk,
  inputChunkCount: number,
  context: HelmHandlerContext,
) {
  assertCanonicalTimelinePipeline(context);
  bumpAssistantStreamSegment(sessionId);
  const orderedChunk = {
    ...chunk,
    sequence: chunk.sequence ?? nextLiveEventSequence(sessionId, context),
  };
  const materializedChunk = materializeRuntimeCommandOutputChunk(
    context,
    sessionId,
    orderedChunk,
  );
  const prepared = prepareRuntimeSessionUpdate(
    sessionId,
    { type: "command-output", chunk: materializedChunk },
    context,
    orderedChunk.sequence,
  );
  routeCanonicalTimelineEvent(
    sessionId,
    { type: "command-output", chunk: materializedChunk },
    context,
    prepared.resolvedSequence,
    prepared.update,
  );
  recordCommandOutputSummary(sessionId, chunk, orderedChunk.sequence, inputChunkCount, context);
}

function flushPendingCommandOutput(sessionId: string, context: HelmHandlerContext) {
  const pending = consumePendingCommandOutput(sessionId, context);
  if (!pending) {
    return false;
  }
  emitRuntimeCommandOutputChunk(sessionId, pending.chunk, pending.inputChunks, context);
  return true;
}

function scheduleCommandOutputFlush(sessionId: string, context: HelmHandlerContext) {
  const pending = runtimeEventState(context).get<PendingCommandOutput>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.pendingCommandOutput,
  );
  if (!pending) {
    return false;
  }
  const config = resolveRuntimeEventThrottleConfig(context);
  if (pending.chunk.text.length >= config.commandOutputMaxChars || config.commandOutputWindowMs <= 0) {
    return flushPendingCommandOutput(sessionId, context);
  }
  if (pending.timer) {
    return false;
  }
  pending.timer = scheduleRuntimeEventTimer(
    context,
    () => {
      flushPendingCommandOutput(sessionId, context);
    },
    config.commandOutputWindowMs,
  );
  return false;
}

function bufferCommandOutputChunk(
  sessionId: string,
  chunk: CommandChunk,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  const pending = state.get<PendingCommandOutput>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.pendingCommandOutput,
  );
  if (
    pending &&
    pending.chunk.commandId === chunk.commandId &&
    pending.chunk.stream === chunk.stream
  ) {
    clearRuntimeEventTimer(context, pending.timer);
    pending.timer = undefined;
    pending.chunk = mergeBufferedCommandChunk(pending.chunk, chunk);
    pending.inputChunks += 1;
    scheduleCommandOutputFlush(sessionId, context);
    return;
  }
  flushPendingCommandOutput(sessionId, context);
  state.set(sessionId, RUNTIME_EVENT_STATE_KEY.pendingCommandOutput, {
    chunk,
    inputChunks: 1,
  });
  scheduleCommandOutputFlush(sessionId, context);
}

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
) {
  assertCanonicalTimelinePipeline(context);
  const stableToolCall = stabilizeRuntimeToolCallClassification(sessionId, toolCall, context);
  const orderedToolCall = {
    ...stableToolCall,
    sequence: stableToolCall.sequence ?? nextLiveEventSequence(sessionId, context),
  };
  trackActiveRuntimeToolCall(sessionId, orderedToolCall, context);
  if (!shouldPersistHistoricalToolCall(orderedToolCall)) {
    createSessionEventPublisher(context).sessionUpdate(sessionId, {
      kind: "tool_call",
      toolCall: orderedToolCall,
    });
    return orderedToolCall;
  }
  // Provider adapters finalize ToolCall classification before this point.
  // The canonical path preserves that category verbatim.
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

function flushPendingRunningToolCall(sessionId: string, context: HelmHandlerContext) {
  const pending = consumePendingRunningToolCall(sessionId, context);
  if (!pending) {
    return false;
  }
  emitRuntimeToolCallSnapshot(sessionId, pending.toolCall, context);
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

function isWeakToolCallKind(kind: AgentToolCall["kind"]) {
  return kind === "tool" || kind === "unknown";
}

function hasMeaningfulRuntimeThinkingOutput(output: string | undefined) {
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

function finalizeActiveRuntimeToolCalls(
  sessionId: string,
  status: Extract<AgentToolCall["status"], "completed" | "failed" | "cancelled">,
  context: HelmHandlerContext,
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
    emitRuntimeToolCallSnapshot(sessionId, {
      ...toolCall,
      status,
      updatedAt: now,
    }, context);
  }
  active.clear();
}

function finalizeRuntimeThinking(
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
  return toolCall.status === "completed" ||
    toolCall.status === "failed" ||
    toolCall.status === "cancelled";
}


function logRuntimePlanUpdate(
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

function recordCommandOutputSummary(
  sessionId: string,
  chunk: Extract<SessionRuntimeEvent, { type: "command-output" }>["chunk"],
  sequence: number,
  inputChunkCount = 1,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  const summaries = state.get<Map<string, CommandOutputSummary>>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.commandOutputSummaries,
  ) ?? new Map<string, CommandOutputSummary>();
  state.set(sessionId, RUNTIME_EVENT_STATE_KEY.commandOutputSummaries, summaries);
  const key = `${chunk.commandId}\u001f${chunk.stream}`;
  const current = summaries.get(key);
  if (!current) {
    summaries.set(key, {
      chars: chunk.text.length,
      chunks: inputChunkCount,
      commandId: chunk.commandId,
      firstSeq: sequence,
      lastSeq: sequence,
      stream: chunk.stream,
    });
    return;
  }
  current.chars += chunk.text.length;
  current.chunks += inputChunkCount;
  current.lastSeq = sequence;
}

function flushCommandOutputSummaries(sessionId: string, context: HelmHandlerContext) {
  const state = runtimeEventState(context);
  const summaries = state.get<Map<string, CommandOutputSummary>>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.commandOutputSummaries,
  );
  if (!summaries?.size) {
    return;
  }
  state.delete(sessionId, RUNTIME_EVENT_STATE_KEY.commandOutputSummaries);
  for (const summary of summaries.values()) {
    logRuntimeDebug(context, "runtime.command_output.summary", {
      ...runtimeLogFields(sessionId, context),
      seq: summary.lastSeq,
      commandId: summary.commandId,
      stream: summary.stream,
      chunks: summary.chunks,
      chars: summary.chars,
      firstSeq: summary.firstSeq,
      lastSeq: summary.lastSeq,
    });
  }
}

export function flushLiveAssistantMessage(sessionId: string, context: HelmHandlerContext) {
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
  context.updateSessionSummary(sessionId, (current) => applyAgentMessageToSummary(current, finalizedMessage));
  return true;
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
  return expandAdapterRuntimeEvent(resolveRuntimeProviderId(sessionId, context), event) ?? [event];
}


export function handleRuntimeEvent(
  sessionId: string,
  event: SessionRuntimeEvent,
  context: HelmHandlerContext,
) {
  if (
    !context.sessions.has(sessionId) &&
    !context.sessionStore.get(sessionId)
  ) {
    return;
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
    handleNormalizedRuntimeEvent(sessionId, expandedEvent, context);
  }
}

function handleNormalizedRuntimeEvent(
  sessionId: string,
  event: SessionRuntimeEvent,
  context: HelmHandlerContext,
) {
  assertCanonicalTimelinePipeline(context);
  switch (event.type) {
    case "status":
      emitFirstHelmPromptTrace(context, {
        sessionId,
        phase: "helm.runtime.first_status",
        meta: { status: event.status },
      });
      const statusSequence = commitCanonicalStateEvent(sessionId, event, context)?.sequence;
      flushLiveAssistantMessage(sessionId, context);
      if (event.status === "running") {
        startNextAssistantResponseSegment(sessionId);
      } else {
        const terminalStatus = event.status === "error"
          ? "failed"
          : event.status === "cancelled"
            ? "cancelled"
            : "completed";
        finalizeRuntimeThinking(sessionId, terminalStatus, context);
        finalizeActiveRuntimeToolCalls(sessionId, terminalStatus, context);
      }
      context.sessionTimelineFlushScheduler.flushNow(sessionId);
      logRuntimeInfo(context, "runtime.status.changed", {
        ...runtimeLogFields(sessionId, context),
        seq: statusSequence ?? 0,
        status: event.status,
        messageChars: event.message?.length ?? 0,
      });
      context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        status: event.status,
        updatedAt: new Date().toISOString(),
      }));
      if (event.status === "idle" || event.status === "error" || event.status === "cancelled") {
        context.sessionUpdateStore.compactTail(sessionId);
      }
      return;
    case "message":
      if (event.message.role === "user") {
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
        return;
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
        finalizeRuntimeThinking(sessionId, "completed", context);
        return;
      }
      scheduleAssistantDeltaFlush(sessionId, context);
      return;
    case "compaction":
      flushLiveAssistantMessage(sessionId, context);
      const shouldStartNewAssistantTurn = !hasPendingTimelineCompaction(sessionId, context);
      const prepared = prepareRuntimeSessionUpdate(sessionId, event, context);
      if (shouldStartNewAssistantTurn) {
        startNextAssistantResponseSegment(sessionId);
      }
      routeCanonicalTimelineEvent(
        sessionId,
        event,
        context,
        prepared.resolvedSequence,
        prepared.update,
      );
      return;
    case "permission-request":
      flushLiveAssistantMessage(sessionId, context);
      context.sessionTimelineFlushScheduler.flushNow(sessionId);
      const preparedApproval = context.sessionApprovalStateStore && context.sessionLiveStateStore
        ? prepareRuntimeSessionUpdate(sessionId, event, context)
        : undefined;
      const approvalSequence = preparedApproval?.resolvedSequence;
      logRuntimeInfo(context, "runtime.permission.requested", {
        ...runtimeLogFields(sessionId, context),
        seq: approvalSequence ?? 0,
        requestId: event.request.id,
        reasonChars: event.request.reason.length,
      });
      handleRuntimePermissionRequest(
        {
          sessionId,
          request: event.request,
          logScope: runtimeLogScope(sessionId, context),
          sequence: approvalSequence,
          update: preparedApproval?.update,
        },
        context,
      );
      return;
    case "plan-update":
      {
        const sequence = commitCanonicalStateEvent(sessionId, event, context)?.sequence;
        logRuntimePlanUpdate(sessionId, event, context, sequence);
        return;
      }
    case "tool-call":
      emitFirstHelmPromptTrace(context, {
        sessionId,
        phase: "helm.runtime.first_tool_call",
        meta: { kind: event.toolCall.kind },
      });
      if (event.toolCall.kind === "think") {
        if (!hasMeaningfulRuntimeThinkingOutput(event.toolCall.output)) {
          return;
        }
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
      }
      const notificationSequence = stableToolCall.sequence ?? nextLiveEventSequence(sessionId, context);
      const compactedToolCall = compactBinaryToolCallOutput({
        ...stableToolCall,
        sequence: notificationSequence,
      });
      const activeToolCall = mergeActiveRuntimeToolCallSnapshot(
        sessionId,
        compactedToolCall,
        context,
      );
      trackActiveRuntimeToolCall(sessionId, activeToolCall, context);
      if (
        activeToolCall.status === "running" &&
        activeToolCall.kind !== "subagent"
      ) {
        bufferRunningToolCall(sessionId, activeToolCall, context);
        return;
      }
      const pendingRunningToolCall = consumePendingRunningToolCall(sessionId, context);
      if (pendingRunningToolCall && pendingRunningToolCall.toolCall.id !== activeToolCall.id) {
        emitRuntimeToolCallSnapshot(sessionId, pendingRunningToolCall.toolCall, context);
      }
      const resolvedToolCall = pendingRunningToolCall?.toolCall.id === activeToolCall.id
        ? mergeBufferedToolCallSnapshot(pendingRunningToolCall.toolCall, activeToolCall)
        : activeToolCall;
      emitRuntimeToolCallSnapshot(
        sessionId,
        resolvedToolCall,
        context,
        notificationSequence,
      );
      return;
    case "command-output":
      emitFirstHelmPromptTrace(context, {
        sessionId,
        phase: "helm.runtime.first_command_output",
        meta: { commandId: event.chunk.commandId, stream: event.chunk.stream },
      });
      flushLiveAssistantMessage(sessionId, context);
      bufferCommandOutputChunk(sessionId, {
        ...event.chunk,
        sequence: event.chunk.sequence ?? nextLiveEventSequence(sessionId, context),
      }, context);
      return;
    case "diff-update":
      {
        const files = context.sessionDiffBodyStore
          ? materializeDiffPayloads(sessionId, event.files, context.sessionDiffBodyStore)
          : event.files;
        context.sessionArtifactStore.replaceDiffs(sessionId, files);
        const sequence = commitCanonicalStateEvent(
          sessionId,
          { ...event, files },
          context,
        )?.sequence;
        flushLiveAssistantMessage(sessionId, context);
        logRuntimeInfo(context, "runtime.diff.updated", {
          ...runtimeLogFields(sessionId, context),
          seq: sequence ?? 0,
          files: event.files.length,
          paths: event.files.map((file) => file.path).slice(0, 8),
        });
        return;
      }
    case "config-options": {
      flushLiveAssistantMessage(sessionId, context);
      const current = context.sessions.get(sessionId)?.summary ?? context.sessionStore.get(sessionId);
      const resolvedModel = current?.model ?? event.state.model;
      const resolvedConfigOptions = resolveConfigOptionsForSelection({
        incomingOptions: event.options,
        previousOptions: current?.configOptions,
        selectedModel: resolvedModel,
      });
      const resolvedReasoningEffort = resolveConfigReasoningEffortForOptions(
        current?.reasoningEffort ?? event.state.reasoningEffort,
        resolvedConfigOptions,
      );
      const resolvedOptions = resolvedConfigOptions.options ?? [];
      const resolvedState = {
        ...event.state,
        model: resolvedModel,
        reasoningEffort: resolvedReasoningEffort,
      };
      const canonicalEvent = {
        ...event,
        state: resolvedState,
        options: resolvedOptions,
      };
      const sequence = commitCanonicalStateEvent(sessionId, canonicalEvent, context)?.sequence;
      logRuntimeDebug(context, "runtime.config_options.received", {
        ...runtimeLogFields(sessionId, context),
        seq: sequence ?? 0,
        agentMode: event.state.agentMode ?? "<none>",
        model: resolvedModel ?? "<none>",
        reasoning: resolvedReasoningEffort ?? "<none>",
        options: resolvedOptions.length,
      });
      context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        agentMode: current.agentMode ?? event.state.agentMode,
        model: resolvedModel,
        configOptions: resolvedOptions,
        reasoningEffort: resolvedReasoningEffort,
        updatedAt: new Date().toISOString(),
      }));
      return;
    }
    case "model-options": {
      flushLiveAssistantMessage(sessionId, context);
      const sequence = commitCanonicalStateEvent(sessionId, event, context)?.sequence;
      logRuntimeDebug(context, "runtime.model_options.received", {
        ...runtimeLogFields(sessionId, context),
        seq: sequence ?? 0,
        currentModel: event.state.currentModelId ?? "<none>",
        options: event.state.options.length,
      });
      context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        model: current.model ?? event.state.currentModelId,
        modelOptions: event.state.options,
        updatedAt: new Date().toISOString(),
      }));
      return;
    }
    case "available-commands": {
      flushLiveAssistantMessage(sessionId, context);
      const sequence = commitCanonicalStateEvent(sessionId, event, context)?.sequence;
      logRuntimeDebug(context, "runtime.available_commands.received", {
        ...runtimeLogFields(sessionId, context),
        seq: sequence ?? 0,
        commands: event.commands.length,
      });
      context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        availableCommands: event.commands,
        updatedAt: new Date().toISOString(),
      }));
      return;
    }
    case "mode-update":
    case "session-info":
    case "usage-update": {
      commitCanonicalStateEvent(sessionId, event, context);
      return;
    }
    case "error":
      flushLiveAssistantMessage(sessionId, context);
      finalizeRuntimeThinking(sessionId, "failed", context);
      finalizeActiveRuntimeToolCalls(sessionId, "failed", context);
      context.sessionTimelineFlushScheduler.flushNow(sessionId);
      logRuntimeError(context, "runtime.error", {
        ...runtimeLogFields(sessionId, context),
        seq: peekLiveEventSequence(sessionId, context),
        code: event.code ?? "UNKNOWN",
        messageChars: event.message.length,
      });
      context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        status: "error",
        updatedAt: new Date().toISOString(),
        lastMessagePreview: event.message.slice(0, 160),
      }));
      if (event.code === "ACP_CONNECTION_EXITED") {
        context.sessions.delete(sessionId);
        logRuntimeInfo(context, "runtime.recoverable.marked", {
          ...runtimeLogFields(sessionId, context),
          code: event.code,
        });
      }
      createSessionEventPublisher(context).errorRaised({
        sessionId,
        message: event.message,
        code: event.code,
      });
      return;
    default:
      return;
  }
}

function isRuntimeUserMessageEvent(event: SessionRuntimeEvent) {
  return event.type === "message" && event.message.role === "user";
}

function recordIgnoredUserEcho(
  sessionId: string,
  message: Extract<SessionRuntimeEvent, { type: "message" }>["message"],
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  const seq = message.sequence ?? peekLiveEventSequence(sessionId, context);
  const current = state.get<IgnoredUserEchoSummary>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.ignoredUserEchoSummary,
  );
  if (!current) {
    state.set(sessionId, RUNTIME_EVENT_STATE_KEY.ignoredUserEchoSummary, {
      count: 1,
      firstMessageId: message.id,
      firstSeq: seq,
      lastMessageId: message.id,
      lastSeq: seq,
      messageIds: new Set([message.id]),
      totalChars: message.text.length,
    });
    return;
  }
  current.count += 1;
  current.lastMessageId = message.id;
  current.lastSeq = seq;
  current.messageIds.add(message.id);
  current.totalChars += message.text.length;
}

function shouldIgnoreRuntimeUserMessage(
  sessionId: string,
  message: Extract<SessionRuntimeEvent, { type: "message" }>["message"],
  context: HelmHandlerContext,
) {
  const text = message.text.trim();
  if (!text) {
    return false;
  }
  return listLocalUserMessages(sessionId, context).some((candidate) => {
    const localText = candidate.text.trim();
    return candidate.id === message.id || localText === text || text.includes(localText);
  });
}

function listLocalUserMessages(sessionId: string, context: HelmHandlerContext): AgentMessage[] {
  try {
    return context.sessionMessageStore.list(sessionId).filter(
      (message: AgentMessage) => message.role === "user" && message.text.trim(),
    );
  } catch {
    return [];
  }
}

function flushIgnoredUserEchoSummary(sessionId: string, context: HelmHandlerContext) {
  const state = runtimeEventState(context);
  const summary = state.get<IgnoredUserEchoSummary>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.ignoredUserEchoSummary,
  );
  if (!summary) {
    return;
  }
  state.delete(sessionId, RUNTIME_EVENT_STATE_KEY.ignoredUserEchoSummary);
  logRuntimeDebug(context, "runtime.message.user_echo.ignored_summary", {
    ...runtimeLogFields(sessionId, context),
    role: "user",
    count: summary.count,
    uniqueMessages: summary.messageIds.size,
    totalChars: summary.totalChars,
    firstSeq: summary.firstSeq,
    lastSeq: summary.lastSeq,
    firstMessageId: summary.firstMessageId,
    lastMessageId: summary.lastMessageId,
  });
}

function shouldIgnoreLateRuntimeEvent(
  sessionId: string,
  event: SessionRuntimeEvent,
  context: HelmHandlerContext,
) {
  const activeRecord = context.sessions.get(sessionId);
  const current =
    activeRecord?.summary ??
    context.sessionStore.get(sessionId);
  if (current?.status === "error" && activeRecord) {
    return false;
  }
  if (current?.status !== "error" && current?.status !== "cancelled") {
    return false;
  }
  return event.type === "status" ||
    event.type === "message" ||
    event.type === "compaction" ||
    event.type === "permission-request" ||
    event.type === "tool-call" ||
    event.type === "command-output";
}
