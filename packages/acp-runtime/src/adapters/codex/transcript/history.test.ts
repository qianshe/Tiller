import assert from "node:assert/strict";
import test from "node:test";
import { extractCodexVisibleMessagesFromTranscriptText } from "./history.js";

test("extractCodexVisibleMessagesFromTranscriptText restores visible Codex user and assistant messages", () => {
  const transcript = [
    JSON.stringify({
      timestamp: "2026-07-07T17:12:51.998Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "再测试一下web搜索能力" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T17:12:52.100Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "[🌳木] 我先做一次简单搜索" }],
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-07T17:12:52.200Z",
      type: "response_item",
      payload: {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "跳过 developer" }],
      },
    }),
  ].join("\n");

  const messages = extractCodexVisibleMessagesFromTranscriptText(transcript);

  assert.deepEqual(
    messages.map((message) => [message.role, message.text, message.timestamp, message.sequence]),
    [
      ["user", "再测试一下web搜索能力", "2026-07-07T17:12:51.998Z", 1],
      ["assistant", "[🌳木] 我先做一次简单搜索", "2026-07-07T17:12:52.100Z", 2],
    ],
  );
});
