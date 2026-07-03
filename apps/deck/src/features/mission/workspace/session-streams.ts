import type { AgentMessage, SessionSummary, SessionTimelineEntry } from "@tiller/shared";

type HistoryState = {
  hasMore: boolean;
  loading: boolean;
};

export type WorkspaceSessionStreamHydrationPlan = {
  messageSessionIds: string[];
  resumeCheckSessionIds: string[];
};

export type WorkspaceSessionStreamHydrationInput = {
  sessionIds: string[];
  sessionById: ReadonlyMap<string, SessionSummary>;
  messageHistoryState: Record<string, HistoryState | undefined>;
  messagesBySession?: Record<string, Pick<AgentMessage, "id" | "role">[] | undefined>;
  sessionTimelineBySession?: Record<string, SessionTimelineEntry[] | undefined>;
  checkedResumeSessionIds: ReadonlySet<string>;
};

export function buildSessionStreamHydrationPlan({
  sessionIds,
  sessionById,
  messageHistoryState,
  messagesBySession,
  sessionTimelineBySession,
  checkedResumeSessionIds,
}: WorkspaceSessionStreamHydrationInput): WorkspaceSessionStreamHydrationPlan {
  const uniqueSessionIds = [...new Set(sessionIds)];

  return {
    messageSessionIds: uniqueSessionIds.filter((sessionId) => (
      !messageHistoryState[sessionId] ||
      hasIncompleteCachedMessageHistory({
        cachedMessages: messagesBySession?.[sessionId],
        // `sessionTimelineBySession[sessionId] = []` means this runtime already asked
        // Helm for timeline data and got an explicit empty result. Retrying forever on
        // every render turns that steady state into an idle fetch loop.
        hasTimelineCache: hasOwnSessionCache(sessionTimelineBySession, sessionId),
        historyState: messageHistoryState[sessionId],
        session: sessionById.get(sessionId),
      })
    )),
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
  if (hasTimelineCache) {
    return false;
  }
  return Boolean(cachedMessages?.length || session.messageCount > 0);
}

function hasOwnSessionCache<T>(
  cache: Record<string, T | undefined> | undefined,
  sessionId: string,
) {
  return Boolean(cache && Object.prototype.hasOwnProperty.call(cache, sessionId));
}
