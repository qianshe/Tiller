import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { AgentToolCall } from "@tiller/shared";
import { shouldInferCompactionCompletionFromEvent } from "./compaction.js";

test("shouldInferCompactionCompletionFromEvent does not infer from unfinalized streaming=undefined assistant chunks", () => {
  const event = {
    type: "message",
    message: {
      id: "msg-undefined",
      role: "assistant",
      text: "partial reply",
      timestamp: "2026-07-20T14:00:05.000Z",
    },
  } satisfies SessionRuntimeEvent;
  assert.equal(shouldInferCompactionCompletionFromEvent(event), false);
});

test("shouldInferCompactionCompletionFromEvent does not infer from streaming=true assistant messages", () => {
  const event = {
    type: "message",
    message: {
      id: "msg-streaming",
      role: "assistant",
      text: "partial reply",
      timestamp: "2026-07-20T14:00:05.000Z",
      streaming: true,
    },
  } satisfies SessionRuntimeEvent;
  assert.equal(shouldInferCompactionCompletionFromEvent(event), false);
});

test("shouldInferCompactionCompletionFromEvent infers from finalized streaming=false assistant messages", () => {
  const event = {
    type: "message",
    message: {
      id: "msg-finalized",
      role: "assistant",
      text: "complete reply",
      timestamp: "2026-07-20T14:00:05.000Z",
      streaming: false,
    },
  } satisfies SessionRuntimeEvent;
  assert.equal(shouldInferCompactionCompletionFromEvent(event), true);
});

test("shouldInferCompactionCompletionFromEvent still infers from non-message events", () => {
  const toolCall: AgentToolCall = {
    id: "call-1",
    kind: "tool",
    title: "Run",
    status: "completed",
    timestamp: "2026-07-20T14:00:05.000Z",
    updatedAt: "2026-07-20T14:00:05.000Z",
  };
  assert.equal(
    shouldInferCompactionCompletionFromEvent({ type: "tool-call", toolCall } satisfies SessionRuntimeEvent),
    true,
  );
});
