import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentToolCall } from "@tiller/shared";
import { createActiveConversationUpdateKey } from "./active-conversation-key.js";

const message = (id: string, text: string): AgentMessage => ({
  id,
  role: "assistant",
  text,
  timestamp: "2026-05-18T00:00:00.000Z",
});

const toolCall = (output: string, updatedAt: string): AgentToolCall => ({
  id: "tool-1",
  commandId: "tool-1",
  kind: "tool",
  title: "Tool",
  status: "running",
  output,
  timestamp: "2026-05-18T00:00:01.000Z",
  updatedAt,
});

test("createActiveConversationUpdateKey changes when tool output streams", () => {
  const first = createActiveConversationUpdateKey("s1", [message("m1", "hello")], [
    toolCall("step one", "2026-05-18T00:00:02.000Z"),
  ]);
  const next = createActiveConversationUpdateKey("s1", [message("m1", "hello")], [
    toolCall("step one\nstep two", "2026-05-18T00:00:03.000Z"),
  ]);

  assert.notEqual(next, first);
});
