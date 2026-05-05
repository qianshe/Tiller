import { applyAgentMessageToSummary } from "../sessions/summary/updates";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { AgentMessage } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";

function runtimeLogScope(sessionId: string, context: HelmHandlerContext) {
  const record = context.sessions.get(sessionId);
  return `session=${sessionId} agent=${record?.agent.id ?? "<stored>"} workspace=${record?.workspace.id ?? "<stored>"}`;
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

function isDuplicateUserEcho(recorded: AgentMessage, incoming: AgentMessage) {
  if (
    recorded.id === incoming.id ||
    recorded.text === incoming.text ||
    recorded.text.endsWith(incoming.text) ||
    incoming.text.endsWith(recorded.text)
  ) {
    return true;
  }

  const delta = Math.abs(Date.parse(recorded.timestamp) - Date.parse(incoming.timestamp));
  if (!Number.isFinite(delta) || delta > 60_000) {
    return false;
  }

  return normalizePromptText(incoming.text).includes(normalizePromptText(recorded.text));
}

function normalizePromptText(text: string) {
  return text.replace(/\s+/gu, " ").trim();
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
      context.logInfo(
        `[tiller] session.status ${runtimeLogScope(sessionId, context)} status=${event.status}${event.message ? ` message=${formatLogValue(event.message)}` : ""}`,
      );
      context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        status: event.status,
        updatedAt: new Date().toISOString(),
      }));
      context.broadcastAuthenticated({
        type: "session.status",
        sessionId,
        status: event.status,
        message: event.message,
      });
      return;
    case "message":
      if (event.message.role === "user") {
        const existingMessages = context.sessionMessageStore?.list(sessionId) as
          | AgentMessage[]
          | undefined;
        if (!existingMessages) {
          return;
        }
        const alreadyRecorded = existingMessages.some(
          (message) => message.role === "user" && isDuplicateUserEcho(message, event.message),
        );
        if (alreadyRecorded) {
          return;
        }
      }
      context.persistSessionMessage(sessionId, event.message);
      context.updateSessionSummary(sessionId, (current) =>
        applyAgentMessageToSummary(current, event.message),
      );
      context.broadcastAuthenticated({ type: "agent.message", sessionId, message: event.message });
      return;
    case "permission-request":
      context.logInfo(
        `[tiller] session.permission.request ${runtimeLogScope(sessionId, context)} request=${event.request.id} reason=${formatLogValue(event.request.reason)}`,
      );
      context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        status: "waiting_for_permission",
        updatedAt: new Date().toISOString(),
        lastMessagePreview: event.request.reason,
      }));
      context.permissionIndex.set(event.request.id, { sessionId, request: event.request });
      context.broadcastAuthenticated({
        type: "permission.request",
        sessionId,
        permissionRequest: event.request,
      });
      return;
    case "tool-call":
      context.logDebug(
        `[tiller] session.tool.call ${runtimeLogScope(sessionId, context)} id=${event.toolCall.id} title=${formatLogValue(event.toolCall.title ?? event.toolCall.kind ?? "tool")}`,
      );
      context.sessionArtifactStore.appendToolCall(sessionId, event.toolCall);
      context.broadcastAuthenticated({ type: "tool.call", sessionId, toolCall: event.toolCall });
      return;
    case "command-output":
      context.logInfo(
        `[tiller] session.command.output ${runtimeLogScope(sessionId, context)} command=${event.chunk.commandId} stream=${event.chunk.stream} chars=${event.chunk.text.length}`,
      );
      context.sessionArtifactStore.appendOutput(sessionId, event.chunk);
      context.broadcastAuthenticated({
        type: "command.output",
        sessionId,
        commandId: event.chunk.commandId,
        chunk: event.chunk,
      });
      if (event.toolCall) {
        context.sessionArtifactStore.appendToolCall(sessionId, event.toolCall);
        context.broadcastAuthenticated({ type: "tool.call", sessionId, toolCall: event.toolCall });
      }
      return;
    case "diff-update":
      context.logInfo(
        `[tiller] session.diff.update ${runtimeLogScope(sessionId, context)} files=${event.files.length} paths=${formatLogValue(event.files.map((file) => file.path).slice(0, 8))}`,
      );
      void context.publishDiffUpdate(sessionId, event.files);
      return;
    case "config-options": {
      context.logInfo(
        `[tiller] session.config.options ${runtimeLogScope(sessionId, context)} agentMode=${event.state.agentMode ?? "<none>"} model=${event.state.model ?? "<none>"} reasoning=${event.state.reasoningEffort ?? "<none>"} options=${event.options.length}`,
      );
      const updated = context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        agentMode: event.state.agentMode ?? current.agentMode,
        model: event.state.model ?? current.model,
        reasoningEffort: event.state.reasoningEffort ?? current.reasoningEffort,
        updatedAt: new Date().toISOString(),
      }));
      context.broadcastAuthenticated({
        type: "session.config.options",
        sessionId,
        state: event.state,
        options: event.options,
      });
      if (updated) {
        context.broadcastAuthenticated({
          type: "session.updated",
          requestId: `session-config-${Date.now()}`,
          session: context.hydrateSessionSummary(updated),
        });
      }
      return;
    }
    case "model-options": {
      context.logInfo(
        `[tiller] session.model.options ${runtimeLogScope(sessionId, context)} currentModel=${event.state.currentModelId ?? "<none>"} options=${event.state.options.length}`,
      );
      const updated = context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        model: event.state.currentModelId ?? current.model,
        modelOptions: event.state.options,
        updatedAt: new Date().toISOString(),
      }));
      context.broadcastAuthenticated({
        type: "session.model.options",
        sessionId,
        currentModelId: event.state.currentModelId,
        options: event.state.options,
      });
      if (updated) {
        context.broadcastAuthenticated({
          type: "session.updated",
          requestId: `session-model-${Date.now()}`,
          session: context.hydrateSessionSummary(updated),
        });
      }
      return;
    }
    case "available-commands":
      context.broadcastAuthenticated({
        type: "session.commands",
        sessionId,
        commands: event.commands,
      });
      return;
    case "error":
      context.logError(
        `[tiller] session.error ${runtimeLogScope(sessionId, context)} code=${event.code ?? "UNKNOWN"} message=${formatLogValue(event.message, 500)}`,
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
      context.broadcastAuthenticated({
        type: "error",
        sessionId,
        message: event.message,
        code: event.code,
      });
      return;
    default:
      return;
  }
}
