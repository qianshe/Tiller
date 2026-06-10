import type { AgentMessage, AgentPlan, AgentToolCall, SessionSummary, SessionTimelineEntry } from "@tiller/shared";

type HistoryState = {
  hasMore: boolean;
  loading: boolean;
};

export type WorkspaceSessionStreamHydrationPlan = {
  messageSessionIds: string[];
  activitySessionIds: string[];
  planActivitySessionIds: string[];
  resumeCheckSessionIds: string[];
};

export type WorkspaceSessionStreamHydrationInput = {
  sessionIds: string[];
  sessionById: ReadonlyMap<string, SessionSummary>;
  messageHistoryState: Record<string, HistoryState | undefined>;
  activityHistoryState: Record<string, HistoryState | undefined>;
  messagesBySession?: Record<string, Pick<AgentMessage, "id" | "role">[] | undefined>;
  sessionTimelineBySession?: Record<string, SessionTimelineEntry[] | undefined>;
  outputsBySession?: Record<string, unknown[] | undefined>;
  toolCallsBySession?: Record<string, AgentToolCall[] | undefined>;
  sessionPlansBySession?: Record<string, AgentPlan | undefined>;
  checkedResumeSessionIds: ReadonlySet<string>;
  checkedPlanSessionIds?: ReadonlySet<string>;
};

export function buildSessionStreamHydrationPlan({
  sessionIds,
  sessionById,
  messageHistoryState,
  activityHistoryState,
  messagesBySession,
  sessionTimelineBySession,
  outputsBySession,
  toolCallsBySession,
  sessionPlansBySession,
  checkedResumeSessionIds,
  checkedPlanSessionIds,
}: WorkspaceSessionStreamHydrationInput): WorkspaceSessionStreamHydrationPlan {
  const uniqueSessionIds = [...new Set(sessionIds)];
  const activitySessionIds: string[] = [];
  const planActivitySessionIds: string[] = [];

  for (const sessionId of uniqueSessionIds) {
    const toolCalls = toolCallsBySession?.[sessionId] ?? [];
    const hasCachedActivity = Boolean(
      outputsBySession?.[sessionId]?.length || toolCalls.length,
    );
    const needsCachedPlan = needsPlanHydration({
      sessionId,
      session: sessionById.get(sessionId),
      messageHistoryState,
      messagesBySession,
      sessionTimelineBySession,
      sessionPlansBySession,
      toolCalls,
    });
    const activityState = activityHistoryState[sessionId];
    if (needsCachedPlan) {
      if (!checkedPlanSessionIds?.has(sessionId)) {
        activitySessionIds.push(sessionId);
        planActivitySessionIds.push(sessionId);
      }
      continue;
    }
    if (!activityState && !hasCachedActivity) {
      activitySessionIds.push(sessionId);
    }
  }

  return {
    messageSessionIds: uniqueSessionIds.filter((sessionId) => (
      !messageHistoryState[sessionId] ||
      hasIncompleteCachedMessageHistory({
        cachedMessages: messagesBySession?.[sessionId],
        hasTimelineCache: hasNonEmptySessionTimelineCache(sessionTimelineBySession, sessionId),
        historyState: messageHistoryState[sessionId],
        session: sessionById.get(sessionId),
      })
    )),
    activitySessionIds,
    planActivitySessionIds,
    resumeCheckSessionIds: uniqueSessionIds.filter((sessionId) => {
      const session = sessionById.get(sessionId);
      return Boolean(
        session &&
          session.status !== "running" &&
          session.resume?.state !== "resume-unavailable" &&
          !checkedResumeSessionIds.has(sessionId),
      );
    }),
  };
}

function isPlanCapableToolCall(toolCall: AgentToolCall) {
  if (toolCall.kind === "todo") {
    return true;
  }
  const title = (toolCall.title ?? "").trim().toLowerCase().replace(/[^a-z0-9]/gu, "");
  return title === "taskcreate" || title === "taskupdate" || title === "todowrite";
}

function needsPlanHydration({
  sessionId,
  session,
  messageHistoryState,
  messagesBySession,
  sessionTimelineBySession,
  sessionPlansBySession,
  toolCalls,
}: {
  sessionId: string;
  session: SessionSummary | undefined;
  messageHistoryState: Record<string, HistoryState | undefined>;
  messagesBySession: Record<string, Pick<AgentMessage, "id" | "role">[] | undefined> | undefined;
  sessionTimelineBySession: Record<string, SessionTimelineEntry[] | undefined> | undefined;
  sessionPlansBySession: Record<string, AgentPlan | undefined> | undefined;
  toolCalls: AgentToolCall[];
}) {
  if (!sessionPlansBySession || sessionPlansBySession[sessionId]) {
    return false;
  }
  return toolCalls.some(isPlanCapableToolCall) ||
    hasOwnSessionCache(sessionTimelineBySession, sessionId) ||
    Boolean(messagesBySession?.[sessionId]?.length) ||
    Boolean(messageHistoryState[sessionId]) ||
    Boolean(session?.messageCount);
}

function hasIncompleteCachedMessageHistory({
  cachedMessages,
  hasTimelineCache,
  historyState,
  session,
}: {
  cachedMessages: Pick<AgentMessage, "id" | "role">[] | undefined;
  hasTimelineCache: boolean;
  historyState: HistoryState | undefined;
  session: SessionSummary | undefined;
}) {
  if (!session || !historyState || historyState.loading || historyState.hasMore) {
    return false;
  }
  const cachedUserCount = cachedMessages?.filter((message) => message.role === "user").length ?? 0;
  return session.messageCount > cachedUserCount ||
    (!hasTimelineCache && Boolean(cachedMessages?.length || session.messageCount > 0));
}

function hasOwnSessionCache<T>(
  cache: Record<string, T | undefined> | undefined,
  sessionId: string,
) {
  return Boolean(cache && Object.prototype.hasOwnProperty.call(cache, sessionId));
}

function hasNonEmptySessionTimelineCache(
  cache: Record<string, SessionTimelineEntry[] | undefined> | undefined,
  sessionId: string,
) {
  return Boolean(cache?.[sessionId]?.length);
}
