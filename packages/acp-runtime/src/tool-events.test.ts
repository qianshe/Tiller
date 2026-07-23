import assert from "node:assert/strict";
import test from "node:test";
import { extractToolCall } from "./tool-events.js";

test("extractToolCall keeps git diff commands classified as shell", () => {
  for (const command of [
    "git --no-pager diff --stat HEAD",
    "git --no-pager diff HEAD -- apps/deck/",
  ]) {
    const toolCall = extractToolCall("session-git-diff", "tool_call", {
      toolCallId: `call-${command.length}`,
      title: command,
      kind: "tool",
      status: "completed",
      rawInput: { command },
    });

    assert.equal(toolCall?.kind, "shell", command);
  }
});
