import type { HelmHandlerContext } from "../handlers/context";

const activeAssistantStreamLogBySession = new Map<
  string,
  { key: string }
>();

function logStreamInfo(context: HelmHandlerContext, event: string, fields: Record<string, unknown>) {
  if (context.logger) {
    context.logger.info(event, fields);
    return;
  }
  context.logInfo?.(`[tiller] ${event} ${formatLogFields(fields)}`);
}

function formatLogFields(fields: Record<string, unknown>) {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

export function createRuntimeStreamLogController() {
  function closeAssistantStreamLog(sessionId: string) {
    const active = activeAssistantStreamLogBySession.get(sessionId);
    if (!active) {
      return;
    }
    activeAssistantStreamLogBySession.delete(sessionId);
  }

  function ensureAssistantStreamLogStarted(
    sessionId: string,
    message: { id: string; role: string },
    context: HelmHandlerContext,
    nextLiveEventSequence: (sessionId: string) => number,
    runtimeLogFields: (sessionId: string, context: HelmHandlerContext) => Record<string, unknown>,
  ) {
    const key = `${sessionId}:${message.id}`;
    if (activeAssistantStreamLogBySession.get(sessionId)?.key === key) {
      return;
    }
    closeAssistantStreamLog(sessionId);
    activeAssistantStreamLogBySession.set(sessionId, { key });
    logStreamInfo(context, "runtime.assistant_stream.started", {
      ...runtimeLogFields(sessionId, context),
      seq: nextLiveEventSequence(sessionId),
      role: message.role,
      messageId: message.id,
    });
  }

  return {
    closeAssistantStreamLog,
    ensureAssistantStreamLogStarted,
  };
}
