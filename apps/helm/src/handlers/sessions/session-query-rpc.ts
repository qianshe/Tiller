import { broadcastSessionUpdate } from "../../rpc/notifications";
import type { FileDiffSummary, SessionResumeInfo } from "@tiller/shared";
import { materializeDiffPayloads } from "../../runtime/session/diff-payload";
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

function resolveLegacyDisplayOnlyResume(
  sessionId: string,
  context: Pick<HelmHandlerContext, "sessionLegacyEvidenceStore">,
  checkedAt = new Date().toISOString(),
): SessionResumeInfo | undefined {
  if (!context.sessionLegacyEvidenceStore?.describe(sessionId).available) {
    return undefined;
  }
  return {
    mode: "none",
    state: "history-only",
    reason: "Legacy session evidence is display-only.",
    checkedAt,
    restoreMethod: "ui-history",
  };
}

function formatLogFields(fields: Record<string, unknown>) {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

export function listSessions(params: { limit?: number; before?: string }, context: HelmHandlerContext) {
  const sessions = context.sessionStore.list();
  const page = pageSessionSummaries(sessions, {
    limit: params.limit,
    before: params.before,
  });
  logSessionDebug(context, "session.list", {
    count: sessions.length,
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
  notifyCurrentSocketCanonicalSnapshot(params.sessionId, context);
  return {
    ok: true,
    message: `Subscribed to session ${params.sessionId}.`,
  };
}

function notifyCurrentSocketCanonicalSnapshot(
  sessionId: string,
  context: HelmHandlerContext,
) {
  const socketRecord = findCurrentSocket(context);
  if (!socketRecord?.socket) return;
  const page = context.sessionTimelineStore?.listPage?.(sessionId, {
    limit: 200,
    window: "message",
  });
  if (page) {
    const lastSequence = page.entries.reduce(
      (maximum: number, entry: { sequence?: number }) =>
        Math.max(maximum, entry.sequence ?? 0),
      0,
    );
    context.notify(socketRecord.socket, "session/update", {
      sessionId,
      update: {
        kind: "timeline_batch",
        batch: {
          replace: true,
          deliverySequence: 0,
          lastSequence,
          entries: page.entries,
        },
      },
    });
  }
  const liveState = context.readSessionLiveState?.(sessionId);
  if (liveState) {
    context.notify(socketRecord.socket, "session/update", {
      sessionId,
      update: { kind: "live_state", snapshot: liveState },
    });
  }
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
  const persistedArtifacts = context.sessionArtifactStore.getPage(params.sessionId, {
    limit: params.limit,
    before: params.before,
  });
  const legacyEvidence = context.sessionLegacyEvidenceStore?.describe(params.sessionId);
  const isLegacyDisplayOnly = Boolean(legacyEvidence?.available);
  const hydratedDiffs = isLegacyDisplayOnly
    ? persistedArtifacts.diffs
    : await context.hydrateDiffsFromWorktreeGit(params.sessionId, persistedArtifacts.diffs);
  const diffs = !isLegacyDisplayOnly && context.sessionDiffBodyStore
    ? materializeDiffPayloads(params.sessionId, hydratedDiffs, context.sessionDiffBodyStore)
    : hydratedDiffs;
  const historicalDiffIncomplete = isLegacyDisplayOnly && diffs.some(
    (diff: FileDiffSummary) => Boolean(diff.path) && !diff.patch?.trim(),
  );
  return {
    sessionId: params.sessionId,
    outputs: persistedArtifacts.outputs,
    diffs,
    toolCalls: persistedArtifacts.toolCalls,
    nextCursor: persistedArtifacts.nextCursor,
    hasMore: persistedArtifacts.hasMore,
    ...(historicalDiffIncomplete ? { historicalDiffIncomplete: true } : {}),
  };
}

export async function listTimeline(
  params: { sessionId: string; limit?: number; before?: string },
  context: HelmHandlerContext,
) {
  const page = context.sessionTimelineStore.listPage(params.sessionId, {
    limit: params.limit,
    before: params.before,
    window: "turn",
  });
  const liveState = context.readSessionLiveState?.(params.sessionId);
  const storedPlan = context.sessionPlanStore?.get?.(params.sessionId);
  const legacyEvidence = context.sessionLegacyEvidenceStore?.describe(params.sessionId);
  const effectiveLiveState = storedPlan && !liveState?.plan
    ? { ...(liveState ?? {}), plan: storedPlan }
    : liveState;
  return {
    sessionId: params.sessionId,
    before: params.before,
    entries: page.entries,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    ...(legacyEvidence?.available
      ? { legacyEvidence }
      : {}),
    ...(effectiveLiveState ? { liveState: effectiveLiveState } : {}),
  };
}

export function listLegacyEvidence(
  params: { sessionId: string; source: import("@tiller/shared").LegacyEvidenceSource; limit?: number; after?: string },
  context: HelmHandlerContext,
) {
  if (!context.sessionLegacyEvidenceStore) {
    return {
      sessionId: params.sessionId,
      source: params.source,
      items: [],
      issues: [],
      hasMore: false,
    };
  }
  return context.sessionLegacyEvidenceStore.listPage(params.sessionId, params);
}

export function checkResume(params: { sessionId: string }, context: HelmHandlerContext) {
  logSessionDebug(context, "session.resume.check", { sessionId: params.sessionId });
  const summary = context.sessionStore.get(params.sessionId);
  if (!summary) {
    throw new Error("Session not found");
  }
  const hydrated = context.hydrateSessionSummary(summary);
  const legacyDisplayOnly = resolveLegacyDisplayOnlyResume(
    params.sessionId,
    context,
    hydrated.resume?.checkedAt,
  );
  return {
    sessionId: params.sessionId,
    resume: legacyDisplayOnly ??
      hydrated.resume ??
      context.buildResumeInfo(
        hydrated,
        context.resolveProviderById(hydrated.agentId, context.getAgents()),
      ),
  };
}

export async function resumeSession(params: { sessionId: string }, context: HelmHandlerContext) {
  const legacyDisplayOnly = resolveLegacyDisplayOnlyResume(params.sessionId, context);
  if (legacyDisplayOnly) {
    logSessionInfo(context, "session.resume.skipped_legacy_evidence", {
      sessionId: params.sessionId,
    });
    return {
      sessionId: params.sessionId,
      ok: false,
      resume: legacyDisplayOnly,
      message: "Legacy session evidence is display-only and cannot be resumed.",
    };
  }
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
  }
  return {
    sessionId: params.sessionId,
    ok: result.ok,
    resume: result.resume,
    message: result.message,
  };
}

function findCurrentSocket(
  context: Pick<HelmHandlerContext, "authenticatedSockets" | "socketId">,
) {
  return context.authenticatedSockets
    ?.listAll?.()
    ?.find((record: { socketId: string }) => record.socketId === context.socketId);
}
