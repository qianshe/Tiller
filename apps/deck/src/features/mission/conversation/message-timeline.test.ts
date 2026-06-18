import assert from "node:assert/strict";
import test from "node:test";
import { resolveConversationHistoryState } from "./message-timeline.js";

test("conversation history only advertises more context when a cursor is loadable", () => {
  assert.deepEqual(
    resolveConversationHistoryState(
      { hasMore: true, timelineHasMore: true, loading: false },
      { hasMore: true, loading: false },
    ),
    { hasMore: false, canLoadMore: false, loading: false },
  );

  assert.deepEqual(
    resolveConversationHistoryState(
      {
        hasMore: false,
        timelineHasMore: true,
        timelineNextCursor: "timeline-cursor",
        loading: false,
      },
      undefined,
    ),
    { hasMore: true, canLoadMore: true, timelineHasMore: true, loading: false },
  );

  assert.deepEqual(
    resolveConversationHistoryState(
      undefined,
      { hasMore: true, nextCursor: "activity-cursor", loading: true },
    ),
    { hasMore: false, canLoadMore: true, loading: true },
  );
});

test("conversation history keeps activity-only pagination loadable without showing message context", () => {
  assert.deepEqual(
    resolveConversationHistoryState(
      undefined,
      { hasMore: true, nextCursor: "activity-cursor", loading: false },
    ),
    { hasMore: false, canLoadMore: true, loading: false },
  );
});
