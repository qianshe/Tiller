import { applyAgentMessageToSummary, applyUserPromptToSummary } from "../sessions/facade";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type {
  AgentMessage,
  SessionSummary,
  SessionTimelineContextCompactionEntry,
  SessionTimelineEntry,
} from "@tiller/shared";
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
  "sessionTimelineWorkers" | "sessionTimelineDispatcher" | "sessionLiveStateStore"
>> {
  return Boolean(
    context.sessionTimelineWorkers &&
      context.sessionTimelineDispatcher &&
      context.sessionLiveStateStore,
  );
}

function routeCanonicalTimelineEvent(
  sessionId: string,
  event: SessionRuntimeEvent,
  context: HelmHandlerContext & Required<Pick<
    HelmHandlerContext,
    "sessionTimelineWorkers" | "sessionTimelineDispatcher" | "sessionLiveStateStore"
  >>,
) {
  return routeSessionRuntimeEvent(sessionId, event, {
    workers: context.sessionTimelineWorkers,
    liveStateStore: context.sessionLiveStateStore,
    dispatcher: context.sessionTimelineDispatcher,
    context,
  });
}

function inferPendingCompactionCompletion(
  sessionId: string,
  event: SessionRuntimeEvent,
  context: HelmHandlerContext & Required<Pick<
    HelmHandlerContext,
    "sessionTimelineWorkers" | "sessionTimelineDispatcher" | "sessionLiveStateStore"
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
) {
  const summaries = commandOutputSummaryBySession.get(sessionId) ?? new Map<string, CommandOutputSummary>();
  commandOutputSummaryBySession.set(sessionId, summaries);
  const key = `${chunk.commandId}\u001f${chunk.stream}`;
  const current = summaries.get(key);
  if (!current) {
    summaries.set(key, {
      chars: chunk.text.length,
      chunks: 1,
      commandId: chunk.commandId,
      firstSeq: sequence,
      lastSeq: sequence,
      stream: chunk.stream,
    });
    return;
  }
  current.chars += chunk.text.length;
  current.chunks += 1;
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
  const message = context.liveMessageBuffer.finalize(sessionId);
  if (!message) {
    return false;
  }
  context.persistSessionMessage(sessionId, message);
  persistTimelineMessage(context, sessionId, message);
  context.updateSessionSummary(sessionId, (current) => applyAgentMessageToSummary(current, message));
  createSessionEventPublisher(context).sessionUpdate(sessionId, {
    kind: "agent_message",
    message,
    streaming: false,
  });
  return true;
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
    flushCommandOutputSummaries(sessionId, context);
  }
  if (hasCanonicalTimelinePipeline(context) && hasPendingTimelineCompaction(sessionId, context)) {
    inferPendingCompactionCompletion(sessionId, event, context);
  }

  switch (event.type) {
    case "status":
      emitFirstHelmPromptTrace(context, {
        sessionId,
        phase: "helm.runtime.first_status",
        meta: { status: event.status },
      });
      flushLiveAssistantMessage(sessionId, context);
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
      if (hasCanonicalTimelinePipeline(context)) {
        persistRuntimeSessionUpdate(sessionId, { ...event, message }, context);
        context.updateSessionSummary(sessionId, (current) => applyAgentMessageToSummary(current, message));
        routeCanonicalTimelineEvent(sessionId, { ...event, message }, context);
        return;
      }
      const orderedMessage = {
        ...message,
        sequence: nextLiveEventSequence(sessionId),
      };
      persistRuntimeSessionUpdate(sessionId, { ...event, message: orderedMessage }, context, orderedMessage.sequence);
      if (context.liveMessageBuffer.peek(sessionId)?.id !== message.id) {
        flushLiveAssistantMessage(sessionId, context);
      }
      const bufferedMessage = context.liveMessageBuffer.append(sessionId, orderedMessage);
      createSessionEventPublisher(context).sessionUpdate(sessionId, {
        kind: "agent_message",
        message: bufferedMessage,
        streaming: true,
      });
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
      bumpAssistantStreamSegment(sessionId);
      if (hasCanonicalTimelinePipeline(context)) {
        persistRuntimeSessionUpdate(sessionId, event, context);
        routeCanonicalTimelineEvent(sessionId, event, context);
        recordRuntimeToolCallArtifact(context, sessionId, {
          ...event.toolCall,
          sequence: nextLiveEventSequence(sessionId),
        });
        return;
      }
      flushLiveAssistantMessage(sessionId, context);
      const orderedToolCall = {
        ...event.toolCall,
        sequence: nextLiveEventSequence(sessionId),
      };
      const mergedToolCall = publishRuntimeToolCall(context, sessionId, orderedToolCall);
      persistRuntimeSessionUpdate(
        sessionId,
        { ...event, toolCall: mergedToolCall },
        context,
        orderedToolCall.sequence,
      );
      return;
    case "command-output":
      emitFirstHelmPromptTrace(context, {
        sessionId,
        phase: "helm.runtime.first_command_output",
        meta: { commandId: event.chunk.commandId, stream: event.chunk.stream },
      });
      bumpAssistantStreamSegment(sessionId);
      if (hasCanonicalTimelinePipeline(context)) {
        persistRuntimeSessionUpdate(sessionId, event, context);
        routeCanonicalTimelineEvent(sessionId, event, context);
        const orderedChunkForArtifacts = {
          ...event.chunk,
          sequence: nextLiveEventSequence(sessionId),
        };
        recordCommandOutputSummary(sessionId, event.chunk, orderedChunkForArtifacts.sequence);
        recordRuntimeCommandOutputArtifact(context, sessionId, orderedChunkForArtifacts);
        if (event.toolCall) {
          recordRuntimeToolCallArtifact(context, sessionId, {
            ...event.toolCall,
            sequence: orderedChunkForArtifacts.sequence,
          });
        }
        return;
      }
      flushLiveAssistantMessage(sessionId, context);
      const orderedChunk = {
        ...event.chunk,
        sequence: nextLiveEventSequence(sessionId),
      };
      persistRuntimeSessionUpdate(
        sessionId,
        {
          ...event,
          chunk: orderedChunk,
          toolCall: event.toolCall
            ? {
                ...event.toolCall,
                sequence: orderedChunk.sequence,
              }
            : undefined,
        },
        context,
        orderedChunk.sequence,
      );
      recordCommandOutputSummary(sessionId, event.chunk, orderedChunk.sequence);
      publishRuntimeCommandOutput(
        context,
        sessionId,
        orderedChunk,
        event.toolCall
          ? {
              ...event.toolCall,
              sequence: orderedChunk.sequence,
            }
          : undefined,
      );
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
  const current =
    context.sessions.get(sessionId)?.summary ??
    context.sessionStore.list().find((item: { id: string }) => item.id === sessionId);
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
