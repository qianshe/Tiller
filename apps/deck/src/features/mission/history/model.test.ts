import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConversationBootstrapPlan,
  buildConversationPaginationPlan,
  resolveConversationHistoryFlags,
} from "./model.js";

test("chat history flags ignore artifact-only cursors", () => {
  assert.equal(resolveConversationHistoryFlags(undefined), undefined);
});

test("chat history flags only use timeline cursor state", () => {
  assert.deepEqual(
    resolveConversationHistoryFlags({ hasMore: true, nextCursor: "m1", loading: false }),
    { hasMore: true, canLoadMore: true, loading: false },
  );
});

test("no state returns undefined", () => {
  assert.equal(resolveConversationHistoryFlags(undefined), undefined);
});

test("pagination plan only carries the timeline cursor", () => {
  const plan = buildConversationPaginationPlan({
    sessionId: "s1",
    messagePageLimit: 96,
    messageState: { hasMore: true, nextCursor: "t1", loading: false },
  });
  assert.deepEqual(plan.listTimeline, { sessionId: "s1", limit: 96, before: "t1" });
});

test("pagination plan returns undefined when no timeline cursor is loadable", () => {
  const plan = buildConversationPaginationPlan({
    sessionId: "s1",
    messagePageLimit: 96,
    messageState: { hasMore: false, loading: false },
  });
  assert.equal(plan.listTimeline, undefined);
});

test("pagination plan blocks when message state is loading", () => {
  const plan = buildConversationPaginationPlan({
    sessionId: "s1",
    messagePageLimit: 96,
    messageState: { hasMore: true, nextCursor: "c1", loading: true },
  });
  assert.equal(plan.listTimeline, undefined);
});

test("bootstrap plan only carries the initial timeline request", () => {
  assert.deepEqual(
    buildConversationBootstrapPlan({ sessionId: "s1", messagePageLimit: 96 }),
    {
      listTimeline: { sessionId: "s1", limit: 96 },
    },
  );
});
