import { applyAgentMessageToSummary, applyUserPromptToSummary } from "../sessions/facade";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { AgentMessage, SessionSummary } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import { handleRuntimePermissionRequest } from "./approval-boundary";
import { createSessionEventPublisher } from "./session-event-publisher";
import { publishRuntimeCommandOutput, publishRuntimeToolCall } from "./session-event-effects";
import { persistTimelineMessage } from "./session-timeline-effects";
import { emitFirstHelmPromptTrace } from "./prompt-trace";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "./session-config-options";
import {
  clearActiveRuntimeThinking,
  bumpAssistantStreamSegment,
  finalizeActiveRuntimeThinking,
  normalizeRuntimeAssistantMessageId,
  normalizeRuntimeThinkingToolCall,
  startNextAssistantResponseSegment,
} from "./segment-state";
import { createRuntimeStreamLogController } from "./stream-log";
import type { TillerLogFields } from "../logging/logger";

const liveEventSequenceBySession = new Map<string, number>();
const runtimeStreamLog = createRuntimeStreamLogController();
const ignoredUserEchoSummaryBySession = new Map<string, IgnoredUserEchoSummary>();

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

export function nextLiveEventSequenceForTest(sessionId: string) {
  return allocateLiveEventSequence(sessionId);
}

export function flushRuntimeUserEchoLogSummaryForTest(
  sessionId: string,
  context: HelmHandlerContext,
) {
  flushIgnoredUserEchoSummary(sessionId, context);
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

  switch (event.type) {
    case "status":
      emitFirstHelmPromptTrace(context, {
        sessionId,
        phase: "helm.runtime.first_status",
        meta: { status: event.status },
      });
      flushLiveAssistantMessage(sessionId, context);
      runtimeStreamLog.closeAssistantStreamLog(sessionId);
      if (event.status === "running") {
        startNextAssistantResponseSegment(sessionId);
      } else {
        const finalizedThinking = finalizeActiveRuntimeThinking(sessionId);
        if (finalizedThinking) {
          publishRuntimeToolCall(context, sessionId, finalizedThinking);
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
        runtimeStreamLog.closeAssistantStreamLog(sessionId);
        startNextAssistantResponseSegment(sessionId);
        if (shouldIgnoreRuntimeUserMessage(sessionId, event.message, context)) {
          recordIgnoredUserEcho(sessionId, event.message);
          return;
        }
        flushIgnoredUserEchoSummary(sessionId, context);
        publishRuntimeUserMessage(sessionId, event.message, context);
        return;
      }
      const message = {
        ...event.message,
        id: normalizeRuntimeAssistantMessageId(sessionId, event.message),
        timelineSequence: nextLiveEventSequence(sessionId),
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
      runtimeStreamLog.ensureAssistantStreamLogStarted(sessionId, message, context, nextLiveEventSequence, runtimeLogFields);
      const bufferedMessage = context.liveMessageBuffer.append(sessionId, message);
      createSessionEventPublisher(context).sessionUpdate(sessionId, {
        kind: "agent_message",
        message: bufferedMessage,
        streaming: true,
      });
      return;
    case "permission-request":
      flushLiveAssistantMessage(sessionId, context);
      runtimeStreamLog.closeAssistantStreamLog(sessionId);
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
      logRuntimeDebug(context, "runtime.plan.updated", {
        ...runtimeLogFields(sessionId, context),
        seq: nextLiveEventSequence(sessionId),
        entries: event.plan.entries.length,
      });
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
        const toolCall = normalizeRuntimeThinkingToolCall(sessionId, {
          ...event.toolCall,
          timelineSequence: nextLiveEventSequence(sessionId),
        });
        publishRuntimeToolCall(context, sessionId, toolCall);
        return;
      }
      flushLiveAssistantMessage(sessionId, context);
      runtimeStreamLog.closeAssistantStreamLog(sessionId);
      bumpAssistantStreamSegment(sessionId);
      const orderedToolCall = {
        ...event.toolCall,
        timelineSequence: nextLiveEventSequence(sessionId),
      };
      publishRuntimeToolCall(context, sessionId, orderedToolCall);
      return;
    case "command-output":
      emitFirstHelmPromptTrace(context, {
        sessionId,
        phase: "helm.runtime.first_command_output",
        meta: { commandId: event.chunk.commandId, stream: event.chunk.stream },
      });
      flushLiveAssistantMessage(sessionId, context);
      runtimeStreamLog.closeAssistantStreamLog(sessionId);
      bumpAssistantStreamSegment(sessionId);
      logRuntimeDebug(context, "runtime.command_output.chunk", {
        ...runtimeLogFields(sessionId, context),
        seq: nextLiveEventSequence(sessionId),
        commandId: event.chunk.commandId,
        stream: event.chunk.stream,
        chars: event.chunk.text.length,
      });
      const orderedChunk = {
        ...event.chunk,
        timelineSequence: nextLiveEventSequence(sessionId),
      };
      publishRuntimeCommandOutput(
        context,
        sessionId,
        orderedChunk,
        event.toolCall
          ? {
              ...event.toolCall,
              timelineSequence: orderedChunk.timelineSequence,
            }
          : undefined,
      );
      return;
    case "diff-update":
      flushLiveAssistantMessage(sessionId, context);
      runtimeStreamLog.closeAssistantStreamLog(sessionId);
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
      runtimeStreamLog.closeAssistantStreamLog(sessionId);
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
      runtimeStreamLog.closeAssistantStreamLog(sessionId);
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
      runtimeStreamLog.closeAssistantStreamLog(sessionId);
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
      runtimeStreamLog.closeAssistantStreamLog(sessionId);
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
    timelineSequence: nextLiveEventSequence(sessionId),
  };
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
  return event.type === "status" || event.type === "message" || event.type === "permission-request" || event.type === "tool-call" || event.type === "command-output";
}
