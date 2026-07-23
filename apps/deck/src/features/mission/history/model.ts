export type MessageHistoryEntry = {
  nextCursor?: string;
  hasMore: boolean;
  loading: boolean;
};

export function resolveConversationHistoryFlags(messageState?: MessageHistoryEntry) {
  if (!messageState) {
    return undefined;
  }
  const hasLoadableMessages = Boolean(messageState?.hasMore && messageState.nextCursor);
  return {
    hasMore: hasLoadableMessages,
    canLoadMore: hasLoadableMessages,
    loading: Boolean(messageState.loading),
  };
}

export function buildConversationBootstrapPlan({
  sessionId,
  messagePageLimit,
}: {
  sessionId: string;
  messagePageLimit: number;
}) {
  return {
    listTimeline: { sessionId, limit: messagePageLimit },
  };
}

export function buildConversationPaginationPlan({
  sessionId,
  messagePageLimit,
  messageState,
}: {
  sessionId: string;
  messagePageLimit: number;
  messageState?: MessageHistoryEntry;
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
  return { listTimeline };
}
