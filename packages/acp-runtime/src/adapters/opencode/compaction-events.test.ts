import assert from "node:assert/strict";
import test from "node:test";
import type { SessionRuntimeEvent } from "../../runtime-types";
import { expandOpenCodeRuntimeEvent } from "./compaction-events";

const OPEN_CODE_AUTOMATIC_COMPACTION_SUMMARY = [
  "## Objective",
  "- Continue the repository cleanup task.",
  "",
  "## Important Details",
  "- Preserve the existing worktree changes.",
  "",
  "## Work State",
  "### Completed",
  "- Located the relevant runtime path.",
  "",
  "### Active",
  "- Waiting for the next prompt.",
  "",
  "### Blocked",
  "- (none)",
  "",
  "## Next Move",
  "1. Continue from the recorded state.",
  "",
  "## Relevant Files",
  "- packages/acp-runtime/src/events.ts: maps ACP updates.",
].join("\n");

test("expandOpenCodeRuntimeEvent projects automatic compaction summaries", () => {
  const event = {
    type: "message",
    message: {
      id: "msg-opencode-compaction",
      role: "assistant",
      text: OPEN_CODE_AUTOMATIC_COMPACTION_SUMMARY,
      timestamp: "2026-07-20T14:01:13.159Z",
      streaming: false,
    },
  } satisfies SessionRuntimeEvent;

  assert.deepEqual(expandOpenCodeRuntimeEvent(event), [
    {
      type: "compaction",
      phase: "completed",
      source: "provider",
      messageId: "msg-opencode-compaction",
      timestamp: "2026-07-20T14:01:13.159Z",
      summaryText: OPEN_CODE_AUTOMATIC_COMPACTION_SUMMARY,
    },
  ]);
});

test("expandOpenCodeRuntimeEvent waits for streaming summaries to finish", () => {
  const event = {
    type: "message",
    message: {
      id: "msg-opencode-streaming-compaction",
      role: "assistant",
      text: OPEN_CODE_AUTOMATIC_COMPACTION_SUMMARY,
      timestamp: "2026-07-20T14:01:13.159Z",
      streaming: true,
    },
  } satisfies SessionRuntimeEvent;

  assert.equal(expandOpenCodeRuntimeEvent(event), null);
});

test("expandOpenCodeRuntimeEvent does not classify incomplete objective-shaped replies", () => {
  const event = {
    type: "message",
    message: {
      id: "msg-opencode-normal-reply",
      role: "assistant",
      text: "## Objective\n- Explain the implementation plan.",
      timestamp: "2026-07-20T14:01:13.159Z",
    },
  } satisfies SessionRuntimeEvent;

  assert.equal(expandOpenCodeRuntimeEvent(event), null);
});

test("expandOpenCodeRuntimeEvent does not classify summaries with extra headings", () => {
  const event = {
    type: "message",
    message: {
      id: "msg-opencode-structured-reply",
      role: "assistant",
      text: `${OPEN_CODE_AUTOMATIC_COMPACTION_SUMMARY}\n\n## Notes\n- Keep this as a reply.`,
      timestamp: "2026-07-20T14:01:13.159Z",
    },
  } satisfies SessionRuntimeEvent;

  assert.equal(expandOpenCodeRuntimeEvent(event), null);
});
