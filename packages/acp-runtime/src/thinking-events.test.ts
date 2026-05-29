import assert from "node:assert/strict";
import test from "node:test";
import { extractThinkingToolCall } from "./thinking-events";

test("extractThinkingToolCall maps ACP thought chunks into stable think tool calls", () => {
  const first = extractThinkingToolCall("sess_thinking", "agent_thought_chunk", {
    content: { type: "text", text: "第一段思考" },
  });
  const second = extractThinkingToolCall("sess_thinking", "agent_thought_chunk", {
    content: { type: "text", text: "第二段思考" },
  });

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.id, "sess_thinking-thinking:thinking");
  assert.equal(second.id, first.id);
  assert.equal(first.commandId, first.id);
  assert.equal(first.kind, "think");
  assert.equal(first.title, "Thinking");
  assert.equal(first.output, "第一段思考");
  assert.equal(first.status, "running");
});

test("extractThinkingToolCall maps completed reasoning content", () => {
  const toolCall = extractThinkingToolCall("sess_reasoning", "agent_thought_complete", {
    messageId: "msg_reasoning",
    content: [{ type: "reasoning", text: "结论已经形成" }],
    timestamp: "2026-05-29T00:00:00.000Z",
  });

  assert.ok(toolCall);
  assert.equal(toolCall.id, "msg_reasoning:thinking");
  assert.equal(toolCall.output, "结论已经形成");
  assert.equal(toolCall.status, "completed");
  assert.equal(toolCall.timestamp, "2026-05-29T00:00:00.000Z");
});
