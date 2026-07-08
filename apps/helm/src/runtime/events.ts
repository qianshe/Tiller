import { applyAgentMessageToSummary, applyUserPromptToSummary } from "../sessions/facade";
import { expandAdapterRuntimeEvent, type SessionRuntimeEvent } from "@tiller/acp-runtime";
import type {
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  SessionSummary,
  SessionTimelineContextCompactionEntry,
  SessionTimelineEntry,
} from "@tiller/shared";
import { compactBinaryToolCallOutput } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import { buildSessionCompactionEntry } from "../sessions/compaction-entry";
import { handleRuntimePermissionRequest } from "./approval-boundary";
import { createSessionEventPublisher } from "./session/event/publisher";
import {
  publishRuntimeCommandOutput,
  publishRuntimeToolCall,
  recordRuntimeCommandOutputArtifact,
  recordRuntimeToolCallArtifact,
} from "./session/event/effects";
import {
  persistTimelineMessage,
  persistTimelineTranscriptEvent,
} from "./session/timeline-effects";
import { emitFirstHelmPromptTrace } from "./prompt-trace";
import { routeSessionRuntimeEvent } from "./session-timeline/event-router";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "./session/config-options";
import {
  clearActiveRuntimeThinking,
  bumpAssistantStreamSegment,
  finalizeActiveRuntimeThinking,
  normalizeRuntimeAssistantMessageId,
  normalizeRuntimeThinkingToolCall,
  startNextAssistantResponseSegment,
} from "./segment-state";
import type { TillerLogFields } from "../logging/logger";
import { createSessionUpdateRecord } from "./session-updates/reducer";

const liveEventSequenceBySession = new Map<string, number>();
const ignoredUserEchoSummaryBySession = new Map<string, IgnoredUserEchoSummary>();
const runtimePlanLogStateBySession = new Map<string, RuntimePlanLogState>();
const commandOutputSummaryBySession = new Map<string, Map<string, CommandOutputSummary>>();
const assistantDeltaTimerBySession = new Map<string, TimerHandle>();
const pendingCommandOutputBySession = new Map<string, PendingCommandOutput>();
const pendingRunningToolCallBySession = new Map<string, PendingRunningToolCall>();

const DEFAULT_ASSISTANT_FLUSH_WINDOW_MS = 32;
const DEFAULT_ASSISTANT_MAX_CHARS = 256;
const DEFAULT_COMMAND_OUTPUT_FLUSH_WINDOW_MS = 32;
const DEFAULT_COMMAND_OUTPUT_MAX_CHARS = 256;
const DEFAULT_RUNNING_TOOL_CALL_FLUSH_WINDOW_MS = 64;
const DEFAULT_RUNNING_TOOL_CALL_MAX_CHARS = 512;

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
  return `session=${sessionId} agent=${record?.agent.id ?? "<stored>"} cwd=${record?.worktree.path ?? "<stored>"}`;
}

function runtimeLogFields(sessionId: string, context: HelmHandlerContext): TillerLogFields {
  const record = context.sessions.get(sessionId);
  return {
    sessionId,
    agentId: record?.agent.id ?? "<stored>",
    cwd: record?.worktree.path ?? "<stored>",
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

export function seedLiveEventSequenceForSession(
  sessionId: string,
  sequences: ReadonlyArray<number | undefined>,
) {
  const maxSequence = sequences.reduce<number>((max, value) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
      return max;
    }
    return Math.max(max, value);
  }, 0);
  liveEventSequenceBySession.set(
    sessionId,
    Math.max(liveEventSequenceBySession.get(sessionId) ?? 0, maxSequence),
  );
}

export function allocateLiveEventSequence(sessionId: string) {
  const next = (liveEventSequenceBySession.get(sessionId) ?? 0) + 1;
  liveEventSequenceBySession.set(sessionId, next);
  return next;
}

function nextLiveEventSequence(sessionId: string) {
  return allocateLiveEventSequence(sessionId);
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

function routeCanonicalTimelineEvent(
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
  return routeSessionRuntimeEvent(sessionId, event, {
    workers: context.sessionTimelineWorkers,
    liveStateStore: context.sessionLiveStateStore,
    flushScheduler: context.sessionTimelineFlushScheduler,
    context,
  });
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
  routeCanonicalTimelineEvent(sessionId, {
    type: "compaction",
    phase: "completed",
    source: pending.source,
    timestamp: resolveCompactionCompletionTimestamp(event, pending),
  }, context);
  return true;
}

export function nextLiveEventSequenceForTest(sessionId: string) {
  return allocateLiveEventSequence(sessionId);
}

export function flushRuntimeUserEchoLogSummaryForTest(
  sessionId: string,
  context: HelmHandlerContext,
) {
  flushIgnoredUserEchoSummary(sessionId, context);
}

export function persistRuntimeSessionUpdate(
  sessionId: string,
  event: SessionRuntimeEvent,
  context: HelmHandlerContext,
  sequence?: number,
) {
  if (!context.sessionUpdateStore?.append) {
    return;
  }
  const record = context.sessions.get(sessionId);
  const summary = record?.summary ?? context.sessionStore.list().find((item: SessionSummary) => item.id === sessionId);
  const resolvedSequence = sequence ?? sequenceFromRuntimeEvent(event) ?? nextLiveEventSequence(sessionId);
  try {
    context.sessionUpdateStore.append(createSessionUpdateRecord({
      sessionId,
      runtimeSessionId: record?.runtime?.runtimeSessionId ?? summary?.runtimeSessionId ?? sessionId,
      providerId: record?.agent?.id ?? summary?.agentId ?? "unknown",
      sequence: resolvedSequence,
      source: "acp_live",
      event,
    }));
  } catch (error) {
    logRuntimeError(context, "runtime.session_update.persist_failed", {
      ...runtimeLogFields(sessionId, context),
      seq: resolvedSequence,
      type: event.type,
      message: error instanceof Error ? error.message : "Failed to persist session update.",
    });
  }
}

function sequenceFromRuntimeEvent(event: SessionRuntimeEvent) {
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
  clearRuntimeEventTimer(context, assistantDeltaTimerBySession.get(sessionId));
  assistantDeltaTimerBySession.delete(sessionId);
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
  if (hasCanonicalTimelinePipeline(context)) {
    persistRuntimeSessionUpdate(sessionId, { type: "message", message: streamingDelta }, context);
    routeCanonicalTimelineEvent(sessionId, { type: "message", message: streamingDelta }, context);
    return true;
  }
  const orderedDelta = {
    ...streamingDelta,
    sequence: nextLiveEventSequence(sessionId),
  };
  persistRuntimeSessionUpdate(
    sessionId,
    { type: "message", message: orderedDelta },
    context,
    orderedDelta.sequence,
  );
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
  if (assistantDeltaTimerBySession.has(sessionId)) {
    return false;
  }
  assistantDeltaTimerBySession.set(
    sessionId,
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
  const pending = pendingCommandOutputBySession.get(sessionId);
  if (!pending) {
    return null;
  }
  clearRuntimeEventTimer(context, pending.timer);
  pendingCommandOutputBySession.delete(sessionId);
  return pending;
}

function emitRuntimeCommandOutputChunk(
  sessionId: string,
  chunk: CommandChunk,
  inputChunkCount: number,
  context: HelmHandlerContext,
) {
  bumpAssistantStreamSegment(sessionId);
  if (hasCanonicalTimelinePipeline(context)) {
    const orderedChunk = {
      ...chunk,
      sequence: nextLiveEventSequence(sessionId),
    };
    const materializedChunk = recordRuntimeCommandOutputArtifact(
      context,
      sessionId,
      orderedChunk,
    );
    persistRuntimeSessionUpdate(
      sessionId,
      { type: "command-output", chunk: materializedChunk },
      context,
      orderedChunk.sequence,
    );
    routeCanonicalTimelineEvent(
      sessionId,
      { type: "command-output", chunk: materializedChunk },
      context,
    );
    recordCommandOutputSummary(sessionId, chunk, orderedChunk.sequence, inputChunkCount);
    return;
  }
  const orderedChunk = {
    ...chunk,
    sequence: nextLiveEventSequence(sessionId),
  };
  const materializedChunk = recordRuntimeCommandOutputArtifact(
    context,
    sessionId,
    orderedChunk,
  );
  persistRuntimeSessionUpdate(
    sessionId,
    { type: "command-output", chunk: materializedChunk },
    context,
    orderedChunk.sequence,
  );
  recordCommandOutputSummary(sessionId, chunk, orderedChunk.sequence, inputChunkCount);
  publishRuntimeCommandOutput(context, sessionId, materializedChunk);
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
  const pending = pendingCommandOutputBySession.get(sessionId);
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
  const pending = pendingCommandOutputBySession.get(sessionId);
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
  pendingCommandOutputBySession.set(sessionId, {
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
  const pending = pendingRunningToolCallBySession.get(sessionId);
  if (!pending) {
    return null;
  }
  clearRuntimeEventTimer(context, pending.timer);
  pendingRunningToolCallBySession.delete(sessionId);
  return pending;
}

function emitRuntimeToolCallSnapshot(
  sessionId: string,
  toolCall: AgentToolCall,
  context: HelmHandlerContext,
) {
  bumpAssistantStreamSegment(sessionId);
  if (hasCanonicalTimelinePipeline(context)) {
    const orderedToolCall = {
      ...toolCall,
      sequence: nextLiveEventSequence(sessionId),
    };
    const mergedToolCall = recordRuntimeToolCallArtifact(
      context,
      sessionId,
      orderedToolCall,
    );
    if (shouldPersistToolCallSnapshot(mergedToolCall, sessionId, context)) {
      persistRuntimeSessionUpdate(
        sessionId,
        { type: "tool-call", toolCall: mergedToolCall },
        context,
        orderedToolCall.sequence,
      );
    }
    routeCanonicalTimelineEvent(
      sessionId,
      { type: "tool-call", toolCall: mergedToolCall },
      context,
    );
    return mergedToolCall;
  }
  flushLiveAssistantMessage(sessionId, context);
  const orderedToolCall = {
    ...toolCall,
    sequence: nextLiveEventSequence(sessionId),
  };
  const mergedToolCall = publishRuntimeToolCall(context, sessionId, orderedToolCall);
  if (shouldPersistToolCallSnapshot(mergedToolCall, sessionId, context)) {
    persistRuntimeSessionUpdate(
      sessionId,
      { type: "tool-call", toolCall: mergedToolCall },
      context,
      orderedToolCall.sequence,
    );
  }
  return mergedToolCall;
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
  const pending = pendingRunningToolCallBySession.get(sessionId);
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
  const pending = pendingRunningToolCallBySession.get(sessionId);
  if (pending && pending.toolCall.id === toolCall.id) {
    clearRuntimeEventTimer(context, pending.timer);
    pending.timer = undefined;
    const mergedToolCall = {
      ...pending.toolCall,
      ...toolCall,
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
  pendingRunningToolCallBySession.set(sessionId, {
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
    output: mergeToolCallOutput(current.output, incoming.output),
    timestamp: current.timestamp,
    updatedAt: incoming.updatedAt,
    sequence: current.sequence ?? incoming.sequence,
  });
}

function shouldPersistToolCallSnapshot(
  toolCall: AgentToolCall,
  sessionId: string,
  context: Pick<HelmHandlerContext, "sessions" | "sessionStore">,
) {
  const summary =
    context.sessions.get(sessionId)?.summary ??
    context.sessionStore.list().find((item: SessionSummary) => item.id === sessionId);
  if (summary?.status === "error") {
    return true;
  }
  return toolCall.kind === "think" ||
    toolCall.status === "waiting_for_permission" ||
    toolCall.status === "completed" ||
    toolCall.status === "failed" ||
    toolCall.status === "cancelled";
}


function logRuntimePlanUpdate(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "plan-update" }>,
  context: HelmHandlerContext,
) {
  const entries = event.plan.entries.length;
  const previousEntries = runtimePlanLogStateBySession.get(sessionId)?.lastEntryCount ?? 0;
  runtimePlanLogStateBySession.set(sessionId, { lastEntryCount: entries });
  if (entries > 0) {
    logRuntimeDebug(context, "runtime.plan.updated", {
      ...runtimeLogFields(sessionId, context),
      seq: nextLiveEventSequence(sessionId),
      entries,
    });
    return;
  }
  if (previousEntries > 0) {
    logRuntimeDebug(context, "runtime.plan.cleared", {
      ...runtimeLogFields(sessionId, context),
      seq: nextLiveEventSequence(sessionId),
      previousEntries,
    });
  }
}

function recordCommandOutputSummary(
  sessionId: string,
  chunk: Extract<SessionRuntimeEvent, { type: "command-output" }>["chunk"],
  sequence: number,
  inputChunkCount = 1,
) {
  const summaries = commandOutputSummaryBySession.get(sessionId) ?? new Map<string, CommandOutputSummary>();
  commandOutputSummaryBySession.set(sessionId, summaries);
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
  const summaries = commandOutputSummaryBySession.get(sessionId);
  if (!summaries?.size) {
    return;
  }
  commandOutputSummaryBySession.delete(sessionId);
  for (const summary of summaries.values()) {
    logRuntimeDebug(context, "runtime.command_output.summary", {
      ...runtimeLogFields(sessionId, context),
      seq: nextLiveEventSequence(sessionId),
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
  clearAssistantDeltaTimer(sessionId, context);
  const message = context.liveMessageBuffer.finalize(sessionId);
  if (!message) {
    return false;
  }
  const finalizedMessage = {
    ...message,
    streaming: false,
  };
  context.persistSessionMessage(sessionId, finalizedMessage);
  persistRuntimeSessionUpdate(sessionId, { type: "message", message: finalizedMessage }, context, finalizedMessage.sequence);
  if (hasCanonicalTimelinePipeline(context)) {
    routeCanonicalTimelineEvent(sessionId, { type: "message", message: finalizedMessage }, context);
  } else {
    persistTimelineMessage(context, sessionId, finalizedMessage);
    createSessionEventPublisher(context).sessionUpdate(sessionId, {
      kind: "agent_message",
      message: finalizedMessage,
      streaming: false,
    });
  }
  context.updateSessionSummary(sessionId, (current) => applyAgentMessageToSummary(current, finalizedMessage));
  return true;
}

function resolveRuntimeProviderId(
  sessionId: string,
  context: Pick<HelmHandlerContext, "sessions" | "sessionStore">,
) {
  const record = context.sessions.get(sessionId);
  const summary = context.sessionStore.list().find((item: SessionSummary) => item.id === sessionId);
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
    !context.sessionStore.list().some((item: { id: string }) => item.id === sessionId)
  ) {
    return;
  }
  if (shouldIgnoreLateRuntimeEvent(sessionId, event, context)) {
    flushIgnoredUserEchoSummary(sessionId, context);
    logRuntimeDebug(context, "runtime.event.ignored_late", {
      ...runtimeLogFields(sessionId, context),
      seq: nextLiveEventSequence(sessionId),
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
  if (
    hasCanonicalTimelinePipeline(context) &&
    hasPendingTimelineCompaction(sessionId, context) &&
    !skipPendingCompactionInference
  ) {
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
  switch (event.type) {
    case "status":
      emitFirstHelmPromptTrace(context, {
        sessionId,
        phase: "helm.runtime.first_status",
        meta: { status: event.status },
      });
      flushLiveAssistantMessage(sessionId, context);
      if (hasCanonicalTimelinePipeline(context)) {
        context.sessionTimelineFlushScheduler.flushNow(sessionId);
      }
      if (event.status === "running") {
        startNextAssistantResponseSegment(sessionId);
      } else {
        const finalizedThinking = finalizeActiveRuntimeThinking(sessionId);
        if (finalizedThinking) {
          if (hasCanonicalTimelinePipeline(context)) {
            routeCanonicalTimelineEvent(sessionId, { type: "tool-call", toolCall: finalizedThinking }, context);
          } else {
            publishRuntimeToolCall(context, sessionId, finalizedThinking);
          }
        }
      }
      logRuntimeInfo(context, "runtime.status.changed", {
        ...runtimeLogFields(sessionId, context),
        seq: nextLiveEventSequence(sessionId),
        status: event.status,
        messageChars: event.message?.length ?? 0,
      });
      context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        status: event.status,
        updatedAt: new Date().toISOString(),
      }));
      createSessionEventPublisher(context).sessionUpdate(sessionId, {
        kind: "status_change",
        status: event.status,
        message: event.message,
      });
      return;
    case "message":
      if (event.message.role === "user") {
        startNextAssistantResponseSegment(sessionId);
        flushLiveAssistantMessage(sessionId, context);
        if (shouldIgnoreRuntimeUserMessage(sessionId, event.message, context)) {
          recordIgnoredUserEcho(sessionId, event.message);
          return;
        }
        flushIgnoredUserEchoSummary(sessionId, context);
        if (hasCanonicalTimelinePipeline(context)) {
          persistRuntimeSessionUpdate(sessionId, event, context);
          context.persistSessionMessage(sessionId, event.message);
          context.updateSessionSummary(sessionId, (current) =>
            applyUserPromptToSummary(current, event.message.text, event.message.timestamp),
          );
          routeCanonicalTimelineEvent(sessionId, event, context);
          return;
        }
        publishRuntimeUserMessage(sessionId, event.message, context);
        return;
      }
      const message = {
        ...event.message,
        id: normalizeRuntimeAssistantMessageId(sessionId, event.message),
      };
      emitFirstHelmPromptTrace(context, {
        sessionId,
        phase: "helm.runtime.first_message",
        meta: { chars: message.text.length },
      });
      clearActiveRuntimeThinking(sessionId);
      if (context.liveMessageBuffer.peek(sessionId)?.id !== message.id) {
        flushLiveAssistantMessage(sessionId, context);
      }
      context.liveMessageBuffer.append(sessionId, message);
      if (message.streaming === false) {
        flushLiveAssistantMessage(sessionId, context);
        return;
      }
      scheduleAssistantDeltaFlush(sessionId, context);
      return;
    case "compaction":
      persistRuntimeSessionUpdate(sessionId, event, context);
      const shouldStartNewAssistantTurn = !hasPendingTimelineCompaction(sessionId, context);
      if (hasCanonicalTimelinePipeline(context)) {
        if (shouldStartNewAssistantTurn) {
          startNextAssistantResponseSegment(sessionId);
        }
        routeCanonicalTimelineEvent(sessionId, event, context);
        return;
      }
      flushLiveAssistantMessage(sessionId, context);
      if (shouldStartNewAssistantTurn) {
        startNextAssistantResponseSegment(sessionId);
      }
      const compactionEntry = buildSessionCompactionEntry({
        sessionId,
        context,
        phase: event.phase,
        source: event.source,
        summaryText: event.summaryText,
        summaryMessageId: event.messageId,
        timestamp: event.timestamp,
        idSuffix: event.messageId ? undefined : `compaction:${event.timestamp}`,
      });
      const storedCompactionEntry =
        persistTimelineTranscriptEvent(context, sessionId, compactionEntry) ?? compactionEntry;
      createSessionEventPublisher(context).sessionUpdate(sessionId, {
        kind: "transcript_event",
        entry: storedCompactionEntry,
      });
      return;
    case "permission-request":
      flushLiveAssistantMessage(sessionId, context);
      if (hasCanonicalTimelinePipeline(context)) {
        context.sessionTimelineFlushScheduler.flushNow(sessionId);
      }
      logRuntimeInfo(context, "runtime.permission.requested", {
        ...runtimeLogFields(sessionId, context),
        seq: nextLiveEventSequence(sessionId),
        requestId: event.request.id,
        reasonChars: event.request.reason.length,
      });
      handleRuntimePermissionRequest(
        {
          sessionId,
          request: event.request,
          logScope: runtimeLogScope(sessionId, context),
        },
        context,
      );
      return;
    case "plan-update":
      persistRuntimeSessionUpdate(sessionId, event, context);
      logRuntimePlanUpdate(sessionId, event, context);
      if (hasCanonicalTimelinePipeline(context)) {
        routeCanonicalTimelineEvent(sessionId, event, context);
        return;
      }
      createSessionEventPublisher(context).sessionUpdate(sessionId, {
        kind: "plan_update",
        plan: event.plan,
      });
      return;
    case "tool-call":
      emitFirstHelmPromptTrace(context, {
        sessionId,
        phase: "helm.runtime.first_tool_call",
        meta: { kind: event.toolCall.kind },
      });
      if (event.toolCall.kind === "think") {
        const toolCall = normalizeRuntimeThinkingToolCall(sessionId, event.toolCall);
        if (hasCanonicalTimelinePipeline(context)) {
          persistRuntimeSessionUpdate(sessionId, { ...event, toolCall }, context);
          routeCanonicalTimelineEvent(sessionId, { ...event, toolCall }, context);
          return;
        }
        const orderedThinkingToolCall = {
          ...toolCall,
          sequence: nextLiveEventSequence(sessionId),
        };
        persistRuntimeSessionUpdate(
          sessionId,
          { ...event, toolCall: orderedThinkingToolCall },
          context,
          orderedThinkingToolCall.sequence,
        );
        publishRuntimeToolCall(context, sessionId, orderedThinkingToolCall);
        return;
      }
      flushLiveAssistantMessage(sessionId, context);
      const compactedToolCall = compactBinaryToolCallOutput(event.toolCall);
      if (compactedToolCall.status === "running") {
        bufferRunningToolCall(sessionId, compactedToolCall, context);
        return;
      }
      const pendingRunningToolCall = consumePendingRunningToolCall(sessionId, context);
      if (pendingRunningToolCall && pendingRunningToolCall.toolCall.id !== compactedToolCall.id) {
        emitRuntimeToolCallSnapshot(sessionId, pendingRunningToolCall.toolCall, context);
      }
      const resolvedToolCall = pendingRunningToolCall?.toolCall.id === compactedToolCall.id
        ? mergeBufferedToolCallSnapshot(pendingRunningToolCall.toolCall, compactedToolCall)
        : compactedToolCall;
      emitRuntimeToolCallSnapshot(sessionId, resolvedToolCall, context);
      return;
    case "command-output":
      emitFirstHelmPromptTrace(context, {
        sessionId,
        phase: "helm.runtime.first_command_output",
        meta: { commandId: event.chunk.commandId, stream: event.chunk.stream },
      });
      flushLiveAssistantMessage(sessionId, context);
      bufferCommandOutputChunk(sessionId, event.chunk, context);
      return;
    case "diff-update":
      persistRuntimeSessionUpdate(sessionId, event, context);
      flushLiveAssistantMessage(sessionId, context);
      logRuntimeInfo(context, "runtime.diff.updated", {
        ...runtimeLogFields(sessionId, context),
        seq: nextLiveEventSequence(sessionId),
        files: event.files.length,
        paths: event.files.map((file) => file.path).slice(0, 8),
      });
      void context.publishDiffUpdate(sessionId, event.files);
      return;
    case "config-options": {
      flushLiveAssistantMessage(sessionId, context);
      const current = context.sessions.get(sessionId)?.summary ??
        context.sessionStore.list().find((item: SessionSummary) => item.id === sessionId);
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
      logRuntimeDebug(context, "runtime.config_options.received", {
        ...runtimeLogFields(sessionId, context),
        seq: nextLiveEventSequence(sessionId),
        agentMode: event.state.agentMode ?? "<none>",
        model: resolvedModel ?? "<none>",
        reasoning: resolvedReasoningEffort ?? "<none>",
        options: resolvedOptions.length,
      });
      const updated = context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        agentMode: current.agentMode ?? event.state.agentMode,
        model: resolvedModel,
        configOptions: resolvedOptions,
        reasoningEffort: resolvedReasoningEffort,
        updatedAt: new Date().toISOString(),
      }));
      createSessionEventPublisher(context).sessionUpdate(sessionId, {
        kind: "config_options",
        state: resolvedState,
        options: resolvedOptions,
      });
      if (updated) {
        createSessionEventPublisher(context).sessionUpdate(sessionId, {
          kind: "session_updated",
          session: context.hydrateSessionSummary(updated),
        });
      }
      return;
    }
    case "model-options": {
      flushLiveAssistantMessage(sessionId, context);
      logRuntimeDebug(context, "runtime.model_options.received", {
        ...runtimeLogFields(sessionId, context),
        seq: nextLiveEventSequence(sessionId),
        currentModel: event.state.currentModelId ?? "<none>",
        options: event.state.options.length,
      });
      const updated = context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        model: current.model ?? event.state.currentModelId,
        modelOptions: event.state.options,
        updatedAt: new Date().toISOString(),
      }));
      createSessionEventPublisher(context).sessionUpdate(sessionId, {
        kind: "model_options",
        currentModelId: event.state.currentModelId,
        options: event.state.options,
      });
      if (updated) {
        createSessionEventPublisher(context).sessionUpdate(sessionId, {
          kind: "session_updated",
          session: context.hydrateSessionSummary(updated),
        });
      }
      return;
    }
    case "available-commands": {
      flushLiveAssistantMessage(sessionId, context);
      logRuntimeDebug(context, "runtime.available_commands.received", {
        ...runtimeLogFields(sessionId, context),
        seq: nextLiveEventSequence(sessionId),
        commands: event.commands.length,
      });
      const updated = context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        availableCommands: event.commands,
        updatedAt: new Date().toISOString(),
      }));
      createSessionEventPublisher(context).sessionUpdate(sessionId, {
        kind: "commands_available",
        commands: event.commands,
      });
      if (updated) {
        createSessionEventPublisher(context).sessionUpdate(sessionId, {
          kind: "session_updated",
          session: context.hydrateSessionSummary(updated),
        });
      }
      return;
    }
    case "error":
      flushLiveAssistantMessage(sessionId, context);
      if (hasCanonicalTimelinePipeline(context)) {
        context.sessionTimelineFlushScheduler.flushNow(sessionId);
      }
      logRuntimeError(context, "runtime.error", {
        ...runtimeLogFields(sessionId, context),
        seq: nextLiveEventSequence(sessionId),
        code: event.code ?? "UNKNOWN",
        messageChars: event.message.length,
      });
      context.persistSessionMessage(sessionId, {
        id: `${sessionId}-system-${Date.now()}`,
        role: "system",
        text: event.message,
        timestamp: new Date().toISOString(),
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
) {
  const seq = nextLiveEventSequence(sessionId);
  const current = ignoredUserEchoSummaryBySession.get(sessionId);
  if (!current) {
    ignoredUserEchoSummaryBySession.set(sessionId, {
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

function publishRuntimeUserMessage(
  sessionId: string,
  message: Extract<SessionRuntimeEvent, { type: "message" }>["message"],
  context: HelmHandlerContext,
) {
  const userMessage = {
    ...message,
    sequence: nextLiveEventSequence(sessionId),
  };
  persistRuntimeSessionUpdate(sessionId, { type: "message", message: userMessage }, context, userMessage.sequence);
  context.persistSessionMessage(sessionId, userMessage);
  persistTimelineMessage(context, sessionId, userMessage);
  context.updateSessionSummary(sessionId, (current) =>
    applyUserPromptToSummary(current, userMessage.text, userMessage.timestamp),
  );
  createSessionEventPublisher(context).sessionUpdate(sessionId, {
    kind: "user_message",
    message: userMessage,
  });
}

function flushIgnoredUserEchoSummary(sessionId: string, context: HelmHandlerContext) {
  const summary = ignoredUserEchoSummaryBySession.get(sessionId);
  if (!summary) {
    return;
  }
  ignoredUserEchoSummaryBySession.delete(sessionId);
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
    context.sessionStore.list().find((item: { id: string }) => item.id === sessionId);
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
