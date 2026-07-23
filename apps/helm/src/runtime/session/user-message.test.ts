import assert from "node:assert/strict";
import test from "node:test";
import type { AgentPromptContent } from "@tiller/shared";
import { createUserPromptMessage } from "./user-message.js";

test("createUserPromptMessage projects image content into attachments", () => {
  const content: AgentPromptContent[] = [
    { type: "text", text: "hello" },
    { type: "image", data: "abc", mimeType: "image/png" },
  ];

  const message = createUserPromptMessage(
    {
      sessionId: "s1",
      text: "hello",
      content,
      clientMessageId: "client-1",
      timestamp: "2026-05-29T00:00:00.000Z",
    },
    () => 42,
  );

  assert.equal(message.id, "client-1");
  assert.equal(message.role, "user");
  assert.equal(message.sequence, 42);
  assert.deepEqual(message.attachments, [content[1]]);
});

test("createUserPromptMessage omits attachments when no images exist", () => {
  const message = createUserPromptMessage(
    {
      sessionId: "s1",
      text: "hello",
      content: [{ type: "text", text: "hello" }],
      clientMessageId: "client-1",
      timestamp: "2026-05-29T00:00:00.000Z",
    },
    () => 7,
  );

  assert.equal("attachments" in message, false);
  assert.equal(message.sequence, 7);
});
