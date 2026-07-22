import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { CommandChunk } from "@tiller/shared";
import type { HelmHandlerContext } from "../../../handlers/context";
import { emitFirstHelmPromptTrace } from "../../prompt-trace";
import {
  assertCanonicalTimelinePipeline,
  nextLiveEventSequence,
  prepareRuntimeSessionUpdate,
  routeCanonicalTimelineEvent,
} from "./canonical";
import { materializeRuntimeCommandOutputChunk } from "./effects";
import {
  clearRuntimeEventTimer,
  type CommandOutputSummary,
  logRuntimeDebug,
  type PendingCommandOutput,
  resolveRuntimeEventThrottleConfig,
  RUNTIME_EVENT_STATE_KEY,
  runtimeEventState,
  runtimeLogFields,
  scheduleRuntimeEventTimer,
} from "./support";

function mergeBufferedCommandChunk(
  current: CommandChunk,
  incoming: CommandChunk,
): CommandChunk {
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

function consumePendingCommandOutput(
  sessionId: string,
  context: HelmHandlerContext,
) {
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
  recordCommandOutputSummary(
    sessionId,
    chunk,
    orderedChunk.sequence,
    inputChunkCount,
    context,
  );
}

export function flushPendingCommandOutput(
  sessionId: string,
  context: HelmHandlerContext,
) {
  const pending = consumePendingCommandOutput(sessionId, context);
  if (!pending) {
    return false;
  }
  emitRuntimeCommandOutputChunk(sessionId, pending.chunk, pending.inputChunks, context);
  return true;
}

function scheduleCommandOutputFlush(
  sessionId: string,
  context: HelmHandlerContext,
) {
  const pending = runtimeEventState(context).get<PendingCommandOutput>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.pendingCommandOutput,
  );
  if (!pending) {
    return false;
  }
  const config = resolveRuntimeEventThrottleConfig(context);
  if (
    pending.chunk.text.length >= config.commandOutputMaxChars ||
    config.commandOutputWindowMs <= 0
  ) {
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

export function bufferCommandOutputChunk(
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

function recordCommandOutputSummary(
  sessionId: string,
  chunk: Extract<SessionRuntimeEvent, { type: "command-output" }>["chunk"],
  sequence: number,
  inputChunkCount: number,
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

export function flushCommandOutputSummaries(
  sessionId: string,
  context: HelmHandlerContext,
) {
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

export function handleRuntimeCommandOutputEvent(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "command-output" }>,
  context: HelmHandlerContext,
) {
  emitFirstHelmPromptTrace(context, {
    sessionId,
    phase: "helm.runtime.first_command_output",
    meta: { commandId: event.chunk.commandId, stream: event.chunk.stream },
  });
  bufferCommandOutputChunk(sessionId, {
    ...event.chunk,
    sequence: event.chunk.sequence ?? nextLiveEventSequence(sessionId, context),
  }, context);
}
