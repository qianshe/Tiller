import type {
  AgentMessage,
  AgentToolCall,
  SessionTimelineEntry,
  SessionTimelineTranscriptEventEntry,
} from "@tiller/shared";
import {
  appendMessageToSessionTimeline,
  appendToolCallToSessionTimeline,
  sortSessionTimelineEntries,
} from "@tiller/shared";
import type { HelmHandlerContext } from "../../handlers/context";
import { upsertSessionCompactionEntry } from "../../sessions/compaction-entry";

export function persistTimelineMessage(
  context: HelmHandlerContext,
  sessionId: string,
  message: AgentMessage,
) {
  if (!context.sessionTimelineStore) {
    return undefined;
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
  const entries = context.sessionTimelineStore.list(sessionId);
  appendToolCallToSessionTimeline(entries, toolCall);
  return replaceTimelineEntries(context, sessionId, entries, resolveToolCallEntryId(toolCall));
}

export function persistTimelineTranscriptEvent(
  context: HelmHandlerContext,
  sessionId: string,
  entry: SessionTimelineTranscriptEventEntry,
): SessionTimelineTranscriptEventEntry | undefined {
  if (!context.sessionTimelineStore) {
    return undefined;
  }
  const entries = context.sessionTimelineStore.list(sessionId);
  const storedEntry = entry.kind === "context_compaction"
    ? upsertSessionCompactionEntry(entries, entry)
    : upsertTranscriptEventEntry(entries, entry);
  const persisted = replaceTimelineEntries(context, sessionId, entries, storedEntry.id);
  return persisted &&
      (persisted.kind === "context_compaction" ||
        persisted.kind === "session_resumed" ||
        persisted.kind === "history_gap")
    ? persisted
    : undefined;
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

function upsertTranscriptEventEntry(
  entries: SessionTimelineEntry[],
  entry: SessionTimelineTranscriptEventEntry,
) {
  const existingIndex = entries.findIndex((candidate: SessionTimelineEntry) => candidate.id === entry.id);
  if (existingIndex === -1) {
    entries.push(entry);
    return entry;
  }
  entries[existingIndex] = entry;
  return entry;
}

function stripThinkingSuffix(value: string) {
  return value.endsWith(":thinking") ? value.slice(0, -":thinking".length) : null;
}
