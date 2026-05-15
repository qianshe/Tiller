import assert from "node:assert/strict";
import test from "node:test";
import { createMessageSegmentIdAllocator } from "./message-segment-id";

test("message segment ids are lexicographically ordered", () => {
  const allocator = createMessageSegmentIdAllocator();

  const first = allocator.nextAssistantSegmentId("session-1", {
    text: "第一段回复",
    providerMessageId: null,
  });
  allocator.bumpToolBoundary("session-1");
  const second = allocator.nextAssistantSegmentId("session-1", {
    text: "工具之后的回复",
    providerMessageId: null,
  });

  assert.match(first, /^session-1-msg-000001-000000-c[0-9a-f]{8}$/u);
  assert.match(second, /^session-1-msg-000001-000001-c[0-9a-f]{8}$/u);
  assert.deepEqual([second, first].sort(), [first, second]);
});

test("message segment ids keep provider identity as suffix when present", () => {
  const allocator = createMessageSegmentIdAllocator();

  const id = allocator.nextAssistantSegmentId("session-1", {
    text: "provider id wins for identity suffix",
    providerMessageId: "019e268d-ff2d-7b92-b79f-fbbcb615985a",
  });

  assert.match(id, /^session-1-msg-000001-000000-p[0-9a-f]{1,32}$/u);
});

test("new running turn starts a new ordered prefix", () => {
  const allocator = createMessageSegmentIdAllocator();

  const first = allocator.nextAssistantSegmentId("session-1", {
    text: "第一轮",
    providerMessageId: null,
  });
  allocator.startAssistantTurn("session-1");
  const second = allocator.nextAssistantSegmentId("session-1", {
    text: "第二轮",
    providerMessageId: null,
  });

  assert.match(first, /^session-1-msg-000001-000000-/u);
  assert.match(second, /^session-1-msg-000002-000000-/u);
});
