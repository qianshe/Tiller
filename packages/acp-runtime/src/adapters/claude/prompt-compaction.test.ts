import assert from "node:assert/strict";
import test from "node:test";
import { createClaudePromptCompactionObserver } from "./prompt-compaction";

const context = {
  runtimeSessionId: "runtime-claude-1",
  cwd: "D:/repo",
};

test("Claude compaction observer emits only summaries written after manual compaction begins", () => {
  let summaries = [
    {
      summaryMessageId: "summary-old",
      summaryText: "Previous compacted context",
      timestamp: "2026-07-19T14:00:00.000Z",
    },
  ];
  const observer = createClaudePromptCompactionObserver(() => summaries);
  observer.begin(context);

  assert.deepEqual(observer.poll(context), []);

  summaries = [
    ...summaries,
    {
      summaryMessageId: "summary-new",
      summaryText: "New compacted context",
      timestamp: "2026-07-19T14:30:00.000Z",
    },
  ];

  // A repeated begin must retain the original observation baseline.
  observer.begin(context);
  assert.deepEqual(observer.poll(context), [
    {
      type: "compaction",
      phase: "completed",
      source: "provider",
      messageId: "summary-new",
      summaryText: "New compacted context",
      timestamp: "2026-07-19T14:30:00.000Z",
    },
  ]);
});

test("Claude compaction observer preserves every summary written between polls", () => {
  let summaries = [
    {
      summaryMessageId: "summary-old",
      summaryText: "Previous compacted context",
      timestamp: "2026-07-19T14:00:00.000Z",
    },
  ];
  const observer = createClaudePromptCompactionObserver(() => summaries);
  observer.begin(context);
  assert.deepEqual(observer.poll(context), []);

  summaries = [
    ...summaries,
    {
      summaryMessageId: "summary-auto",
      summaryText: "Automatically compacted context",
      timestamp: "2026-07-19T14:30:00.000Z",
    },
    {
      summaryMessageId: "summary-manual",
      summaryText: "Manually compacted context",
      timestamp: "2026-07-19T14:31:00.000Z",
    },
  ];

  assert.deepEqual(
    observer.poll(context).map((event) =>
      event.type === "compaction" ? event.messageId : undefined,
    ),
    ["summary-auto", "summary-manual"],
  );
});
