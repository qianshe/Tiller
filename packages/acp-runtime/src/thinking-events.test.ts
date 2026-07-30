import assert from "node:assert/strict";
import test from "node:test";
import { extractThinkingContent } from "./thinking-events";

test("extractThinkingContent maps ACP thought chunks", () => {
  const first = extractThinkingContent("sess_thinking", "agent_thought_chunk", {
    content: { type: "text", text: "第一段思考" },
  });
  const second = extractThinkingContent("sess_thinking", "agent_thought_chunk", {
    content: { type: "text", text: "第二段思考" },
  });

  assert.ok(first);
  assert.ok(second);
  // id 不含 :thinking 后缀，由 upsertAssistantThinking 补后缀
  assert.equal(first.id, "sess_thinking-thinking");
  assert.equal(second.id, first.id);
  assert.equal(first.text, "第一段思考");
  assert.equal(first.status, "running");
  assert.equal(first.streaming, true);
});

test("extractThinkingContent maps completed reasoning content", () => {
  const content = extractThinkingContent("sess_reasoning", "agent_thought_complete", {
    messageId: "msg_reasoning",
    content: [{ type: "reasoning", text: "结论已经形成" }],
    timestamp: "2026-05-29T00:00:00.000Z",
  });

  assert.ok(content);
  assert.equal(content.id, "msg_reasoning");
  assert.equal(content.text, "结论已经形成");
  assert.equal(content.status, "completed");
  assert.equal(content.streaming, false);
  assert.equal(content.timestamp, "2026-05-29T00:00:00.000Z");
});

test("extractThinkingContent ignores structurally empty payloads", () => {
  for (const text of ["", "   ", "{}", "[]", "null"]) {
    const content = extractThinkingContent("sess_empty", "agent_thought_chunk", {
      content: { type: "text", text },
    });
    assert.equal(content, null, `expected ${JSON.stringify(text)} to be ignored`);
  }
  assert.equal(
    extractThinkingContent("sess_empty", "agent_thought_chunk", {
      content: { type: "text", text: "​⁠﻿" },
    }),
    null,
  );
});

test("extractThinkingContent requires typed thinking block outside ACP thought updates", () => {
  assert.equal(
    extractThinkingContent("sess_untyped", "agent_message_chunk", {
      content: { type: "text", text: "Read result", thinking: "metadata" },
    }),
    null,
  );
  assert.equal(
    extractThinkingContent("sess_nested", "agent_message_chunk", {
      content: { type: "content", content: { thinking: "nested metadata" } },
    }),
    null,
  );
  // 保留 tool_call_update 守卫测试（验证 isToolCallUpdateType 守卫有效）
  assert.equal(
    extractThinkingContent("sess_tool_result_thinking", "tool_call_update", {
      content: { type: "thinking", thinking: "tool result metadata" },
    }),
    null,
  );
});
