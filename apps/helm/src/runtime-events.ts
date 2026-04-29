import { applyAgentMessageToSummary } from "./sessions/summary-updates";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { HelmHandlerContext } from "./handlers/context";

export function handleRuntimeEvent(sessionId: string, event: SessionRuntimeEvent, context: HelmHandlerContext) {
  if (!context.sessions.has(sessionId) && !context.sessionStore.list().some((item: { id: string }) => item.id === sessionId)) {
    return;
  }

  switch (event.type) {
    case "status":
      context.logInfo(`[tiller-helm] session.status session=${sessionId} status=${event.status}${event.message ? ` message=${event.message}` : ""}`);
      context.updateSessionSummary(sessionId, (current) => ({ ...current, status: event.status, updatedAt: new Date().toISOString() }));
      context.broadcastAuthenticated({ type: "session.status", sessionId, status: event.status, message: event.message });
      return;
    case "message":
      context.persistSessionMessage(sessionId, event.message);
      context.updateSessionSummary(sessionId, (current) => applyAgentMessageToSummary(current, event.message));
      context.broadcastAuthenticated({ type: "agent.message", sessionId, message: event.message });
      return;
    case "permission-request":
      context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        status: "waiting_for_permission",
        updatedAt: new Date().toISOString(),
        lastMessagePreview: event.request.reason,
      }));
      context.permissionIndex.set(event.request.id, { sessionId, request: event.request });
      context.broadcastAuthenticated({ type: "permission.request", sessionId, permissionRequest: event.request });
      return;
    case "tool-call":
      context.sessionArtifactStore.appendToolCall(sessionId, event.toolCall);
      context.broadcastAuthenticated({ type: "tool.call", sessionId, toolCall: event.toolCall });
      return;
    case "command-output":
      context.sessionArtifactStore.appendOutput(sessionId, event.chunk);
      context.broadcastAuthenticated({ type: "command.output", sessionId, commandId: event.chunk.commandId, chunk: event.chunk });
      if (event.toolCall) {
        context.sessionArtifactStore.appendToolCall(sessionId, event.toolCall);
        context.broadcastAuthenticated({ type: "tool.call", sessionId, toolCall: event.toolCall });
      }
      return;
    case "diff-update":
      void context.publishDiffUpdate(sessionId, event.files);
      return;
    case "config-options": {
      context.logInfo(`[tiller-helm] session.config.options session=${sessionId} model=${event.state.model ?? "<none>"} reasoning=${event.state.reasoningEffort ?? "<none>"} options=${event.options.length}`);
      const updated = context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        model: event.state.model ?? current.model,
        reasoningEffort: event.state.reasoningEffort ?? current.reasoningEffort,
        updatedAt: new Date().toISOString(),
      }));
      context.broadcastAuthenticated({ type: "session.config.options", sessionId, state: event.state, options: event.options });
      if (updated) {
        context.broadcastAuthenticated({ type: "session.updated", requestId: `session-config-${Date.now()}`, session: context.hydrateSessionSummary(updated) });
      }
      return;
    }
    case "model-options": {
      context.logInfo(`[tiller-helm] session.model.options session=${sessionId} currentModel=${event.state.currentModelId ?? "<none>"} options=${event.state.options.length}`);
      const updated = context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        model: event.state.currentModelId ?? current.model,
        modelOptions: event.state.options,
        updatedAt: new Date().toISOString(),
      }));
      context.broadcastAuthenticated({ type: "session.model.options", sessionId, currentModelId: event.state.currentModelId, options: event.state.options });
      if (updated) {
        context.broadcastAuthenticated({ type: "session.updated", requestId: `session-model-${Date.now()}`, session: context.hydrateSessionSummary(updated) });
      }
      return;
    }
    case "error":
      context.logError(`[tiller-helm] session.error session=${sessionId} code=${event.code ?? "UNKNOWN"} message=${event.message}`);
      context.persistSessionMessage(sessionId, { id: `${sessionId}-system-${Date.now()}`, role: "system", text: event.message, timestamp: new Date().toISOString() });
      context.updateSessionSummary(sessionId, (current) => ({
        ...current,
        status: "error",
        updatedAt: new Date().toISOString(),
        lastMessagePreview: event.message.slice(0, 160),
      }));
      context.broadcastAuthenticated({ type: "error", sessionId, message: event.message, code: event.code });
      return;
    default:
      return;
  }
}