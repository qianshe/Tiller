import { applyAgentMessageToSummary } from "../sessions/facade";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { HelmHandlerContext } from "../handlers/context";
import { broadcastErrorRaised, broadcastSessionUpdate } from "../rpc/notifications";

const liveEventSequenceBySession = new Map<string, number>();
const assistantStreamSegmentBySession = new Map<string, number>();
const activeAssistantStreamLogBySession = new Map<
  string,
  { key: string; endsWithNewline: boolean }
>();

function runtimeLogScope(sessionId: string, context: HelmHandlerContext) {
  const record = context.sessions.get(sessionId);
  return `session=${sessionId} agent=${record?.agent.id ?? "<stored>"} workspace=${record?.workspace.id ?? "<stored>"}`;
}

function nextLiveEventSequence(sessionId: string) {
  const next = (liveEventSequenceBySession.get(sessionId) ?? 0) + 1;
  liveEventSequenceBySession.set(sessionId, next);
  return next;
}

function bumpAssistantStreamSegment(sessionId: string) {
  assistantStreamSegmentBySession.set(
    sessionId,
    (assistantStreamSegmentBySession.get(sessionId) ?? 0) + 1,
  );
}

function currentAssistantStreamSegmentMessageId(sessionId: string) {
  return `${sessionId}-msg-s${assistantStreamSegmentBySession.get(sessionId) ?? 0}`;
}

function normalizeRuntimeAssistantMessageId(sessionId: string, messageId: string) {
  return isRuntimeGeneratedMessageId(messageId)
    ? currentAssistantStreamSegmentMessageId(sessionId)
    : messageId;
}

function isRuntimeGeneratedMessageId(id: string) {
  return /^(?:session-[\w-]+|[0-9a-f]{8,}(?:-[0-9a-f]{4,}){2,})-msg-[a-z0-9]+$/iu.test(id);
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

function toolDisplayName(toolCall: { title?: string; kind?: string }) {
  return formatLogValue(toolCall.title ?? toolCall.kind ?? "tool", 120);
}

function toolDebugDetails(toolCall: {
  id: string;
  kind?: string;
  title?: string;
  commandId?: string;
}) {
  return [
    `call=${formatLogValue(toolCall.id, 120)}`,
    `kind=${formatLogValue(toolCall.kind ?? "unknown", 80)}`,
    `title=${formatLogValue(toolCall.title ?? "", 220)}`,
    toolCall.commandId ? `command=${formatLogValue(toolCall.commandId, 160)}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

function runtimeUserEchoActivity(message: { id: string; text: string; timestamp: string }) {
  return {
    id: `${message.id}-activity`,
    kind: "unknown" as const,
    title: "ACP 用户回显",
    status: "completed" as const,
    input: message.text,
    timestamp: message.timestamp,
    updatedAt: message.timestamp,
  };
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

  switch (event.type) {
    case "status":
      closeAssistantStreamLog(sessionId);
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
        context.logInfo(
          `[tiller] 阶段=用户回显忽略 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} id=${event.message.id} chars=${event.message.text.length} text=${formatLogValue(event.message.text, 520)}`,
        );
        const userEchoActivity = runtimeUserEchoActivity(event.message);
        context.sessionArtifactStore.appendToolCall(sessionId, userEchoActivity);
        broadcastSessionUpdate(context, sessionId, {
          kind: "tool_call",
          toolCall: userEchoActivity,
        });
        return;
      }
      const message = {
        ...event.message,
        id: normalizeRuntimeAssistantMessageId(sessionId, event.message.id),
      };
      ensureAssistantStreamLogStarted(sessionId, message, context);
      writeAssistantStreamText(sessionId, message.text);
      context.persistSessionMessage(sessionId, message);
      context.updateSessionSummary(sessionId, (current) =>
        applyAgentMessageToSummary(current, message),
      );
      broadcastSessionUpdate(context, sessionId, {
        kind: "agent_message",
        message,
      });
      return;
    case "permission-request":
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
      context.permissionIndex.set(event.request.id, { sessionId, request: event.request });
      broadcastSessionUpdate(context, sessionId, {
        kind: "permission_request",
        permissionRequest: event.request,
      });
      return;
    case "tool-call":
      closeAssistantStreamLog(sessionId);
      bumpAssistantStreamSegment(sessionId);
      context.logInfo(
        `[tiller] 阶段=直播工具调用 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} tool=${toolDisplayName(event.toolCall)} status=${event.toolCall.status ?? "unknown"} ${toolDebugDetails(event.toolCall)}`,
      );
      context.sessionArtifactStore.appendToolCall(sessionId, event.toolCall);
      broadcastSessionUpdate(context, sessionId, {
        kind: "tool_call",
        toolCall: event.toolCall,
      });
      return;
    case "command-output":
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
      closeAssistantStreamLog(sessionId);
      context.logInfo(
        `[tiller] 阶段=Diff更新 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} files=${event.files.length} paths=${formatLogValue(event.files.map((file) => file.path).slice(0, 8))}`,
      );
      void context.publishDiffUpdate(sessionId, event.files);
      return;
    case "config-options": {
      closeAssistantStreamLog(sessionId);
      context.logInfo(
        `[tiller] 阶段=配置选项 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} agentMode=${event.state.agentMode ?? "<none>"} model=${event.state.model ?? "<none>"} reasoning=${event.state.reasoningEffort ?? "<none>"} options=${event.options.length}`,
      );
      const updated = context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        agentMode: event.state.agentMode ?? current.agentMode,
        model: event.state.model ?? current.model,
        reasoningEffort: event.state.reasoningEffort ?? current.reasoningEffort,
        updatedAt: new Date().toISOString(),
      }));
      broadcastSessionUpdate(context, sessionId, {
        kind: "config_options",
        state: event.state,
        options: event.options,
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
      closeAssistantStreamLog(sessionId);
      context.logInfo(
        `[tiller] 阶段=模型选项 seq=${nextLiveEventSequence(sessionId)} ${runtimeLogScope(sessionId, context)} currentModel=${event.state.currentModelId ?? "<none>"} options=${event.state.options.length}`,
      );
      const updated = context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        model: event.state.currentModelId ?? current.model,
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

