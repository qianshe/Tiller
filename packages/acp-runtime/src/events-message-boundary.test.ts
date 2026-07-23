import assert from "node:assert/strict";
import test from "node:test";
import { mapSessionUpdateNotificationBatch } from "./events.js";

function agentMessageChunkPayload(sessionId: string, messageId: string, text: string) {
  return {
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        messageId,
        content: { type: "text", text },
      },
    },
  };
}

test("mapSessionUpdateNotificationBatch preserves provider messageId on agent_message_chunk", () => {
  const mapped = mapSessionUpdateNotificationBatch(
    agentMessageChunkPayload("session-1", "msg_opencode_a", "## Objective\n- summary"),
    {},
  );
  assert.ok(mapped);
  assert.equal(mapped?.events.length, 1);
  const event = mapped?.events[0];
  assert.equal(event?.type, "message");
  assert.equal(
    event?.type === "message" ? event.message.id : undefined,
    "msg_opencode_a",
  );
});

test("mapSessionUpdateNotificationBatch leaves streaming undefined for raw agent_message_chunk", () => {
  const mapped = mapSessionUpdateNotificationBatch(
    agentMessageChunkPayload("session-1", "msg_opencode_a", "## Objective\n- summary"),
    {},
  );
  const event = mapped?.events[0];
  assert.equal(event?.type, "message");
  assert.equal(
    event?.type === "message" ? event.message.streaming : undefined,
    undefined,
  );
});

test("mapSessionUpdateNotificationBatch keeps distinct provider messageIds separate", () => {
  const a = mapSessionUpdateNotificationBatch(
    agentMessageChunkPayload("session-1", "msg_summary", "summary text"),
    {},
  );
  const b = mapSessionUpdateNotificationBatch(
    agentMessageChunkPayload("session-1", "msg_reply", "reply text"),
    {},
  );
  assert.notEqual(
    a?.events[0]?.type === "message" ? a.events[0].message.id : undefined,
    b?.events[0]?.type === "message" ? b.events[0].message.id : undefined,
  );
});

test("mapSessionUpdateNotificationBatch does not project OpenCode compaction summary as compaction via shared fallback", () => {
  const summary = [
    "## Objective",
    "- Continue the repository cleanup task.",
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
    "- packages/acp-runtime/src/events.ts",
  ].join("\n");
  const mapped = mapSessionUpdateNotificationBatch(
    agentMessageChunkPayload("session-1", "msg_opencode_summary", summary),
    {},
  );
  const event = mapped?.events[0];
  assert.equal(event?.type, "message");
  assert.equal(
    mapped?.events.some((candidate) => candidate.type === "compaction"),
    false,
  );
});
