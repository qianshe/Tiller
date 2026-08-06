import assert from "node:assert/strict";
import test from "node:test";
import { mapSessionUpdateNotificationBatch } from "../../events";

test("OpenCode Read results are not inferred as Thinking from nested text metadata", () => {
  const mapped = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-read-result",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call-opencode-read-result",
          title: "Read",
          kind: "read",
          status: "completed",
          rawInput: { filePath: "package.json" },
          // OpenCode may attach provider metadata beside the returned text.
          // The field is not a Thinking content block and must not short-circuit
          // the real Read tool event.
          content: [
            { type: "thinking", thinking: "provider metadata" },
            { type: "text", text: '{"name":"tiller"}', thinking: "provider metadata" },
          ],
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.ok(mapped);
  assert.deepEqual(
    mapped.events.map((event) => event.type),
    ["tool-call"],
  );
  const event = mapped.events[0];
  assert.equal(event?.type, "tool-call");
  if (event?.type !== "tool-call") {
    throw new Error("Expected the OpenCode Read tool-call event");
  }
  assert.equal(event.toolCall.kind, "read");
  assert.notEqual(event.toolCall.kind, "think");
  assert.equal(event.toolCall.title, "package.json");
});

test("OpenCode mixed thinking and content updates preserve both tracks in order", () => {
  const mapped = mapSessionUpdateNotificationBatch(
    {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "session-opencode-mixed-thinking",
        update: {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-opencode-mixed-thinking",
          content: [
            { type: "thinking", thinking: "先检查文件" },
            { type: "text", text: "文件检查完成" },
          ],
        },
      },
    },
    { providerId: "opencode" },
  );

  assert.ok(mapped);
  // Both thinking and text are now emitted as message events
  assert.deepEqual(
    mapped.events.map((event) => event.type),
    ["message", "message"],
  );
  const thinking = mapped.events[0];
  assert.equal(thinking?.type, "message");
  if (thinking?.type !== "message") {
    throw new Error("Expected the Thinking message first");
  }
  assert.equal(thinking.message.contentKind, "thought");
  assert.equal(thinking.message.text, "先检查文件");
  const message = mapped.events[1];
  assert.equal(message?.type, "message");
  if (message?.type !== "message") {
    throw new Error("Expected the assistant message event");
  }
  assert.equal(message.message.text, "文件检查完成");
});
