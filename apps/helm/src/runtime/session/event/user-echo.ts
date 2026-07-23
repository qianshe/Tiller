import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { AgentMessage } from "@tiller/shared";
import type { HelmHandlerContext } from "../../../handlers/context";
import { peekLiveEventSequence } from "./canonical";
import {
  type IgnoredUserEchoSummary,
  logRuntimeDebug,
  RUNTIME_EVENT_STATE_KEY,
  runtimeEventState,
  runtimeLogFields,
} from "./support";

export function isRuntimeUserMessageEvent(event: SessionRuntimeEvent) {
  return event.type === "message" && event.message.role === "user";
}

export function recordIgnoredUserEcho(
  sessionId: string,
  message: Extract<SessionRuntimeEvent, { type: "message" }>["message"],
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  const seq = message.sequence ?? peekLiveEventSequence(sessionId, context);
  const current = state.get<IgnoredUserEchoSummary>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.ignoredUserEchoSummary,
  );
  if (!current) {
    state.set(sessionId, RUNTIME_EVENT_STATE_KEY.ignoredUserEchoSummary, {
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

export function shouldIgnoreRuntimeUserMessage(
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

function listLocalUserMessages(
  sessionId: string,
  context: HelmHandlerContext,
): AgentMessage[] {
  try {
    return context.sessionMessageStore.list(sessionId).filter(
      (message: AgentMessage) => message.role === "user" && message.text.trim(),
    );
  } catch {
    return [];
  }
}

export function flushIgnoredUserEchoSummary(
  sessionId: string,
  context: HelmHandlerContext,
) {
  const state = runtimeEventState(context);
  const summary = state.get<IgnoredUserEchoSummary>(
    sessionId,
    RUNTIME_EVENT_STATE_KEY.ignoredUserEchoSummary,
  );
  if (!summary) {
    return;
  }
  state.delete(sessionId, RUNTIME_EVENT_STATE_KEY.ignoredUserEchoSummary);
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

export function flushRuntimeUserEchoLogSummaryForTest(
  sessionId: string,
  context: HelmHandlerContext,
) {
  flushIgnoredUserEchoSummary(sessionId, context);
}

export function shouldIgnoreLateRuntimeEvent(
  sessionId: string,
  event: SessionRuntimeEvent,
  context: HelmHandlerContext,
) {
  const activeRecord = context.sessions.get(sessionId);
  const current = activeRecord?.summary ?? context.sessionStore.get(sessionId);
  if (current?.status === "error" && activeRecord) {
    return false;
  }
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
