import type { AgentMessage, AgentPlan, AgentToolCall, SessionSummary, SessionTimelineEntry } from "@tiller/shared";

type HistoryState = {
  hasMore: boolean;
  loading: boolean;
};

export type WorkspaceSessionStreamHydrationPlan = {
  messageSessionIds: string[];
  activitySessionIds: string[];
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
}: WorkspaceSessionStreamHydrationInput): WorkspaceSessionStreamHydrationPlan {
  const uniqueSessionIds = [...new Set(sessionIds)];
  return {
    messageSessionIds: uniqueSessionIds.filter((sessionId) => (
      !messageHistoryState[sessionId] ||
      hasIncompleteCachedMessageHistory({
        cachedMessages: messagesBySession?.[sessionId],
        historyState: messageHistoryState[sessionId],
        session: sessionById.get(sessionId),
      })
    )),
    activitySessionIds: uniqueSessionIds.filter((sessionId) => {
      const toolCalls = toolCallsBySession?.[sessionId] ?? [];
      const hasCachedActivity = Boolean(
        outputsBySession?.[sessionId]?.length || toolCalls.length,
      );
      const needsCachedPlan = Boolean(
        !sessionPlansBySession?.[sessionId] &&
          toolCalls.some(isPlanCapableToolCall),
      );
      return !activityHistoryState[sessionId] &&
        (!hasCachedActivity || needsCachedPlan);
    }),
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

function hasIncompleteCachedMessageHistory({
  cachedMessages,
  historyState,
  session,
}: {
  cachedMessages: Pick<AgentMessage, "id" | "role">[] | undefined;
  historyState: HistoryState | undefined;
  session: SessionSummary | undefined;
}) {
  if (!session || !historyState || historyState.loading || historyState.hasMore) {
    return false;
  }
  const cachedUserCount = cachedMessages?.filter((message) => message.role === "user").length ?? 0;
  return session.messageCount > cachedUserCount;
}
