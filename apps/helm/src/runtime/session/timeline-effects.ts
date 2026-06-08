import type { AgentMessage, AgentToolCall, SessionTimelineEntry } from "@tiller/shared";
import {
  appendMessageToSessionTimeline,
  appendToolCallToSessionTimeline,
  sortSessionTimelineEntries,
} from "@tiller/shared";
import type { HelmHandlerContext } from "../../handlers/context";

export function persistTimelineMessage(
  context: HelmHandlerContext,
  sessionId: string,
  message: AgentMessage,
) {
  if (!context.sessionTimelineStore) {
    return undefined;
  }
  if (typeof context.sessionTimelineStore.upsertMessage === "function") {
    return context.sessionTimelineStore.upsertMessage(sessionId, message);
  }
  const entries = context.sessionTimelineStore.list(sessionId);
  appendMessageToSessionTimeline(entries, message);
  return replaceTimelineEntries(context, sessionId, entries, resolveMessageEntryId(message));
}

export function persistTimelineToolCall(
  context: HelmHandlerContext,
  sessionId: string,
  toolCall: AgentToolCall,
) {
  if (!context.sessionTimelineStore) {
    return undefined;
  }
  if (typeof context.sessionTimelineStore.upsertToolCall === "function") {
    return context.sessionTimelineStore.upsertToolCall(sessionId, toolCall);
  }
  const entries = context.sessionTimelineStore.list(sessionId);
  appendToolCallToSessionTimeline(entries, toolCall);
  return replaceTimelineEntries(context, sessionId, entries, resolveToolCallEntryId(toolCall));
}

function replaceTimelineEntries(
  context: HelmHandlerContext,
  sessionId: string,
  entries: SessionTimelineEntry[],
  entryId: string,
) {
  const next = context.sessionTimelineStore.replace(
    sessionId,
    sortSessionTimelineEntries(entries),
  ) as SessionTimelineEntry[];
  return next.find((entry: SessionTimelineEntry) => entry.id === entryId);
}

function resolveMessageEntryId(message: AgentMessage) {
  return message.id;
}

function resolveToolCallEntryId(toolCall: AgentToolCall) {
  if (toolCall.kind === "think") {
    const sourceId = toolCall.commandId ?? toolCall.id;
    return stripThinkingSuffix(sourceId) ?? stripThinkingSuffix(toolCall.id) ?? sourceId;
  }
  return `tool:${toolCall.id}`;
}

function stripThinkingSuffix(value: string) {
  return value.endsWith(":thinking") ? value.slice(0, -":thinking".length) : null;
}
