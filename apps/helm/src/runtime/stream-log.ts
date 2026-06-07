import type { HelmHandlerContext } from "../handlers/context";

const activeAssistantStreamLogBySession = new Map<
  string,
  { key: string }
>();
const assistantStreamSummaryBySession = new Map<string, AssistantStreamSummary>();

type AssistantStreamMessage = {
  id: string;
  role: string;
  text?: string;
  timelineSequence?: number;
};

type AssistantStreamSummary = {
  chunks: number;
  firstMessageId: string;
  firstSeq?: number;
  lastMessageId: string;
  lastSeq?: number;
  messageIds: Set<string>;
  assistantChars: number;
  role: string;
  segments: number;
  startedAtMs: number;
};

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
  function closeAssistantStreamLog(
    sessionId: string,
    context?: HelmHandlerContext,
    nextLiveEventSequence?: (sessionId: string) => number,
    runtimeLogFields?: (sessionId: string, context: HelmHandlerContext) => Record<string, unknown>,
  ) {
    const active = activeAssistantStreamLogBySession.get(sessionId);
    if (!active) {
      return;
    }
    activeAssistantStreamLogBySession.delete(sessionId);
    const summary = assistantStreamSummaryBySession.get(sessionId);
    assistantStreamSummaryBySession.delete(sessionId);
    if (!summary || !context || !nextLiveEventSequence || !runtimeLogFields) {
      return;
    }
    logStreamInfo(context, "runtime.assistant_stream.completed", {
      ...runtimeLogFields(sessionId, context),
      seq: nextLiveEventSequence(sessionId),
      role: summary.role,
      segments: summary.segments,
      chunks: summary.chunks,
      uniqueMessages: summary.messageIds.size,
      assistantChars: summary.assistantChars,
      durationMs: Math.max(0, Date.now() - summary.startedAtMs),
      firstSeq: summary.firstSeq,
      lastSeq: summary.lastSeq,
      firstMessageId: summary.firstMessageId,
      lastMessageId: summary.lastMessageId,
    });
  }

  function ensureAssistantStreamLogStarted(
    sessionId: string,
    message: AssistantStreamMessage,
    _context: HelmHandlerContext,
    _nextLiveEventSequence: (sessionId: string) => number,
    _runtimeLogFields: (sessionId: string, context: HelmHandlerContext) => Record<string, unknown>,
  ) {
    const key = `${sessionId}:${message.id}`;
    const current = assistantStreamSummaryBySession.get(sessionId);
    if (!current) {
      assistantStreamSummaryBySession.set(sessionId, {
        chunks: 1,
        firstMessageId: message.id,
        firstSeq: message.timelineSequence,
        lastMessageId: message.id,
        lastSeq: message.timelineSequence,
        messageIds: new Set([message.id]),
        assistantChars: message.text?.length ?? 0,
        role: message.role,
        segments: 1,
        startedAtMs: Date.now(),
      });
      activeAssistantStreamLogBySession.set(sessionId, { key });
      return;
    }
    current.chunks += 1;
    current.lastMessageId = message.id;
    current.lastSeq = message.timelineSequence;
    current.messageIds.add(message.id);
    current.assistantChars += message.text?.length ?? 0;
    if (activeAssistantStreamLogBySession.get(sessionId)?.key === key) {
      return;
    }
    current.segments += 1;
    activeAssistantStreamLogBySession.set(sessionId, { key });
  }

  return {
    closeAssistantStreamLog,
    ensureAssistantStreamLogStarted,
  };
}
