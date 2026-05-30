import type { AgentMessage, AgentToolCall, SessionSummary } from "@tiller/shared";

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
  messagesBySession?: Record<string, AgentMessage[] | undefined>;
  outputsBySession?: Record<string, unknown[] | undefined>;
  toolCallsBySession?: Record<string, AgentToolCall[] | undefined>;
  checkedResumeSessionIds: ReadonlySet<string>;
};

export function buildSessionStreamHydrationPlan({
  sessionIds,
  sessionById,
  messageHistoryState,
  activityHistoryState,
  messagesBySession,
  outputsBySession,
  toolCallsBySession,
  checkedResumeSessionIds,
}: WorkspaceSessionStreamHydrationInput): WorkspaceSessionStreamHydrationPlan {
  const uniqueSessionIds = [...new Set(sessionIds)];
  return {
    messageSessionIds: uniqueSessionIds.filter((sessionId) => (
      !messageHistoryState[sessionId] && !(messagesBySession?.[sessionId]?.length)
    )),
    activitySessionIds: uniqueSessionIds.filter((sessionId) => (
      !activityHistoryState[sessionId] &&
      !(outputsBySession?.[sessionId]?.length) &&
      !(toolCallsBySession?.[sessionId]?.length)
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
