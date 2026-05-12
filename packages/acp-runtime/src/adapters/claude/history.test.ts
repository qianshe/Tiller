import assert from "node:assert/strict";
import test from "node:test";
import { parseClaudeJsonlHistory } from "./history.js";

test("parseClaudeJsonlHistory imports user and assistant messages from Claude jsonl", () => {
  const history = parseClaudeJsonlHistory([
    JSON.stringify({
      type: "attachment",
      uuid: "attachment-1",
      timestamp: "2026-05-12T11:00:00.000Z",
      sessionId: "claude-session-1",
    }),
    JSON.stringify({
      type: "user",
      uuid: "user-message-1",
      timestamp: "2026-05-12T11:00:01.000Z",
      sessionId: "claude-session-1",
      message: {
        role: "user",
        content: "hello claude",
      },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "assistant-message-1",
      timestamp: "2026-05-12T11:00:02.000Z",
      sessionId: "claude-session-1",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "hi" },
          { type: "text", text: " there" },
        ],
      },
    }),
  ].join("\n"));

  assert.deepEqual(history, {
    messages: [
      {
        id: "user-message-1",
        role: "user",
        text: "hello claude",
        timestamp: "2026-05-12T11:00:01.000Z",
      },
      {
        id: "assistant-message-1",
        role: "assistant",
        text: "hi there",
        timestamp: "2026-05-12T11:00:02.000Z",
      },
    ],
    toolCalls: [],
  });
});
