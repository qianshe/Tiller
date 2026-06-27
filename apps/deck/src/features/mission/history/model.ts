export type MessageHistoryEntry = {
  nextCursor?: string;
  hasMore: boolean;
  timelineNextCursor?: string;
  timelineHasMore?: boolean;
  loading: boolean;
};

export type ActivityHistoryEntry = {
  nextCursor?: string;
  hasMore: boolean;
  loading: boolean;
};

export function resolveConversationHistoryFlags(
  messageState?: MessageHistoryEntry,
  activityState?: ActivityHistoryEntry,
) {
  if (!messageState && !activityState) {
    return undefined;
  }
  const hasLoadableMessages = Boolean(messageState?.hasMore && messageState.nextCursor);
  const hasLoadableTimeline = Boolean(messageState?.timelineHasMore && messageState.timelineNextCursor);
  const hasLoadableActivities = Boolean(activityState?.hasMore && activityState.nextCursor);
  return {
    hasMore: hasLoadableMessages || hasLoadableTimeline,
    canLoadMore: hasLoadableMessages || hasLoadableTimeline || hasLoadableActivities,
    ...(hasLoadableTimeline ? { timelineHasMore: true } : {}),
    loading: Boolean(messageState?.loading || activityState?.loading),
  };
}

export function buildConversationBootstrapPlan({
  sessionId,
  messagePageLimit,
  activityPageLimit,
}: {
  sessionId: string;
  messagePageLimit: number;
  activityPageLimit: number;
}) {
  return {
    listMessages: { sessionId, limit: messagePageLimit },
    getArtifacts: { sessionId, limit: activityPageLimit },
  };
}

export function buildConversationPaginationPlan({
  sessionId,
  messagePageLimit,
  activityPageLimit,
  messageState,
  activityState,
}: {
  sessionId: string;
  messagePageLimit: number;
  activityPageLimit: number;
  messageState?: MessageHistoryEntry;
  activityState?: ActivityHistoryEntry;
}) {
  const canPageMessages = messageState &&
    !messageState.loading &&
    ((messageState.hasMore && messageState.nextCursor) ||
      (messageState.timelineHasMore && messageState.timelineNextCursor));
  const listMessages = canPageMessages
    ? {
        sessionId,
        limit: messagePageLimit,
        before: messageState.hasMore ? messageState.nextCursor : undefined,
        timelineBefore: messageState.timelineHasMore ? messageState.timelineNextCursor : undefined,
      }
    : undefined;
  const getArtifacts = activityState &&
    !activityState.loading &&
    activityState.hasMore &&
    activityState.nextCursor
      ? { sessionId, limit: activityPageLimit, before: activityState.nextCursor }
      : undefined;
  return { listMessages, getArtifacts };
}

export function shouldProjectArtifactsIntoTimeline({
  messageHistoryLoading,
  messageHasMore,
  timelineHasMore,
  isLiveUpdate,
}: {
  messageHistoryLoading: boolean;
  messageHasMore: boolean;
  timelineHasMore: boolean;
  isLiveUpdate: boolean;
}): boolean {
  if (isLiveUpdate) {
    return true;
  }
  if (messageHistoryLoading) {
    return false;
  }
  if (messageHasMore || timelineHasMore) {
    return false;
  }
  return true;
}
