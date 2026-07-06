import { pageSessionArtifacts } from "@tiller/persistence";
import type {
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionSummary,
  SessionTimelineEntry,
} from "@tiller/shared";
import { broadcastSessionUpdate } from "../../rpc/notifications";
import { projectLegacySessionHistoryFromTimeline } from "../../runtime/session-timeline/legacy-projection.js";
import {
  MIGRATE_LEGACY_RESUMED_TO_COMPACTION_ONLY,
  repairCompactionBootstrapTimeline,
} from "../../runtime/session-timeline/compaction-bootstrap";
import type { HelmHandlerContext } from "../context";
import { pageSessionSummaries } from "./session-list-page";

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

export async function getArtifacts(
  params: { sessionId: string; limit?: number; before?: string },
  context: HelmHandlerContext,
) {
  await context.refreshAuthoritativeSessionHistory(params.sessionId);
  const persistedArtifacts = context.sessionArtifactStore.getPage(params.sessionId, {
    limit: params.limit,
    before: params.before,
  });
  const artifacts = resolveArtifactHistoryPage(params.sessionId, persistedArtifacts, params, context);
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

export async function listTimeline(
  params: { sessionId: string; limit?: number; before?: string },
  context: HelmHandlerContext,
) {
  await context.refreshAuthoritativeSessionHistory(params.sessionId);
  migrateLegacyCompactionTimelineIfNeeded(params.sessionId, context);
  const page = context.sessionTimelineStore.listPage(params.sessionId, {
    limit: params.limit,
    before: params.before,
    window: "message",
  });
  const liveState = context.readSessionLiveState?.(params.sessionId);
  return {
    sessionId: params.sessionId,
    before: params.before,
    entries: page.entries,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    ...(liveState ? { liveState } : {}),
  };
}

function migrateLegacyCompactionTimelineIfNeeded(
  sessionId: string,
  context: HelmHandlerContext,
) {
  if (
    !MIGRATE_LEGACY_RESUMED_TO_COMPACTION_ONLY ||
    !context.sessionTimelineStore.list ||
    !context.sessionTimelineStore.replace
  ) {
    return null;
  }
  const timeline: SessionTimelineEntry[] =
    context.sessionTimelineStore.list(sessionId) ?? [];
  if (!timeline.length) {
    return null;
  }
  const repairedTimeline = repairCompactionBootstrapTimeline({
    sessionId,
    timeline,
    messages: context.sessionMessageStore?.listPage?.(sessionId, { limit: 200 })?.messages ?? [],
    providerId: resolveSessionProviderId(sessionId, context),
  });
  if (!repairedTimeline) {
    return null;
  }
  context.sessionTimelineStore.replace(sessionId, repairedTimeline.entries);
  logSessionDebug(context, "session.timeline.compaction_repaired", {
    sessionId,
    synthesizedBoundary: repairedTimeline.synthesizedBoundary,
  });
  return repairedTimeline.entries;
}

function resolveSessionProviderId(sessionId: string, context: HelmHandlerContext) {
  return context.sessions?.get?.(sessionId)?.agent?.id ??
    context.sessions?.get?.(sessionId)?.summary?.agentId ??
    context.sessionStore?.list?.().find((item: SessionSummary) => item.id === sessionId)?.agentId;
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
    if (result.session) {
      broadcastSessionUpdate(context, params.sessionId, {
        kind: "session_updated",
        session: result.session,
      });
    }
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

function resolveArtifactHistoryPage(
  sessionId: string,
  artifacts: {
    outputs: CommandChunk[];
    diffs: FileDiffSummary[];
    toolCalls: AgentToolCall[];
    nextCursor?: string;
    hasMore: boolean;
  },
  params: { limit?: number; before?: string },
  context: HelmHandlerContext,
) {
  if (artifacts.outputs.length || artifacts.toolCalls.length) {
    return artifacts;
  }
  const timeline = context.sessionTimelineStore?.list?.(sessionId) ?? [];
  if (!timeline.length) {
    return artifacts;
  }
  const projected = projectLegacySessionHistoryFromTimeline(timeline);
  return pageSessionArtifacts({
    outputs: projected.outputs,
    diffs: artifacts.diffs,
    toolCalls: projected.toolCalls,
  }, {
    limit: params.limit,
    before: params.before,
  });
}
