import { mapSessionUpdateNotification } from "@tiller/acp-runtime";
import { isFallbackToolCallTitle, pageSessionTimeline } from "@tiller/persistence";
import {
  buildSessionTimelineFromLegacy,
  resolveTimelineRepresentedUserMessageIds,
  splitSessionTimelineAssistantEntriesAtBoundaries,
} from "@tiller/shared";
import type {
  AgentMessage,
  AgentToolCall,
  SessionSummary,
  SessionTimelineEntry,
  SessionUpdateRecord,
} from "@tiller/shared";
import { reduceSessionUpdateRecords } from "../../runtime/session-updates/records";
import type { HelmHandlerContext } from "../context";
import { pageSessionSummaries } from "./session-list-page";

const TIMELINE_ENTRY_PAGE_LIMIT = 96;
const TIMELINE_UPDATE_REPAIR_PAGE_LIMIT = 200;
const TIMELINE_UPDATE_REPAIR_RECORD_LIMIT = 1_000;

function logSessionDebug(context: HelmHandlerContext, event: string, fields: Record<string, unknown>) {
  if (context.logger) {
    context.logger.debug(event, fields);
    return;
  }
  context.logDebug?.(`[tiller] ${event} ${formatLogFields(fields)}`);
}

function logSessionInfo(context: HelmHandlerContext, event: string, fields: Record<string, unknown>) {
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

export function listSessions(params: { limit?: number; before?: string }, context: HelmHandlerContext) {
  const normalizedSessions = context.sessionStore.list().map(context.migrateStoredSessionSummary);
  const page = pageSessionSummaries(normalizedSessions, {
    limit: params.limit,
    before: params.before,
  });
  logSessionDebug(context, "session.list", {
    count: normalizedSessions.length,
    page: page.sessions.length,
    hasMore: page.hasMore,
  });
  return {
    sessions: page.sessions,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    before: params.before,
  };
}

export function subscribeSession(params: { sessionId: string }, context: HelmHandlerContext) {
  if (!context.socketId) {
    throw new Error("Session topic subscription requires an authenticated socket");
  }
  context.subscribeSessionTopic(context.socketId, params.sessionId);
  return {
    ok: true,
    message: `Subscribed to session ${params.sessionId}.`,
  };
}

export function unsubscribeSession(params: { sessionId: string }, context: HelmHandlerContext) {
  if (!context.socketId) {
    throw new Error("Session topic unsubscription requires an authenticated socket");
  }
  context.unsubscribeSessionTopic(context.socketId, params.sessionId);
  return {
    ok: true,
    message: `Unsubscribed from session ${params.sessionId}.`,
  };
}

// Deck consumes old session history through paged windows only. ACP restore replay may
// repair Helm's local cache, but it must not push a full historical transcript to Deck.
export async function listMessages(
  params: { sessionId: string; limit?: number; before?: string; timelineBefore?: string },
  context: HelmHandlerContext,
) {
  await context.refreshAuthoritativeSessionHistory(params.sessionId);
  repairProviderToolCalls(params.sessionId, context);
  const page = context.sessionMessageStore.listPage(params.sessionId, {
    limit: params.limit,
    before: params.before,
  });
  const timelinePage = listSessionTimelinePage(params, context, page.messages);
  return {
    sessionId: params.sessionId,
    messages: page.messages,
    timeline: timelinePage.entries,
    timelineNextCursor: timelinePage.nextCursor,
    timelineHasMore: timelinePage.hasMore,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    before: params.before,
    timelineBefore: params.timelineBefore,
  };
}

export async function getArtifacts(
  params: { sessionId: string; limit?: number; before?: string },
  context: HelmHandlerContext,
) {
  await context.refreshAuthoritativeSessionHistory(params.sessionId);
  repairProviderToolCalls(params.sessionId, context);
  const artifacts = context.sessionArtifactStore.getPage(params.sessionId, {
    limit: params.limit,
    before: params.before,
  });
  const diffs = await context.hydrateDiffsFromWorktreeGit(params.sessionId, artifacts.diffs);
  const plan = context.readSessionPlan?.(params.sessionId);
  return {
    sessionId: params.sessionId,
    outputs: artifacts.outputs,
    diffs,
    toolCalls: artifacts.toolCalls,
    ...(plan ? { plan } : {}),
    nextCursor: artifacts.nextCursor,
    hasMore: artifacts.hasMore,
  };
}

export async function reimportHistory(
  params: { sessionId: string; limit?: number },
  context: HelmHandlerContext,
) {
  return context.reimportSessionHistory(params.sessionId, { limit: params.limit });
}

export function checkResume(params: { sessionId: string }, context: HelmHandlerContext) {
  logSessionDebug(context, "session.resume.check", { sessionId: params.sessionId });
  const summary = context.sessionStore.list().find((item: any) => item.id === params.sessionId);
  if (!summary) {
    throw new Error("Session not found");
  }
  const hydrated = context.hydrateSessionSummary(summary);
  return {
    sessionId: params.sessionId,
    resume:
      hydrated.resume ??
      context.buildResumeInfo(
        hydrated,
        context.resolveProviderById(hydrated.agentId, context.getAgents()),
      ),
  };
}

export async function resumeSession(params: { sessionId: string }, context: HelmHandlerContext) {
  logSessionDebug(context, "session.resume.started", { sessionId: params.sessionId });
  const result = await context.startSessionResume(params.sessionId);
  logSessionInfo(context, "session.resume.completed", {
    sessionId: params.sessionId,
    ok: result.ok,
    method: result.resume.restoreMethod ?? "none",
    messageChars: result.message.length,
  });
  return {
    sessionId: params.sessionId,
    ok: result.ok,
    resume: result.resume,
    message: result.message,
  };
}

function repairProviderToolCalls(sessionId: string, context: HelmHandlerContext) {
  const summary = resolveSessionSummary(sessionId, context);
  const providerId = summary?.agentId;
  if (!providerId || !context.sessionArtifactStore?.replaceToolCalls) {
    return;
  }

  const artifacts = context.sessionArtifactStore.get(sessionId);
  const repairedToolCalls = artifacts.toolCalls.map((toolCall: AgentToolCall) =>
    repairCompletedThinkingToolCall(summary, repairProviderToolCall(sessionId, providerId, toolCall)),
  );
  if (!hasToolCallChanges(artifacts.toolCalls, repairedToolCalls)) {
    return;
  }

  context.sessionArtifactStore.replaceToolCalls(sessionId, repairedToolCalls);
}

function listSessionTimelinePage(
  params: { sessionId: string; limit?: number; before?: string; timelineBefore?: string },
  context: HelmHandlerContext,
  visibleMessages: AgentMessage[] = [],
) {
  if (!context.sessionTimelineStore) {
    return { entries: [], hasMore: false };
  }

  const page = resolveRawTimelinePage(params, context, visibleMessages);
  const projected = projectArtifactToolCallMetadata(params.sessionId, context, page.entries);
  if (!projected) return page;
  context.sessionTimelineStore.replace?.(params.sessionId, projected);
  return { ...page, entries: projected };
}

function resolveRawTimelinePage(
  params: { sessionId: string; limit?: number; before?: string; timelineBefore?: string },
  context: HelmHandlerContext,
  visibleMessages: AgentMessage[],
) {
  const options = {
    entryLimit: TIMELINE_ENTRY_PAGE_LIMIT,
    limit: params.limit,
    before: params.timelineBefore ?? params.before,
    window: "message" as const,
  };
  const persistedPage = context.sessionTimelineStore!.listPage?.(params.sessionId, options);
  const normalizedPersistedPage = persistedPage
    ? {
        ...persistedPage,
        entries: splitSessionTimelineAssistantEntriesAtBoundaries(persistedPage.entries),
      }
    : undefined;
  const repairedPersistedTimeline = !options.before && normalizedPersistedPage
    ? repairTimelineFromSessionUpdates(params.sessionId, context, normalizedPersistedPage.entries)
    : undefined;
  if (repairedPersistedTimeline) {
    const stored = context.sessionTimelineStore!.replace(params.sessionId, repairedPersistedTimeline);
    return pageSessionTimeline(stored, options);
  }
  if (normalizedPersistedPage && isAuthoritativeTimelinePage(normalizedPersistedPage, options.before)) {
    if (
      options.before ||
      !isTimelineMissingVisibleHistoryAnchors(normalizedPersistedPage.entries, visibleMessages)
    ) {
      return normalizedPersistedPage;
    }
  }

  const existing = persistedPage
    ? []
    : splitSessionTimelineAssistantEntriesAtBoundaries(context.sessionTimelineStore!.list?.(params.sessionId) ?? []);
  const repairedExistingTimeline = !options.before && existing.length
    ? repairTimelineFromSessionUpdates(params.sessionId, context, existing)
    : undefined;
  if (repairedExistingTimeline) {
    const stored = context.sessionTimelineStore!.replace(params.sessionId, repairedExistingTimeline);
    return pageSessionTimeline(stored, options);
  }
  if (
    existing.length &&
    (
      options.before ||
      !isTimelineMissingVisibleHistoryAnchors(existing, visibleMessages)
    )
  ) {
    return pageSessionTimeline(existing, options);
  }

  const rebuilt = rebuildSessionTimelineFromLegacy(params.sessionId, context);
  if (!rebuilt.length) {
    return persistedPage ?? { entries: [], hasMore: false };
  }

  const stored = context.sessionTimelineStore!.replace(params.sessionId, rebuilt);
  return pageSessionTimeline(stored, options);
}

function repairTimelineFromSessionUpdates(
  sessionId: string,
  context: HelmHandlerContext,
  entries: SessionTimelineEntry[],
) {
  if (!shouldInspectSessionUpdateRepair(entries) || !context.sessionUpdateStore?.listPage) {
    return undefined;
  }
  const replayed = rebuildSessionTimelineFromUpdates(sessionId, context);
  return shouldReplaceTimelineWithUpdateReplay(entries, replayed) ? replayed : undefined;
}

function shouldInspectSessionUpdateRepair(entries: SessionTimelineEntry[]) {
  return entries.some((entry) => entry.kind === "tool_call") &&
    entries.some((entry) =>
      entry.kind === "assistant_message" &&
      entry.chunks.some((chunk) => chunk.kind === "content" && chunk.text.trim())
    );
}

function rebuildSessionTimelineFromUpdates(
  sessionId: string,
  context: HelmHandlerContext,
) {
  const records = listSessionUpdateRecordsForRepair(sessionId, context);
  if (!records.length) {
    return [];
  }
  return splitSessionTimelineAssistantEntriesAtBoundaries(
    reduceSessionUpdateRecords(records).entries,
  );
}

function listSessionUpdateRecordsForRepair(
  sessionId: string,
  context: HelmHandlerContext,
) {
  const records: SessionUpdateRecord[] = [];
  let before: string | undefined;
  do {
    const page = context.sessionUpdateStore.listPage(sessionId, {
      limit: TIMELINE_UPDATE_REPAIR_PAGE_LIMIT,
      before,
    });
    records.push(...(page.updates ?? []));
    before = page.hasMore ? page.nextCursor : undefined;
  } while (before && records.length < TIMELINE_UPDATE_REPAIR_RECORD_LIMIT);
  return records
    .slice(0, TIMELINE_UPDATE_REPAIR_RECORD_LIMIT)
    .sort((left, right) => left.sequence - right.sequence);
}

function shouldReplaceTimelineWithUpdateReplay(
  current: SessionTimelineEntry[],
  replayed: SessionTimelineEntry[],
) {
  if (!replayed.length || !shouldInspectSessionUpdateRepair(replayed)) {
    return false;
  }
  const currentSequences = collectAssistantContentSequences(current);
  if (
    Array.from(collectAssistantContentSequences(replayed))
      .some((sequence) => !currentSequences.has(sequence))
  ) {
    return true;
  }
  return replayedHasStrongerToolMetadata(current, replayed);
}

function replayedHasStrongerToolMetadata(
  current: SessionTimelineEntry[],
  replayed: SessionTimelineEntry[],
) {
  const currentToolCalls = indexTimelineToolCalls(current);
  for (const entry of replayed) {
    if (entry.kind !== "tool_call") {
      continue;
    }
    const currentTool = currentToolCalls.get(entry.toolCall.id) ??
      (entry.toolCall.commandId ? currentToolCalls.get(entry.toolCall.commandId) : undefined);
    if (!currentTool) {
      return true;
    }
    if (isStrongerReplayedToolCall(entry.toolCall, currentTool)) {
      return true;
    }
  }
  return false;
}

function indexTimelineToolCalls(entries: SessionTimelineEntry[]) {
  const index = new Map<string, AgentToolCall>();
  for (const entry of entries) {
    if (entry.kind !== "tool_call") {
      continue;
    }
    index.set(entry.toolCall.id, entry.toolCall);
    if (entry.toolCall.commandId) {
      index.set(entry.toolCall.commandId, entry.toolCall);
    }
  }
  return index;
}

function isStrongerReplayedToolCall(replayed: AgentToolCall, current: AgentToolCall) {
  return toolMetadataRank(replayed.kind) > toolMetadataRank(current.kind) ||
    (isWeakTimelineToolCallTitle(current.title, current) && !isWeakTimelineToolCallTitle(replayed.title, replayed)) ||
    (!current.input && Boolean(replayed.input)) ||
    (!current.output && Boolean(replayed.output));
}

function isWeakTimelineToolCallTitle(title: string, toolCall: AgentToolCall) {
  const normalizedTitle = title.trim().toLowerCase();
  return !normalizedTitle ||
    isFallbackToolCallTitle(title) ||
    normalizedTitle === toolCall.id.toLowerCase() ||
    normalizedTitle === toolCall.commandId?.toLowerCase();
}

function toolMetadataRank(kind: AgentToolCall["kind"]) {
  const ranks: Record<AgentToolCall["kind"], number> = {
    unknown: 0,
    tool: 1,
    think: 2,
    todo: 2,
    fetch: 2,
    search: 3,
    read: 3,
    write: 3,
    shell: 3,
    skill: 3,
    subagent: 3,
    mcp: 4,
  };
  return ranks[kind];
}

function collectAssistantContentSequences(entries: SessionTimelineEntry[]) {
  const sequences = new Set<number>();
  for (const entry of entries) {
    if (entry.kind !== "assistant_message") {
      continue;
    }
    for (const chunk of entry.chunks) {
      if (chunk.kind === "content" && typeof chunk.timelineSequence === "number") {
        sequences.add(chunk.timelineSequence);
      }
    }
  }
  return sequences;
}

function isAuthoritativeTimelinePage(
  page: { entries: SessionTimelineEntry[]; hasMore: boolean },
  before: string | undefined,
) {
  return Boolean(before) || page.hasMore || page.entries.length > 0;
}

function isTimelineMissingVisibleUserAnchors(
  entries: SessionTimelineEntry[],
  visibleMessages: AgentMessage[],
) {
  const visibleUsers = visibleMessages.filter(isVisibleUserMessage);
  if (!visibleUsers.length) {
    return false;
  }
  const representedUserIds = resolveTimelineRepresentedUserMessageIds(entries, visibleUsers);
  return representedUserIds.size < visibleUsers.length;
}

function isTimelineMissingVisibleHistoryAnchors(
  entries: SessionTimelineEntry[],
  visibleMessages: AgentMessage[],
) {
  return isTimelineMissingVisibleUserAnchors(entries, visibleMessages) ||
    isTimelineMissingVisibleAssistantToolBoundaries(entries, visibleMessages);
}

function isTimelineMissingVisibleAssistantToolBoundaries(
  entries: SessionTimelineEntry[],
  visibleMessages: AgentMessage[],
) {
  if (
    !entries.some((entry) => entry.kind === "assistant_message") ||
    !entries.some((entry) => entry.kind === "tool_call")
  ) {
    return false;
  }
  const visibleAssistantMessages = visibleMessages.filter(isVisibleAssistantMessage);
  if (!visibleAssistantMessages.length) {
    return false;
  }
  const representedSnapshots = collectTimelineAssistantContentSnapshots(entries);
  return visibleAssistantMessages.some((message) =>
    !representedSnapshots.some((snapshot) => representsAssistantMessage(snapshot, message))
  );
}

function isVisibleUserMessage(message: AgentMessage) {
  return message.role === "user" && Boolean(message.text.trim());
}

function isVisibleAssistantMessage(message: AgentMessage) {
  return message.role === "assistant" && Boolean(message.text.trim());
}

type AssistantContentSnapshot = {
  text: string;
  timestamp: string;
  timelineSequence?: number;
};

function collectTimelineAssistantContentSnapshots(
  entries: SessionTimelineEntry[],
): AssistantContentSnapshot[] {
  const snapshots: AssistantContentSnapshot[] = [];
  const cumulativeTextByEntryKey = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind !== "assistant_message") {
      continue;
    }
    const entryKey = resolveAssistantSnapshotEntryKey(entry.id);
    let cumulativeText = cumulativeTextByEntryKey.get(entryKey) ?? "";
    for (const chunk of entry.chunks) {
      if (chunk.kind !== "content") {
        continue;
      }
      cumulativeText += chunk.text;
      snapshots.push({
        text: cumulativeText.trim(),
        timestamp: chunk.timestamp,
        timelineSequence: chunk.timelineSequence,
      });
    }
    cumulativeTextByEntryKey.set(entryKey, cumulativeText);
  }
  return snapshots;
}

function resolveAssistantSnapshotEntryKey(entryId: string) {
  return entryId.replace(/#p\d+$/u, "");
}

function representsAssistantMessage(
  snapshot: AssistantContentSnapshot,
  message: AgentMessage,
) {
  if (snapshot.text !== message.text.trim()) {
    return false;
  }
  if (
    typeof snapshot.timelineSequence === "number" &&
    typeof message.timelineSequence === "number"
  ) {
    return snapshot.timelineSequence === message.timelineSequence;
  }
  return snapshot.timestamp === message.timestamp;
}

function rebuildSessionTimelineFromLegacy(sessionId: string, context: HelmHandlerContext) {
  const messages = context.sessionMessageStore.list?.(sessionId) ?? [];
  const artifacts = context.sessionArtifactStore?.get?.(sessionId) ?? {
    outputs: [],
    diffs: [],
    toolCalls: [],
  };
  return buildSessionTimelineFromLegacy({
    messages,
    outputs: artifacts.outputs,
    toolCalls: artifacts.toolCalls,
  });
}

function resolveSessionSummary(sessionId: string, context: HelmHandlerContext): SessionSummary | undefined {
  return (
    context.sessions?.get(sessionId)?.summary ??
    context.sessionStore?.list().find((item: SessionSummary) => item.id === sessionId)
  );
}

function repairProviderToolCall(
  sessionId: string,
  providerId: string,
  toolCall: AgentToolCall,
) {
  const mapped = mapSessionUpdateNotification(
    {
      method: "session/update",
      params: {
        sessionId,
        update: {
          type: "tool_call_update",
          toolCall,
        },
      },
    },
    { providerId },
  );
  if (mapped?.event.type !== "tool-call") return toolCall;
  const repaired = mapped.event.toolCall;
  if (isFallbackToolCallTitle(repaired.title) && !isFallbackToolCallTitle(toolCall.title)) {
    return { ...repaired, title: toolCall.title };
  }
  return repaired;
}

function repairCompletedThinkingToolCall(
  summary: SessionSummary,
  toolCall: AgentToolCall,
) {
  if (
    toolCall.kind !== "think" ||
    (toolCall.status !== "running" && toolCall.status !== "pending") ||
    summary.status === "running" ||
    summary.status === "waiting_for_permission"
  ) {
    return toolCall;
  }
  return {
    ...toolCall,
    status: "completed" as const,
    updatedAt: summary.updatedAt,
  };
}

function projectArtifactToolCallMetadata(
  sessionId: string,
  context: HelmHandlerContext,
  entries: SessionTimelineEntry[],
): SessionTimelineEntry[] | undefined {
  const hasWeakToolCalls = entries.some((entry) =>
    entry.kind === "tool_call" && (entry as unknown as { toolCall: AgentToolCall }).toolCall.kind === "tool",
  );
  if (!hasWeakToolCalls) return undefined;
  const artifacts = context.sessionArtifactStore?.get?.(sessionId);
  if (!artifacts?.toolCalls?.length) return undefined;
  const index = new Map<string, AgentToolCall>(artifacts.toolCalls.map((tc: AgentToolCall) => [tc.id, tc]));
  let changed = false;
  const repaired = entries.map((entry) => {
    if (entry.kind !== "tool_call") return entry;
    const tc = (entry as unknown as { toolCall: AgentToolCall }).toolCall;
    const stronger = index.get(tc.id);
    if (!stronger || !isStrongerReplayedToolCall(stronger, tc)) return entry;
    changed = true;
    return { ...entry, toolCall: { ...tc, kind: stronger.kind, title: stronger.title } };
  });
  if (!changed) return undefined;
  context.sessionTimelineStore?.replace?.(sessionId, repaired);
  return repaired;
}

function hasToolCallChanges(left: AgentToolCall[], right: AgentToolCall[]) {
  if (left.length !== right.length) {
    return true;
  }
  return left.some((item, index) => {
    const next = right[index];
    return (
      !next ||
      item.kind !== next.kind ||
      item.title !== next.title ||
      item.status !== next.status ||
      item.input !== next.input ||
      item.updatedAt !== next.updatedAt
    );
  });
}

function hasTimelineMessageAnchor(entries: SessionTimelineEntry[]) {
  return entries.some((entry) => (
    entry.kind === "user_message" ||
    entry.kind === "system_message" ||
    (entry.kind === "assistant_message" && entry.chunks.some((chunk) => chunk.kind === "content" && chunk.text.trim()))
  ));
}
