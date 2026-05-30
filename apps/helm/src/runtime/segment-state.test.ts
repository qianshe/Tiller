import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeActiveRuntimeThinking,
  normalizeRuntimeThinkingToolCall,
} from "./segment-state.js";

test("runtime thinking helper keeps one stable tool call id across deltas", () => {
  const sessionId = "runtime-segment-state-thinking-stable";
  const first = normalizeRuntimeThinkingToolCall(sessionId, {
    id: "provider-thought-1:thinking",
    kind: "think",
    output: "thinking",
    status: "running",
    timestamp: "2026-05-28T00:00:00.000Z",
    title: "Thinking",
    updatedAt: "2026-05-28T00:00:00.000Z",
  });
  const second = normalizeRuntimeThinkingToolCall(sessionId, {
    id: "provider-thought-1:thinking",
    kind: "think",
    output: "thinking more",
    status: "running",
    timestamp: "2026-05-28T00:00:01.000Z",
    title: "Thinking",
    updatedAt: "2026-05-28T00:00:01.000Z",
  });

  assert.equal(first.id, second.id);
  assert.equal(first.commandId, second.commandId);
  assert.equal(second.output, "thinking more");
});

test("runtime thinking helper finalizes the active tool call", () => {
  const sessionId = "runtime-segment-state-thinking-finalize";
  const normalized = normalizeRuntimeThinkingToolCall(sessionId, {
    id: "provider-thought-2:thinking",
    kind: "think",
    output: "thinking",
    status: "running",
    timestamp: "2026-05-28T00:00:02.000Z",
    title: "Thinking",
    updatedAt: "2026-05-28T00:00:02.000Z",
  });
  const finalized = finalizeActiveRuntimeThinking(sessionId);

  assert.ok(finalized);
  assert.equal(finalized?.id, normalized.id);
  assert.equal(finalized?.status, "completed");
  assert.equal(finalizeActiveRuntimeThinking(sessionId), undefined);
});
