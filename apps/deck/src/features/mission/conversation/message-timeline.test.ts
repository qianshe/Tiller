import assert from "node:assert/strict";
import test from "node:test";
import { resolveConversationHistoryState } from "./message-timeline.js";

test("conversation history only advertises more context when a cursor is loadable", () => {
  assert.deepEqual(
    resolveConversationHistoryState({ hasMore: true, loading: false }),
    { hasMore: false, canLoadMore: false, loading: false },
  );

  assert.deepEqual(
    resolveConversationHistoryState({
      hasMore: true,
      nextCursor: "timeline-cursor",
      loading: false,
    }),
    { hasMore: true, canLoadMore: true, loading: false },
  );

  assert.equal(resolveConversationHistoryState(undefined), undefined);
});
