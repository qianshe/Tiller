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
  // 工具结果即使携带思考形状的元数据，也不能进入思考流。
  assert.equal(
    extractThinkingContent("sess_tool_result_thinking", "tool_call_update", {
      content: { type: "thinking", thinking: "tool result metadata" },
    }),
    null,
  );
});

test("extractThinkingContent ignores tool and terminal output updates", () => {
  const toolOutputUpdateTypes = [
    "tool_call",
    "tool_call_update",
    "tool_call_content_chunk",
    "tool_call_result",
    "tool_result",
    "tool_output",
    "terminal",
    "terminal_output",
    "command_output",
    "command_output_chunk",
    "command-output-chunk",
    "toolCallUpdate",
    "agent_tool_call_content_chunk",
    "agent_terminal_output",
  ];

  for (const updateType of toolOutputUpdateTypes) {
    assert.equal(
      extractThinkingContent("sess_tool_output", updateType, {
        content: { type: "thinking", thinking: "Read output must stay tool output" },
      }),
      null,
      `${updateType} must not become assistant thinking`,
    );
  }
});
