import assert from "node:assert/strict";
import test from "node:test";
import { resolveConversationHistoryState } from "./message-timeline.js";

test("conversation history only advertises more context when a cursor is loadable", () => {
  assert.deepEqual(
    resolveConversationHistoryState(
      { hasMore: true, timelineHasMore: true, loading: false },
      { hasMore: true, loading: false },
    ),
    { hasMore: false, loading: false },
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
    { hasMore: true, loading: false },
  );

  assert.deepEqual(
    resolveConversationHistoryState(
      undefined,
      { hasMore: true, nextCursor: "activity-cursor", loading: true },
    ),
    { hasMore: true, loading: true },
  );
});
