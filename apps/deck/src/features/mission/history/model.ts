export type MessageHistoryEntry = {
  nextCursor?: string;
  hasMore: boolean;
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
  const hasLoadableActivities = Boolean(activityState?.hasMore && activityState.nextCursor);
  return {
    hasMore: hasLoadableMessages,
    canLoadMore: hasLoadableMessages || hasLoadableActivities,
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
    listTimeline: { sessionId, limit: messagePageLimit },
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
  const canPageTimeline = messageState &&
    !messageState.loading &&
    messageState.hasMore &&
    Boolean(messageState.nextCursor);
  const listTimeline = canPageTimeline
    ? {
        sessionId,
        limit: messagePageLimit,
        before: messageState.nextCursor,
      }
    : undefined;
  const getArtifacts = activityState &&
    !activityState.loading &&
    activityState.hasMore &&
    activityState.nextCursor
      ? { sessionId, limit: activityPageLimit, before: activityState.nextCursor }
      : undefined;
  return { listTimeline, getArtifacts };
}

export function shouldProjectArtifactsIntoTimeline({
  messageHistoryLoading,
  messageHasMore,
  isLiveUpdate,
}: {
  messageHistoryLoading: boolean;
  messageHasMore: boolean;
  isLiveUpdate: boolean;
}): boolean {
  if (isLiveUpdate) {
    return true;
  }
  if (messageHistoryLoading) {
    return false;
  }
  if (messageHasMore) {
    return false;
  }
  return true;
}
