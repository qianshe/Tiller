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

test("expandOpenCodeRuntimeEvent does not classify unfinalized streaming=undefined messages", () => {
  const event = {
    type: "message",
    message: {
      id: "msg-opencode-undefined",
      role: "assistant",
      text: OPEN_CODE_AUTOMATIC_COMPACTION_SUMMARY,
      timestamp: "2026-07-20T14:01:13.159Z",
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

test("expandOpenCodeRuntimeEvent classifies a complete summary with an extra Notes heading (M2 characterization)", () => {
  const event = {
    type: "message",
    message: {
      id: "msg-opencode-structured-reply",
      role: "assistant",
      text: `${OPEN_CODE_AUTOMATIC_COMPACTION_SUMMARY}\n\n## Notes\n- Keep this as a reply.`,
      timestamp: "2026-07-20T14:01:13.159Z",
      streaming: false,
    },
  } satisfies SessionRuntimeEvent;

  assert.equal(expandOpenCodeRuntimeEvent(event)?.[0]?.type, "compaction");
});

const OPEN_CODE_16_HEADING_COMPACTION_SUMMARY = [
  "## Goal",
  "- Continue the repository cleanup task.",
  "",
  "## Constraints & Preferences",
  "- Preserve the existing worktree changes.",
  "",
  "## Progress",
  "### Done",
  "- Located the relevant runtime path.",
  "",
  "### In Progress",
  "- Waiting for the next prompt.",
  "",
  "### Blocked",
  "- (none)",
  "",
  "## Key Decisions",
  "- Keep compaction recognition in the adapter.",
  "",
  "## Open Questions",
  "- Whether the bridge will expose compaction metadata.",
  "",
  "## Risks",
  "- Heuristic matcher may need updates for new variants.",
  "",
  "## Dependencies",
  "- None.",
  "",
  "## Next Steps",
  "1. Continue from the recorded state.",
  "",
  "## Critical Context",
  "- The session was compacted automatically.",
  "",
  "## Testing Notes",
  "- Covered by adapter unit tests.",
  "",
  "## Rollout Plan",
  "- Merge behind the existing feature flag.",
  "",
  "## Verification",
  "- Run the compaction-events test suite.",
  "",
  "## Relevant Files",
  "- packages/acp-runtime/src/adapters/opencode/compaction-events.ts",
].join("\n");

const OPEN_CODE_LEGACY_COMPACTION_SUMMARY = [
  "Done. Here is the updated summary.",
  "",
  "1. User Requests (As-Is)",
  "- Follow the verification plan and preserve the current task context.",
  "",
  "2. Final Goal",
  "- Complete the requested repository change without losing prior work.",
  "",
  "3. Work Completed",
  "- Updated the relevant runtime and adapter code.",
].join("\n");

test("expandOpenCodeRuntimeEvent recognizes a 16-heading compaction variant", () => {
  const event = {
    type: "message",
    message: {
      id: "msg-opencode-16-heading",
      role: "assistant",
      text: OPEN_CODE_16_HEADING_COMPACTION_SUMMARY,
      timestamp: "2026-07-20T14:01:13.159Z",
      streaming: false,
    },
  } satisfies SessionRuntimeEvent;

  assert.deepEqual(expandOpenCodeRuntimeEvent(event), [
    {
      type: "compaction",
      phase: "completed",
      source: "provider",
      messageId: "msg-opencode-16-heading",
      timestamp: "2026-07-20T14:01:13.159Z",
      summaryText: OPEN_CODE_16_HEADING_COMPACTION_SUMMARY,
    },
  ]);
});

test("expandOpenCodeRuntimeEvent recognizes the legacy numbered compaction summary", () => {
  const event = {
    type: "message",
    message: {
      id: "msg-opencode-legacy-compaction",
      role: "assistant",
      text: OPEN_CODE_LEGACY_COMPACTION_SUMMARY,
      timestamp: "2026-07-20T14:01:13.159Z",
      streaming: false,
    },
  } satisfies SessionRuntimeEvent;

  assert.deepEqual(expandOpenCodeRuntimeEvent(event), [
    {
      type: "compaction",
      phase: "completed",
      source: "provider",
      messageId: "msg-opencode-legacy-compaction",
      timestamp: "2026-07-20T14:01:13.159Z",
      summaryText: OPEN_CODE_LEGACY_COMPACTION_SUMMARY,
    },
  ]);
});

test("expandOpenCodeRuntimeEvent ignores fenced pseudo headings inside a normal reply", () => {
  const event = {
    type: "message",
    message: {
      id: "msg-opencode-fenced",
      role: "assistant",
      text: [
        "This is a normal reply.",
        "",
        "```markdown",
        "## Goal",
        "## Progress",
        "### Done",
        "### In Progress",
        "### Blocked",
        "## Next Steps",
        "## Relevant Files",
        "```",
        "",
        "The headings above are only an example.",
      ].join("\n"),
      timestamp: "2026-07-20T14:01:13.159Z",
      streaming: false,
    },
  } satisfies SessionRuntimeEvent;

  assert.equal(expandOpenCodeRuntimeEvent(event), null);
});

test("expandOpenCodeRuntimeEvent rejects summaries missing core sub-headings", () => {
  const event = {
    type: "message",
    message: {
      id: "msg-opencode-missing-core",
      role: "assistant",
      text: [
        "## Goal",
        "- Continue.",
        "",
        "## Progress",
        "",
        "## Next Steps",
        "1. Continue.",
        "",
        "## Relevant Files",
        "- file.ts",
      ].join("\n"),
      timestamp: "2026-07-20T14:01:13.159Z",
      streaming: false,
    },
  } satisfies SessionRuntimeEvent;

  assert.equal(expandOpenCodeRuntimeEvent(event), null);
});

test("expandOpenCodeRuntimeEvent classifies a normal reply that fully mimics the core headings (M2 limitation characterization)", () => {
  const event = {
    type: "message",
    message: {
      id: "msg-opencode-mimic",
      role: "assistant",
      text: [
        "## Goal",
        "- Explain the plan.",
        "",
        "## Progress",
        "### Done",
        "- nothing yet",
        "",
        "### In Progress",
        "- drafting",
        "",
        "### Blocked",
        "- (none)",
        "",
        "## Next Steps",
        "1. Review.",
        "",
        "## Relevant Files",
        "- none",
      ].join("\n"),
      timestamp: "2026-07-20T14:01:13.159Z",
      streaming: false,
    },
  } satisfies SessionRuntimeEvent;

  const expanded = expandOpenCodeRuntimeEvent(event);
  assert.equal(expanded?.[0]?.type, "compaction");
});
