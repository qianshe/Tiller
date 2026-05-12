import assert from "node:assert/strict";
import test from "node:test";
import { parseCodexJsonlHistory } from "./history.js";

test("parseCodexJsonlHistory imports user and assistant messages from Codex jsonl", () => {
  const history = parseCodexJsonlHistory([
    JSON.stringify({
      timestamp: "2026-05-12T10:00:00.000Z",
      type: "session_meta",
      payload: { id: "codex-session-1" },
    }),
    JSON.stringify({
      timestamp: "2026-05-12T10:00:01.000Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "ignore developer" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-05-12T10:00:02.000Z",
      type: "response_item",
      payload: {
        id: "user-item-1",
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-05-12T10:00:03.000Z",
      type: "response_item",
      payload: {
        id: "assistant-item-1",
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: "hi" },
          { type: "output_text", text: " there" },
        ],
      },
    }),
  ].join("\n"));

  assert.deepEqual(history, {
    messages: [
      {
        id: "user-item-1",
        role: "user",
        text: "hello",
        timestamp: "2026-05-12T10:00:02.000Z",
      },
      {
        id: "assistant-item-1",
        role: "assistant",
        text: "hi there",
        timestamp: "2026-05-12T10:00:03.000Z",
      },
    ],
    toolCalls: [],
  });
});

test("parseCodexJsonlHistory imports legacy user entries", () => {
  const history = parseCodexJsonlHistory(JSON.stringify({
    timestamp: "2026-05-12T10:00:04.000Z",
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "input_text", text: "legacy" },
        { type: "text", text: " prompt" },
      ],
    },
  }));

  assert.deepEqual(history.messages, [
    {
      id: "codex-line-1",
      role: "user",
      text: "legacy prompt",
      timestamp: "2026-05-12T10:00:04.000Z",
    },
  ]);
});
