import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConversationBootstrapPlan,
  buildConversationPaginationPlan,
  resolveConversationHistoryFlags,
  shouldProjectArtifactsIntoTimeline,
} from "./model.js";

test("activity-only history remains loadable without advertising message context", () => {
  assert.deepEqual(
    resolveConversationHistoryFlags(undefined, { hasMore: true, nextCursor: "c1", loading: false }),
    { hasMore: false, canLoadMore: true, loading: false },
  );
});

test("both message and activity cursors contribute to flags", () => {
  assert.deepEqual(
    resolveConversationHistoryFlags(
      { hasMore: true, nextCursor: "m1", timelineHasMore: true, timelineNextCursor: "t1", loading: false },
      { hasMore: true, nextCursor: "a1", loading: false },
    ),
    { hasMore: true, canLoadMore: true, timelineHasMore: true, loading: false },
  );
});

test("no state returns undefined", () => {
  assert.equal(resolveConversationHistoryFlags(undefined, undefined), undefined);
});

test("pagination plan carries all three cursors from one state snapshot", () => {
  const plan = buildConversationPaginationPlan({
    sessionId: "s1",
    messagePageLimit: 96,
    activityPageLimit: 96,
    messageState: { hasMore: true, nextCursor: "l1", timelineHasMore: true, timelineNextCursor: "t1", loading: false },
    activityState: { hasMore: true, nextCursor: "a1", loading: false },
  });
  assert.deepEqual(plan.listMessages, { sessionId: "s1", limit: 96, before: "l1", timelineBefore: "t1" });
  assert.deepEqual(plan.getArtifacts, { sessionId: "s1", limit: 96, before: "a1" });
});

test("pagination plan returns undefined when no cursors are loadable", () => {
  const plan = buildConversationPaginationPlan({
    sessionId: "s1",
    messagePageLimit: 96,
    activityPageLimit: 96,
    messageState: { hasMore: false, loading: false },
    activityState: { hasMore: false, loading: false },
  });
  assert.equal(plan.listMessages, undefined);
  assert.equal(plan.getArtifacts, undefined);
});

test("pagination plan blocks when message state is loading", () => {
  const plan = buildConversationPaginationPlan({
    sessionId: "s1",
    messagePageLimit: 96,
    activityPageLimit: 96,
    messageState: { hasMore: true, nextCursor: "c1", loading: true },
  });
  assert.equal(plan.listMessages, undefined);
});

test("bootstrap plan carries the initial message and artifact page requests", () => {
  assert.deepEqual(
    buildConversationBootstrapPlan({ sessionId: "s1", messagePageLimit: 96, activityPageLimit: 96 }),
    {
      listMessages: { sessionId: "s1", limit: 96 },
      getArtifacts: { sessionId: "s1", limit: 96 },
    },
  );
});

test("artifact projection is blocked while message history is still incomplete", () => {
  assert.equal(
    shouldProjectArtifactsIntoTimeline({
      messageHistoryLoading: false,
      messageHasMore: true,
      timelineHasMore: false,
      isLiveUpdate: false,
    }),
    false,
  );
});

test("artifact projection is blocked while message history is loading", () => {
  assert.equal(
    shouldProjectArtifactsIntoTimeline({
      messageHistoryLoading: true,
      messageHasMore: false,
      timelineHasMore: false,
      isLiveUpdate: false,
    }),
    false,
  );
});

test("historical artifact hydration allowed even when timeline already has entries (dedup handled by upsert)", () => {
  assert.equal(
    shouldProjectArtifactsIntoTimeline({
      messageHistoryLoading: false,
      messageHasMore: false,
      timelineHasMore: false,
      isLiveUpdate: false,
    }),
    true,
  );
});

test("historical artifact hydration allowed when timeline is empty and history is idle", () => {
  assert.equal(
    shouldProjectArtifactsIntoTimeline({
      messageHistoryLoading: false,
      messageHasMore: false,
      timelineHasMore: false,
      isLiveUpdate: false,
    }),
    true,
  );
});

test("live tool updates can still project into an existing assistant timeline", () => {
  assert.equal(
    shouldProjectArtifactsIntoTimeline({
      messageHistoryLoading: false,
      messageHasMore: false,
      timelineHasMore: false,
      isLiveUpdate: true,
    }),
    true,
  );
});
