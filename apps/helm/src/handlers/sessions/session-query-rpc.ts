import { mapSessionUpdateNotification } from "@tiller/acp-runtime";
import { isFallbackToolCallTitle, pageSessionTimeline } from "@tiller/persistence";
import {
  buildSessionTimelineFromLegacy,
  injectTranscriptBoundaryEvents,
  looksLikeContinuationSummary,
  resolveTimelineRepresentedUserMessageIds,
  splitSessionTimelineAssistantEntriesAtBoundaries,
} from "@tiller/shared";
import type {
  AgentMessage,
  AgentToolCall,
  SessionSummary,
  SessionTimelineEntry,
  SessionTranscriptStatus,
  SessionUpdateRecord,
} from "@tiller/shared";
import { reduceSessionUpdateRecords } from "../../runtime/session-updates/records";
import { broadcastSessionUpdate } from "../../rpc/notifications";
import type { HelmHandlerContext } from "../context";
import { pageSessionSummaries } from "./session-list-page";

const TIMELINE_ENTRY_PAGE_LIMIT = 96;
const TIMELINE_ORDER_CURSOR_PREFIX = "order";
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
  notifyCurrentSocketPromptQueueSnapshot(params.sessionId, context);
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
  const transcriptStatus = resolveTranscriptStatus(page.messages, params.before, params.timelineBefore);
  return {
    sessionId: params.sessionId,
    messages: page.messages,
    timeline: timelinePage.entries,
    transcriptStatus,
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
  if (result.ok) {
    const queue = context.promptQueue.snapshot(params.sessionId);
    if (queue.queued.length > 0 || queue.inFlight) {
      broadcastSessionUpdate(context, params.sessionId, {
        kind: "prompt_queue",
        queue,
      });
    }
  }
  return {
    sessionId: params.sessionId,
    ok: result.ok,
    resume: result.resume,
    message: result.message,
  };
}

function notifyCurrentSocketPromptQueueSnapshot(
  sessionId: string,
  context: Pick<
    HelmHandlerContext,
    "authenticatedSockets" | "notify" | "promptQueue" | "socketId"
  >,
) {
  const queue = context.promptQueue.snapshot(sessionId);
  if (queue.queued.length === 0 && !queue.inFlight) {
    return;
  }

  const socketRecord = context.authenticatedSockets
    ?.listAll?.()
    ?.find((record: { socketId: string }) => record.socketId === context.socketId);
  if (!socketRecord?.socket) {
    return;
  }

  context.notify(socketRecord.socket, "session/update", {
    sessionId,
    update: {
      kind: "prompt_queue",
      queue,
    },
  });
}

function repairProviderToolCalls(sessionId: string, context: HelmHandlerContext) {
  const summary = resolveSessionSummary(sessionId, context);
  const providerId = summary?.agentId;
  if (!providerId || !context.sessionArtifactStore?.replaceToolCalls) {
    return;
  }

  const artifacts = context.sessionArtifactStore.get(sessionId);
  const repairedToolCalls = artifacts.toolCalls.map((toolCall: AgentToolCall) =>
    repairCompletedThinkingToolCall(
      summary,
      repairLegacySubagentToolCall(
        repairProviderToolCall(sessionId, providerId, toolCall),
      ),
    ),
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
  const persistedEntries = projected ?? page.entries;
  if (projected) {
    context.sessionTimelineStore.replace?.(params.sessionId, projected);
  }
  return {
    ...page,
    entries: injectTranscriptBoundaryEntries(params, visibleMessages, persistedEntries),
  };
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
  const shouldResolveCompactionBootstrap = !options.before &&
    visibleMessages.some((message) => looksLikeContinuationSummary(message.text));
  let listedTimeline: SessionTimelineEntry[] | undefined;
  const getListedTimeline = () =>
    listedTimeline ??= splitSessionTimelineAssistantEntriesAtBoundaries(
      context.sessionTimelineStore!.list?.(params.sessionId) ?? [],
    );
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
    return pageTimelineEntries(stored, visibleMessages, options);
  }
  if (normalizedPersistedPage && isAuthoritativeTimelinePage(normalizedPersistedPage, options.before)) {
    if (
      options.before ||
      !isTimelineMissingVisibleHistoryAnchors(normalizedPersistedPage.entries, visibleMessages)
    ) {
      return normalizedPersistedPage;
    }
  }
  if (persistedPage && shouldResolveCompactionBootstrap) {
    const compactionBootstrapPage = resolveCompactionBootstrapTimelinePage(
      getListedTimeline(),
      visibleMessages,
      options,
    );
    if (compactionBootstrapPage) {
      return compactionBootstrapPage;
    }
  }

  const existing = persistedPage
    ? []
    : getListedTimeline();
  const repairedExistingTimeline = !options.before && existing.length
    ? repairTimelineFromSessionUpdates(params.sessionId, context, existing)
    : undefined;
  if (repairedExistingTimeline) {
    const stored = context.sessionTimelineStore!.replace(params.sessionId, repairedExistingTimeline);
    return pageTimelineEntries(stored, visibleMessages, options);
  }
  if (
    existing.length &&
    (
      options.before ||
      !isTimelineMissingVisibleHistoryAnchors(existing, visibleMessages)
    )
  ) {
    return pageTimelineEntries(existing, visibleMessages, options);
  }

  const rebuilt = rebuildSessionTimelineFromLegacy(params.sessionId, context);
  if (!rebuilt.length) {
    return persistedPage ?? { entries: [], hasMore: false };
  }

  const stored = context.sessionTimelineStore!.replace(params.sessionId, rebuilt);
  return pageTimelineEntries(stored, visibleMessages, options);
}

function pageTimelineEntries(
  entries: SessionTimelineEntry[],
  visibleMessages: AgentMessage[],
  options: { entryLimit?: number; limit?: number; before?: string; window?: "entry" | "message" },
) {
  return resolveCompactionBootstrapTimelinePage(entries, visibleMessages, options) ??
    pageSessionTimeline(entries, options);
}

function resolveCompactionBootstrapTimelinePage(
  entries: SessionTimelineEntry[],
  visibleMessages: AgentMessage[],
  options: { entryLimit?: number; before?: string },
) {
  if (options.before) {
    return undefined;
  }
  const continuationBoundary = resolveContinuationSummaryBoundary(visibleMessages);
  if (!continuationBoundary) {
    return undefined;
  }
  const resumedAnchorIndex = entries.findIndex((entry) =>
    timelineEntryRepresentsMessage(entry, continuationBoundary.resumedMessage)
  );
  if (resumedAnchorIndex === -1) {
    return undefined;
  }
  const endIndex = findLastTimelineMessageAnchorIndex(
    entries,
    visibleMessages,
    resumedAnchorIndex,
  );
  if (endIndex === -1) {
    return undefined;
  }
  const startIndex = findPreviousTimelineMessageAnchorIndex(
    entries,
    resumedAnchorIndex,
    continuationBoundary.prefaceMessages,
  );
  if (startIndex === -1) {
    return undefined;
  }
  const page = buildCompactionBootstrapPage(entries, {
    startIndex,
    resumedAnchorIndex,
    endIndex,
    entryLimit: Math.max(options.entryLimit ?? TIMELINE_ENTRY_PAGE_LIMIT, 1),
  });
  if (!page) {
    return undefined;
  }
  return {
    entries: page.entries,
    nextCursor: page.hasMore
      ? encodeTimelineOrderCursor(page.cursorPosition, entries[page.cursorPosition]?.id)
      : undefined,
    hasMore: page.hasMore,
  };
}

function findLastTimelineMessageAnchorIndex(
  entries: SessionTimelineEntry[],
  visibleMessages: AgentMessage[],
  minimumIndex: number,
) {
  for (let messageIndex = visibleMessages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = visibleMessages[messageIndex];
    if (!message) {
      continue;
    }
    for (let entryIndex = entries.length - 1; entryIndex >= minimumIndex; entryIndex -= 1) {
      if (timelineEntryRepresentsMessage(entries[entryIndex]!, message)) {
        return entryIndex;
      }
    }
  }
  return -1;
}

function buildCompactionBootstrapPage(
  entries: SessionTimelineEntry[],
  options: {
    startIndex: number;
    resumedAnchorIndex: number;
    endIndex: number;
    entryLimit: number;
  },
) {
  const candidateEntries = entries.slice(options.startIndex, options.endIndex + 1);
  if (candidateEntries.length === 0) {
    return undefined;
  }
  if (candidateEntries.length <= options.entryLimit) {
    return {
      entries: candidateEntries,
      cursorPosition: options.startIndex,
      hasMore: options.startIndex > 0,
    };
  }

  const preservedEntries = options.startIndex === options.resumedAnchorIndex
    ? [entries[options.startIndex]!]
    : [entries[options.startIndex]!, entries[options.resumedAnchorIndex]!];
  const tailBudget = Math.max(options.entryLimit - preservedEntries.length, 0);
  const tailStartIndex = tailBudget > 0
    ? Math.max(options.resumedAnchorIndex + 1, options.endIndex + 1 - tailBudget)
    : options.endIndex + 1;
  const tailEntries = tailStartIndex <= options.endIndex
    ? entries.slice(tailStartIndex, options.endIndex + 1)
    : [];

  return {
    // Preserve the compaction edge, then keep the latest contiguous tail within the entry cap.
    entries: [...preservedEntries, ...tailEntries],
    cursorPosition: tailStartIndex <= options.endIndex ? tailStartIndex : options.resumedAnchorIndex,
    hasMore: (tailStartIndex <= options.endIndex ? tailStartIndex : options.resumedAnchorIndex) > 0,
  };
}

function resolveContinuationSummaryBoundary(messages: AgentMessage[]) {
  const markerIndex = messages.findIndex((message) => looksLikeContinuationSummary(message.text));
  if (markerIndex === -1) {
    return undefined;
  }
  const prefaceMessages: AgentMessage[] = [];
  for (let index = markerIndex; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (index > markerIndex && typeof message.timelineSequence === "number") {
      return {
        summaryMessage: messages[markerIndex]!,
        resumedMessage: message,
        prefaceMessages,
      };
    }
    prefaceMessages.push(message);
  }
  return undefined;
}

function injectTranscriptBoundaryEntries(
  params: { sessionId: string; before?: string; timelineBefore?: string },
  visibleMessages: AgentMessage[],
  entries: SessionTimelineEntry[],
) {
  if (params.before || params.timelineBefore) {
    return entries;
  }
  const boundary = resolveContinuationSummaryBoundary(visibleMessages);
  if (!boundary) {
    return entries;
  }
  if (!entries.some((entry) => timelineEntryRepresentsMessage(entry, boundary.resumedMessage))) {
    return entries;
  }
  return injectTranscriptBoundaryEvents(
    entries,
    {
      kind: "context_compaction",
      id: `compaction:${params.sessionId}:${boundary.summaryMessage.id}`,
      summaryMessageId: boundary.summaryMessage.id,
      summaryText: boundary.summaryMessage.text,
      timestamp: boundary.summaryMessage.timestamp,
      updatedAt: boundary.summaryMessage.timestamp,
      replayCompleteness: "compacted",
    },
    {
      kind: "session_resumed",
      id: `resume:${params.sessionId}:${boundary.resumedMessage.id}`,
      restoreMethod: "session/load",
      timestamp: boundary.resumedMessage.timestamp,
      updatedAt: boundary.resumedMessage.timestamp,
      replayCompleteness: "compacted",
    },
  );
}

function findPreviousTimelineMessageAnchorIndex(
  entries: SessionTimelineEntry[],
  resumedAnchorIndex: number,
  prefaceMessages: AgentMessage[],
) {
  for (let index = resumedAnchorIndex - 1; index >= 0; index -= 1) {
    if (
      isTimelineMessageAnchor(entries[index]) &&
      !prefaceMessages.some((message) => timelineEntryRepresentsMessage(entries[index]!, message))
    ) {
      return index;
    }
  }
  return -1;
}

function timelineEntryRepresentsMessage(entry: SessionTimelineEntry, message: AgentMessage) {
  if (message.role === "assistant") {
    return entry.kind === "assistant_message" && assistantEntryRepresentsMessage(entry, message);
  }
  const expectedKind = message.role === "user" ? "user_message" : "system_message";
  if (entry.kind !== expectedKind) {
    return false;
  }
  if (entry.message.id === message.id || entry.id === message.id) {
    return true;
  }
  if (entry.message.text.trim() !== message.text.trim()) {
    return false;
  }
  const entrySequence = entry.message.timelineSequence ?? entry.timelineSequence;
  if (typeof entrySequence === "number" && typeof message.timelineSequence === "number") {
    return entrySequence === message.timelineSequence;
  }
  return entry.message.timestamp === message.timestamp || entry.timestamp === message.timestamp;
}

function assistantEntryRepresentsMessage(
  entry: Extract<SessionTimelineEntry, { kind: "assistant_message" }>,
  message: AgentMessage,
) {
  if (entry.id === message.id) {
    return true;
  }
  let cumulativeText = "";
  for (const chunk of entry.chunks) {
    if (chunk.kind !== "content") {
      continue;
    }
    cumulativeText += chunk.text;
    if (representsAssistantMessage({
      text: cumulativeText.trim(),
      timestamp: chunk.timestamp,
      timelineSequence: chunk.timelineSequence,
    }, message)) {
      return true;
    }
  }
  return false;
}

function encodeTimelineOrderCursor(position: number, id: string | undefined) {
  return id ? `${TIMELINE_ORDER_CURSOR_PREFIX}\t${position}\t${id}` : undefined;
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

function repairLegacySubagentToolCall(toolCall: AgentToolCall) {
  if (toolCall.kind === "subagent") {
    return toolCall;
  }
  if (!looksLikeLegacySubagentToolCall(toolCall)) {
    return toolCall;
  }
  return {
    ...toolCall,
    kind: "subagent" as const,
  };
}

function looksLikeLegacySubagentToolCall(toolCall: AgentToolCall) {
  if (!/^spawn_agents_/u.test(toolCall.title.trim())) {
    return false;
  }
  const input = parseJsonRecord(toolCall.input);
  return Boolean(input && typeof input.path === "string" && input.path.trim());
}

function parseJsonRecord(input: string | undefined) {
  if (!input) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
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
  return entries.some((entry) => isTimelineMessageAnchor(entry));
}

function isTimelineMessageAnchor(entry: SessionTimelineEntry | undefined) {
  if (!entry) {
    return false;
  }
  return (
    entry.kind === "user_message" ||
    entry.kind === "system_message" ||
    (entry.kind === "assistant_message" && entry.chunks.some((chunk) => chunk.kind === "content" && chunk.text.trim()))
  );
}

function resolveTranscriptStatus(
  visibleMessages: AgentMessage[],
  before: string | undefined,
  timelineBefore: string | undefined,
): SessionTranscriptStatus {
  const hasCompaction = visibleMessages.some((message) => looksLikeContinuationSummary(message.text));

  if (!hasCompaction || before || timelineBefore) {
    return {
      source: "local",
      replayCompleteness: "none",
      integrity: "complete",
      runtimeRestoreState: "history-only",
    };
  }

  return {
    source: "local",
    replayCompleteness: "compacted",
    integrity: "local-prefix-preserved",
    runtimeRestoreState: "history-only",
  };
}
