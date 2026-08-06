import assert from "node:assert/strict";
import test from "node:test";
import {
  markAssistantStreamBoundary,
  normalizeRuntimeAssistantMessageId,
  removeRuntimeSegmentState,
} from "./segment-state.js";

test("runtime segment state replaces ACP v2 thought snapshots before boundary checks", () => {
  const sessionId = "runtime-segment-state-thought-snapshot";
  const firstId = normalizeRuntimeAssistantMessageId(sessionId, {
    id: "provider-thought-upsert",
    contentKind: "thought",
    text: "第一份较长的完整思考",
  });
  const replacementId = normalizeRuntimeAssistantMessageId(sessionId, {
    id: "provider-thought-upsert",
    contentKind: "thought",
    text: "替换稿",
    streamMode: "snapshot",
  });

  markAssistantStreamBoundary(sessionId);
  const continuationId = normalizeRuntimeAssistantMessageId(sessionId, {
    id: "provider-thought-upsert",
    contentKind: "thought",
    text: "替换稿，继续分析",
    streamMode: "snapshot",
  });

  assert.equal(replacementId, firstId);
  assert.equal(continuationId, firstId);
  removeRuntimeSegmentState(sessionId);
});
