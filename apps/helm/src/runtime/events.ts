import { applyAgentMessageToSummary } from "../sessions/facade";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { SessionSummary } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import { handleRuntimePermissionRequest } from "./approval-boundary";
import { createSessionEventPublisher } from "./session-event-publisher";
import { publishRuntimeCommandOutput, publishRuntimeToolCall } from "./session-event-effects";
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
import { formatLogValue } from "./session-event-normalizer";

const liveEventSequenceBySession = new Map<string, number>();
const runtimeStreamLog = createRuntimeStreamLogController();

function runtimeLogScope(sessionId: string, context: HelmHandlerContext) {
  const record = context.sessions.get(sessionId);
  return `session=${sessionId} agent=${record?.agent.id ?? "<stored>"} cwd=${record?.worktree.path ?? "<stored>"}`;
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


export function flushLiveAssistantMessage(sessionId: string, context: HelmHandlerContext) {
  const message = context.liveMessageBuffer.finalize(sessionId);
  if (!message) {
    return false;
  }
  context.persistSessionMessage(sessionId, message);
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
    context.logInfo(
      `[tiller] 阶段=忽略迟到运行事件 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} type=${event.type}`,
    );
    return;
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
      context.logInfo(
        `[tiller] 阶段=运行状态流 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} status=${event.status}${event.message ? ` message=${formatLogValue(event.message)}` : ""}`,
      );
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
        context.logInfo(
          `[tiller] 阶段=用户回显忽略 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} id=${event.message.id} chars=${event.message.text.length} text=${formatLogValue(event.message.text, 520)}`,
        );
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
      runtimeStreamLog.ensureAssistantStreamLogStarted(sessionId, message, context, nextLiveEventSequence, runtimeLogScope);
      runtimeStreamLog.writeAssistantStreamText(sessionId, message.text);
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
      context.logInfo(
        `[tiller] 阶段=权限请求 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} request=${event.request.id} reason=${formatLogValue(event.request.reason)}`,
      );
      handleRuntimePermissionRequest(
        {
          sessionId,
          request: event.request,
          logScope: runtimeLogScope(sessionId, context),
        },
        context,
      );
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
      context.logInfo(
        `[tiller] 阶段=命令输出流 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} command=${event.chunk.commandId} stream=${event.chunk.stream} chars=${event.chunk.text.length} text=${formatLogValue(event.chunk.text, 520)}`,
      );
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
      context.logInfo(
        `[tiller] 阶段=Diff更新 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} files=${event.files.length} paths=${formatLogValue(event.files.map((file) => file.path).slice(0, 8))}`,
      );
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
      context.logInfo(
        `[tiller] 阶段=配置选项 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} agentMode=${event.state.agentMode ?? "<none>"} model=${resolvedModel ?? "<none>"} reasoning=${resolvedReasoningEffort ?? "<none>"} options=${resolvedOptions.length}`,
      );
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
      context.logInfo(
        `[tiller] 阶段=模型选项 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} currentModel=${event.state.currentModelId ?? "<none>"} options=${event.state.options.length}`,
      );
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
      context.logInfo(
        `[tiller] 阶段=可用命令 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} commands=${event.commands.length}`,
      );
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
      context.logError(
        `[tiller] 阶段=运行错误 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} code=${event.code ?? "UNKNOWN"} message=${formatLogValue(event.message, 500)}`,
      );
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
        context.logInfo(
          `[tiller] 阶段=运行时已标记为可恢复 ${runtimeLogScope(sessionId, context)} code=${event.code}`,
        );
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
