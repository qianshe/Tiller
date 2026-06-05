import type { AgentPlan, AgentToolCall, SessionSummary, SessionTimelineEntry } from "@tiller/shared";

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
  sessionTimelineBySession,
  outputsBySession,
  toolCallsBySession,
  sessionPlansBySession,
  checkedResumeSessionIds,
}: WorkspaceSessionStreamHydrationInput): WorkspaceSessionStreamHydrationPlan {
  const uniqueSessionIds = [...new Set(sessionIds)];
  return {
    messageSessionIds: uniqueSessionIds.filter((sessionId) => (
      !messageHistoryState[sessionId]
    )),
    activitySessionIds: uniqueSessionIds.filter((sessionId) => {
      const toolCalls = toolCallsBySession?.[sessionId] ?? [];
      const hasCachedActivity = Boolean(
        outputsBySession?.[sessionId]?.length || toolCalls.length,
      );
      const needsCachedTodoPlan = Boolean(
        !sessionPlansBySession?.[sessionId] &&
          toolCalls.some((toolCall) => toolCall.kind === "todo"),
      );
      return !activityHistoryState[sessionId] &&
        (!hasCachedActivity || needsCachedTodoPlan);
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
