import { applyAgentMessageToSummary } from "../sessions/facade";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { AgentToolCall, SessionSummary } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import { broadcastErrorRaised, broadcastSessionUpdate } from "../rpc/notifications";
import { createMessageSegmentIdAllocator } from "./message-segment-id";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "./session-config-options";

const liveEventSequenceBySession = new Map<string, number>();
const messageSegmentIds = createMessageSegmentIdAllocator();
const activeAssistantStreamLogBySession = new Map<
  string,
  { key: string; endsWithNewline: boolean }
>();
const activeAssistantRuntimeMessageBySession = new Map<
  string,
  { sourceId: string; segmentId: string; text: string }
>();
const activeAssistantRuntimeThinkingBySession = new Map<
  string,
  { sourceId: string; segmentId: string; text: string }
>();

function runtimeLogScope(sessionId: string, context: HelmHandlerContext) {
  const record = context.sessions.get(sessionId);
  return `session=${sessionId} agent=${record?.agent.id ?? "<stored>"} cwd=${record?.worktree.path ?? "<stored>"}`;
}

function nextLiveEventSequence(sessionId: string) {
  const next = (liveEventSequenceBySession.get(sessionId) ?? 0) + 1;
  liveEventSequenceBySession.set(sessionId, next);
  return next;
}

function bumpAssistantStreamSegment(sessionId: string) {
  messageSegmentIds.bumpToolBoundary(sessionId);
  activeAssistantRuntimeMessageBySession.delete(sessionId);
  activeAssistantRuntimeThinkingBySession.delete(sessionId);
}

function startNextAssistantResponseSegment(sessionId: string) {
  if (
    !activeAssistantRuntimeMessageBySession.has(sessionId) &&
    !activeAssistantRuntimeThinkingBySession.has(sessionId)
  ) {
    return;
  }
  messageSegmentIds.startAssistantTurn(sessionId);
  activeAssistantRuntimeMessageBySession.delete(sessionId);
  activeAssistantRuntimeThinkingBySession.delete(sessionId);
}

function normalizeRuntimeAssistantMessageId(
  sessionId: string,
  message: { id: string; text: string },
) {
  const active = activeAssistantRuntimeMessageBySession.get(sessionId);
  if (active && !shouldStartNewRuntimeAssistantSegment(active.text, message.text)) {
    activeAssistantRuntimeMessageBySession.set(sessionId, {
      sourceId: message.id,
      segmentId: active.segmentId,
      text: mergeAssistantStreamText(active.text, message.text),
    });
    return active.segmentId;
  }

  if (active) {
    messageSegmentIds.bumpToolBoundary(sessionId);
  }
  const segmentId = messageSegmentIds.nextAssistantSegmentId(sessionId, {
    text: message.text,
    providerMessageId: isRuntimeGeneratedMessageId(message.id) ? null : message.id,
  });
  activeAssistantRuntimeMessageBySession.set(sessionId, {
    sourceId: message.id,
    segmentId,
    text: message.text,
  });
  return segmentId;
}

function normalizeRuntimeThinkingToolCall(
  sessionId: string,
  toolCall: AgentToolCall,
): AgentToolCall {
  const text = toolCall.output ?? "";
  const active = activeAssistantRuntimeThinkingBySession.get(sessionId);
  if (active && !shouldStartNewRuntimeAssistantSegment(active.text, text)) {
    activeAssistantRuntimeThinkingBySession.set(sessionId, {
      sourceId: toolCall.id,
      segmentId: active.segmentId,
      text: mergeAssistantStreamText(active.text, text),
    });
    return {
      ...toolCall,
      id: active.segmentId,
      commandId: active.segmentId,
    };
  }

  if (active) {
    messageSegmentIds.bumpToolBoundary(sessionId);
  }
  const sourceId = toolCall.id.replace(/:thinking$/u, "");
  const segmentId = `${messageSegmentIds.nextAssistantSegmentId(sessionId, {
    text,
    providerMessageId: isRuntimeGeneratedMessageId(sourceId) ? null : sourceId,
  })}:thinking`;
  activeAssistantRuntimeThinkingBySession.set(sessionId, {
    sourceId: toolCall.id,
    segmentId,
    text,
  });
  return {
    ...toolCall,
    id: segmentId,
    commandId: segmentId,
  };
}

function shouldStartNewRuntimeAssistantSegment(currentText: string, incomingText: string) {
  if (!currentText || !incomingText) {
    return false;
  }
  if (incomingText.startsWith(currentText) || currentText.endsWith(incomingText)) {
    return false;
  }
  if (isProviderDiagnosticAssistantText(currentText) !== isProviderDiagnosticAssistantText(incomingText)) {
    return true;
  }
  return false;
}

function isProviderDiagnosticAssistantText(text: string) {
  return /^Model metadata for\b/u.test(text.trim());
}

function mergeAssistantStreamText(currentText: string, incomingText: string) {
  if (!currentText || incomingText.startsWith(currentText)) {
    return incomingText || currentText;
  }
  if (currentText.endsWith(incomingText)) {
    return currentText;
  }
  return `${currentText}${incomingText}`;
}

function isRuntimeGeneratedMessageId(id: string) {
  return /^(?:session-[\w-]+|[0-9a-f]{8,}(?:-[0-9a-f]{4,}){2,})-msg-(?:[a-z0-9]+|\d{6}-\d{6}-[pc][a-z0-9]{1,32})$/iu.test(id);
}

function oneLine(value: string, maxLength = 220) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function formatLogValue(value: unknown, maxLength = 220) {
  if (typeof value === "string") {
    return oneLine(value, maxLength);
  }
  try {
    return oneLine(JSON.stringify(value), maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}

function closeAssistantStreamLog(sessionId: string) {
  const active = activeAssistantStreamLogBySession.get(sessionId);
  if (!active) {
    return;
  }
  if (!active.endsWithNewline) {
    process.stdout.write("\n");
  }
  activeAssistantStreamLogBySession.delete(sessionId);
}

function ensureAssistantStreamLogStarted(
  sessionId: string,
  message: { id: string; role: string },
  context: HelmHandlerContext,
) {
  const key = `${sessionId}:${message.id}`;
  if (activeAssistantStreamLogBySession.get(sessionId)?.key === key) {
    return;
  }
  closeAssistantStreamLog(sessionId);
  activeAssistantStreamLogBySession.set(sessionId, {
    key,
    endsWithNewline: true,
  });
  context.logInfo(
    `[tiller] 阶段=直播消息流开始 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} role=${message.role} id=${message.id}`,
  );
}

function writeAssistantStreamText(sessionId: string, text: string) {
  if (!text) {
    return;
  }
  process.stdout.write(text);
  const active = activeAssistantStreamLogBySession.get(sessionId);
  if (active) {
    active.endsWithNewline = /[\r\n]$/.test(text);
  }
}

export function flushLiveAssistantMessage(sessionId: string, context: HelmHandlerContext) {
  const message = context.liveMessageBuffer.finalize(sessionId);
  if (!message) {
    return false;
  }
  context.persistSessionMessage(sessionId, message);
  context.updateSessionSummary(sessionId, (current) => applyAgentMessageToSummary(current, message));
  broadcastSessionUpdate(context, sessionId, {
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
      flushLiveAssistantMessage(sessionId, context);
      closeAssistantStreamLog(sessionId);
      if (event.status === "running") {
        startNextAssistantResponseSegment(sessionId);
      }
      context.logInfo(
        `[tiller] 阶段=运行状态流 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} status=${event.status}${event.message ? ` message=${formatLogValue(event.message)}` : ""}`,
      );
      context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        status: event.status,
        updatedAt: new Date().toISOString(),
      }));
      broadcastSessionUpdate(context, sessionId, {
        kind: "status_change",
        status: event.status,
        message: event.message,
      });
      return;
    case "message":
      if (event.message.role === "user") {
        closeAssistantStreamLog(sessionId);
        startNextAssistantResponseSegment(sessionId);
        context.logInfo(
          `[tiller] 阶段=用户回显忽略 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} id=${event.message.id} chars=${event.message.text.length} text=${formatLogValue(event.message.text, 520)}`,
        );
        return;
      }
      const message = {
        ...event.message,
        id: normalizeRuntimeAssistantMessageId(sessionId, event.message),
      };
      activeAssistantRuntimeThinkingBySession.delete(sessionId);
      if (context.liveMessageBuffer.peek(sessionId)?.id !== message.id) {
        flushLiveAssistantMessage(sessionId, context);
      }
      ensureAssistantStreamLogStarted(sessionId, message, context);
      writeAssistantStreamText(sessionId, message.text);
      const bufferedMessage = context.liveMessageBuffer.append(sessionId, message);
      broadcastSessionUpdate(context, sessionId, {
        kind: "agent_message",
        message: bufferedMessage,
        streaming: true,
      });
      return;
    case "permission-request":
      flushLiveAssistantMessage(sessionId, context);
      closeAssistantStreamLog(sessionId);
      context.logInfo(
        `[tiller] 阶段=权限请求 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} request=${event.request.id} reason=${formatLogValue(event.request.reason)}`,
      );
      context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        status: "waiting_for_permission",
        updatedAt: new Date().toISOString(),
        lastMessagePreview: event.request.reason,
      }));
      context.approvalIndex.set(event.request.id, { sessionId, request: event.request });
      context.broadcastNotification("approval/created", {
        sessionId,
        request: event.request,
        session: context.sessions.get(sessionId)?.summary ?? null,
      });
      return;
    case "tool-call":
      if (event.toolCall.kind === "think") {
        const toolCall = normalizeRuntimeThinkingToolCall(sessionId, event.toolCall);
        const artifacts = context.sessionArtifactStore.appendToolCall(sessionId, toolCall) as
          | { toolCalls?: AgentToolCall[] }
          | undefined;
        const mergedToolCall = artifacts?.toolCalls?.find((item) => item.id === toolCall.id) ?? toolCall;
        broadcastSessionUpdate(context, sessionId, {
          kind: "tool_call",
          toolCall: mergedToolCall,
        });
        return;
      }
      flushLiveAssistantMessage(sessionId, context);
      closeAssistantStreamLog(sessionId);
      bumpAssistantStreamSegment(sessionId);
      const artifacts = context.sessionArtifactStore.appendToolCall(sessionId, event.toolCall) as
        | { toolCalls?: AgentToolCall[] }
        | undefined;
      const mergedToolCall = artifacts?.toolCalls?.find((item) => item.id === event.toolCall.id) ?? event.toolCall;
      broadcastSessionUpdate(context, sessionId, {
        kind: "tool_call",
        toolCall: mergedToolCall,
      });
      return;
    case "command-output":
      flushLiveAssistantMessage(sessionId, context);
      closeAssistantStreamLog(sessionId);
      bumpAssistantStreamSegment(sessionId);
      context.logInfo(
        `[tiller] 阶段=命令输出流 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} command=${event.chunk.commandId} stream=${event.chunk.stream} chars=${event.chunk.text.length} text=${formatLogValue(event.chunk.text, 520)}`,
      );
      context.sessionArtifactStore.appendOutput(sessionId, event.chunk);
      broadcastSessionUpdate(context, sessionId, {
        kind: "command_output",
        commandId: event.chunk.commandId,
        chunk: event.chunk,
      });
      if (event.toolCall) {
        context.sessionArtifactStore.appendToolCall(sessionId, event.toolCall);
        broadcastSessionUpdate(context, sessionId, {
          kind: "tool_call",
          toolCall: event.toolCall,
        });
      }
      return;
    case "diff-update":
      flushLiveAssistantMessage(sessionId, context);
      closeAssistantStreamLog(sessionId);
      context.logInfo(
        `[tiller] 阶段=Diff更新 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} files=${event.files.length} paths=${formatLogValue(event.files.map((file) => file.path).slice(0, 8))}`,
      );
      void context.publishDiffUpdate(sessionId, event.files);
      return;
    case "config-options": {
      flushLiveAssistantMessage(sessionId, context);
      closeAssistantStreamLog(sessionId);
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
      broadcastSessionUpdate(context, sessionId, {
        kind: "config_options",
        state: resolvedState,
        options: resolvedOptions,
      });
      if (updated) {
        broadcastSessionUpdate(context, sessionId, {
          kind: "session_updated",
          session: context.hydrateSessionSummary(updated),
        });
      }
      return;
    }
    case "model-options": {
      flushLiveAssistantMessage(sessionId, context);
      closeAssistantStreamLog(sessionId);
      context.logInfo(
        `[tiller] 阶段=模型选项 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} currentModel=${event.state.currentModelId ?? "<none>"} options=${event.state.options.length}`,
      );
      const updated = context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        model: current.model ?? event.state.currentModelId,
        modelOptions: event.state.options,
        updatedAt: new Date().toISOString(),
      }));
      broadcastSessionUpdate(context, sessionId, {
        kind: "model_options",
        currentModelId: event.state.currentModelId,
        options: event.state.options,
      });
      if (updated) {
        broadcastSessionUpdate(context, sessionId, {
          kind: "session_updated",
          session: context.hydrateSessionSummary(updated),
        });
      }
      return;
    }
    case "available-commands": {
      flushLiveAssistantMessage(sessionId, context);
      closeAssistantStreamLog(sessionId);
      context.logInfo(
        `[tiller] 阶段=可用命令 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} commands=${event.commands.length}`,
      );
      const updated = context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        availableCommands: event.commands,
        updatedAt: new Date().toISOString(),
      }));
      broadcastSessionUpdate(context, sessionId, {
        kind: "commands_available",
        commands: event.commands,
      });
      if (updated) {
        broadcastSessionUpdate(context, sessionId, {
          kind: "session_updated",
          session: context.hydrateSessionSummary(updated),
        });
      }
      return;
    }
    case "error":
      flushLiveAssistantMessage(sessionId, context);
      closeAssistantStreamLog(sessionId);
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
      broadcastErrorRaised(context, {
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
