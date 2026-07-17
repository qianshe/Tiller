import assert from "node:assert/strict";
import test from "node:test";
import {
  extractCodexCompactionSummaryFromTranscriptText,
  extractCodexVisibleMessagesFromTranscriptText,
} from "./history.js";

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

test("extractCodexCompactionSummaryFromTranscriptText restores the matching compacted summary", () => {
  const transcript = [
    codexCompaction("2026-07-17T13:25:03.338Z", "## First summary\n\nEarlier state"),
    codexCompaction("2026-07-17T14:25:03.338Z", "## Second summary\n\nLater state"),
  ].join("\n");

  assert.equal(
    extractCodexCompactionSummaryFromTranscriptText(transcript, {
      completedAt: "2026-07-17T13:25:03.348Z",
    }),
    "## First summary\n\nEarlier state",
  );
  assert.equal(
    extractCodexCompactionSummaryFromTranscriptText(transcript),
    "## Second summary\n\nLater state",
  );
});

function codexCompaction(timestamp: string, summary: string): string {
  return JSON.stringify({
    timestamp,
    type: "compacted",
    payload: {
      message: [
        "Another language model started to solve this problem and produced a summary of its thinking process.",
        "Use this to build on the work that has already been done and avoid duplicating work.",
        "Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:",
        summary,
      ].join("\n"),
      replacement_history: [],
    },
  });
}
