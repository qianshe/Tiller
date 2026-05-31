import { mapSessionUpdateNotification } from "@tiller/acp-runtime";
import { pageSessionTimeline } from "@tiller/persistence";
import { buildSessionTimelineFromLegacy, sortSessionTimelineEntries } from "@tiller/shared";
import type { AgentToolCall, SessionSummary, SessionTimelineEntry } from "@tiller/shared";
import type { HelmHandlerContext } from "../context";
import { pageSessionSummaries } from "./session-list-page";

const TIMELINE_ENTRY_PAGE_LIMIT = 96;

export function listSessions(params: { limit?: number; before?: string }, context: HelmHandlerContext) {
  const normalizedSessions = context.sessionStore.list().map(context.migrateStoredSessionSummary);
  const page = pageSessionSummaries(normalizedSessions, {
    limit: params.limit,
    before: params.before,
  });
  context.logInfo(
    `[tiller] session.list count=${normalizedSessions.length} page=${page.sessions.length} hasMore=${page.hasMore}`,
  );
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
  const page = context.sessionMessageStore.listPage(params.sessionId, {
    limit: params.limit,
    before: params.before,
  });
  const timelinePage = listSessionTimelinePage(params, context);
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
  return {
    sessionId: params.sessionId,
    outputs: artifacts.outputs,
    diffs,
    toolCalls: artifacts.toolCalls,
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
  context.logInfo(`[tiller] 阶段=恢复检查 session=${params.sessionId}`);
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
  context.logInfo(`[tiller] 阶段=恢复请求开始 session=${params.sessionId}`);
  const result = await context.startSessionResume(params.sessionId);
  context.logInfo(
    `[tiller] 阶段=恢复请求完成 session=${params.sessionId} ok=${result.ok} method=${result.resume.restoreMethod ?? "none"} message=${result.message}`,
  );
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
  if (!providerId) {
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
) {
  if (!context.sessionTimelineStore) {
    return { entries: [], hasMore: false };
  }
  const existing = context.sessionTimelineStore.list(params.sessionId);
  const repaired = repairSessionTimelineFromLegacy(params.sessionId, existing, context);
  return pageSessionTimeline(repaired, {
    entryLimit: TIMELINE_ENTRY_PAGE_LIMIT,
    limit: params.limit,
    before: params.timelineBefore ?? params.before,
    window: "message",
  });
}

function repairSessionTimelineFromLegacy(
  sessionId: string,
  existing: SessionTimelineEntry[],
  context: HelmHandlerContext,
) {
  const messages = context.sessionMessageStore.list?.(sessionId) ?? [];
  const artifacts = context.sessionArtifactStore?.get?.(sessionId) ?? {
    outputs: [],
    diffs: [],
    toolCalls: [],
  };
  const rebuilt = buildSessionTimelineFromLegacy({
    messages,
    outputs: artifacts.outputs,
    toolCalls: artifacts.toolCalls,
  });
  if (!rebuilt.length) {
    return existing;
  }

  const repaired = mergeRebuiltTimeline(existing, rebuilt);
  if (timelineSignature(existing) === timelineSignature(repaired)) {
    return existing;
  }
  return context.sessionTimelineStore.replace(sessionId, repaired);
}

function mergeRebuiltTimeline(
  existing: SessionTimelineEntry[],
  rebuilt: SessionTimelineEntry[],
) {
  const rebuiltIds = new Set(rebuilt.map((entry) => entry.id));
  if (!existing.length || !hasTimelineMessageAnchor(existing)) {
    return sortSessionTimelineEntries([
      ...rebuilt,
      ...existing.filter((entry) => !rebuiltIds.has(entry.id)),
    ]);
  }

  const rebuiltById = new Map(rebuilt.map((entry) => [entry.id, entry]));
  const merged = existing.map((entry) => rebuiltById.get(entry.id) ?? entry);
  const mergedIds = new Set(merged.map((entry) => entry.id));
  const missing = rebuilt.filter((entry) => !mergedIds.has(entry.id));
  if (!missing.length) {
    return sortSessionTimelineEntries(merged);
  }

  return sortSessionTimelineEntries(insertMissingTimelineEntries(merged, missing, rebuilt));
}

function insertMissingTimelineEntries(
  existing: SessionTimelineEntry[],
  missing: SessionTimelineEntry[],
  rebuilt: SessionTimelineEntry[],
) {
  const result = [...existing];
  const presentIds = new Set(result.map((entry) => entry.id));
  missing.forEach((entry) => {
    const insertAt = resolveMissingTimelineInsertIndex(result, rebuilt, entry.id, presentIds);
    result.splice(insertAt, 0, entry);
    presentIds.add(entry.id);
  });
  return result;
}

function resolveMissingTimelineInsertIndex(
  current: SessionTimelineEntry[],
  rebuilt: SessionTimelineEntry[],
  entryId: string,
  presentIds: ReadonlySet<string>,
) {
  const rebuiltIndex = rebuilt.findIndex((entry) => entry.id === entryId);
  for (let index = rebuiltIndex - 1; index >= 0; index -= 1) {
    const previousId = rebuilt[index]?.id;
    if (!previousId || !presentIds.has(previousId)) {
      continue;
    }
    const currentIndex = current.findIndex((entry) => entry.id === previousId);
    return currentIndex === -1 ? current.length : currentIndex + 1;
  }
  for (let index = rebuiltIndex + 1; index < rebuilt.length; index += 1) {
    const nextId = rebuilt[index]?.id;
    if (!nextId || !presentIds.has(nextId)) {
      continue;
    }
    const currentIndex = current.findIndex((entry) => entry.id === nextId);
    return currentIndex === -1 ? current.length : currentIndex;
  }
  return current.length;
}

function timelineSignature(entries: SessionTimelineEntry[]) {
  return entries.map(timelineEntrySignature).join("|");
}

function timelineEntrySignature(entry: SessionTimelineEntry) {
  if (entry.kind === "assistant_message") {
    return [
      entry.kind,
      entry.id,
      entry.chunks.map((chunk) => [
        chunk.kind,
        chunk.id,
        "text" in chunk ? chunk.text : "",
        "status" in chunk ? chunk.status : "",
        "title" in chunk ? chunk.title : "",
        chunk.timelineSequence ?? "",
        "streaming" in chunk ? String(Boolean(chunk.streaming)) : "",
      ].join(":")),
    ].join(":");
  }
  if (entry.kind === "tool_call") {
    return [
      entry.kind,
      entry.id,
      entry.toolCall.kind,
      entry.toolCall.title,
      entry.toolCall.status,
      entry.toolCall.timelineSequence ?? "",
      entry.toolCall.timestamp,
      entry.toolCall.updatedAt,
    ].join(":");
  }
  return [
    entry.kind,
    entry.id,
    entry.message.id,
    entry.message.role,
    entry.message.text,
    entry.message.timelineSequence ?? "",
    entry.message.timestamp,
  ].join(":");
}

function resolveSessionSummary(sessionId: string, context: HelmHandlerContext): SessionSummary | undefined {
  return (
    context.sessions.get(sessionId)?.summary ??
    context.sessionStore.list().find((item: SessionSummary) => item.id === sessionId)
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
  return mapped?.event.type === "tool-call" ? mapped.event.toolCall : toolCall;
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
