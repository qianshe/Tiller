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

test("extractToolCall never classifies tool updates as Thinking", () => {
  for (const update of [
    {
      toolCallId: "call-explicit-think",
      title: "Internal planning",
      kind: "think",
      status: "completed",
      rawOutput: "Inspect the repository first",
    },
    {
      toolCallId: "call-thinking-title",
      title: "Thinking",
      status: "completed",
      rawOutput: "Inspect the repository first",
    },
  ]) {
    const toolCall = extractToolCall("session-tool-thinking", "tool_call_update", update);

    assert.equal(toolCall?.kind, "tool", update.toolCallId);
  }
});
