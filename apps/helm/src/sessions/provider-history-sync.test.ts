import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@tiller/shared";
import { mergeAuthoritativeMessagesWithLocalUserPrompts } from "./provider-history-sync.js";

test("mergeAuthoritativeMessagesWithLocalUserPrompts keeps local user prompts omitted by ACP replay", () => {
  const localUser: AgentMessage = {
    id: "local-user",
    role: "user",
    text: "本地用户提示",
    timestamp: "2026-06-08T01:00:00.000Z",
  };
  const assistant: AgentMessage = {
    id: "assistant",
    role: "assistant",
    text: "ACP 回复",
    timestamp: "2026-06-08T01:00:01.000Z",
  };

  assert.deepEqual(
    mergeAuthoritativeMessagesWithLocalUserPrompts([localUser], [assistant]).map((message) => message.id),
    ["local-user", "assistant"],
  );
});

test("mergeAuthoritativeMessagesWithLocalUserPrompts preserves local user attachments", () => {
  const localUser: AgentMessage = {
    id: "local-user",
    role: "user",
    text: "带图提示",
    timestamp: "2026-06-08T01:00:00.000Z",
    attachments: [
      {
        type: "image",
        mimeType: "image/png",
        data: "image-data",
      },
    ],
  };
  const acpUser: AgentMessage = {
    id: "acp-user",
    role: "user",
    text: "带图提示",
    timestamp: "2026-06-08T01:00:02.000Z",
  };

  const merged = mergeAuthoritativeMessagesWithLocalUserPrompts([localUser], [acpUser]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, "local-user");
  assert.equal(merged[0]?.timestamp, "2026-06-08T01:00:00.000Z");
  assert.deepEqual(merged[0]?.attachments, localUser.attachments);
});

test("mergeAuthoritativeMessagesWithLocalUserPrompts does not duplicate represented user prompts", () => {
  const localUser: AgentMessage = {
    id: "local-user",
    role: "user",
    text: "同一个提示",
    timestamp: "2026-06-08T01:00:00.000Z",
  };
  const acpUser: AgentMessage = {
    id: "acp-user",
    role: "user",
    text: "同一个提示",
    timestamp: "2026-06-08T01:00:01.000Z",
  };

  assert.deepEqual(
    mergeAuthoritativeMessagesWithLocalUserPrompts([localUser], [acpUser]).map((message) => message.id),
    ["acp-user"],
  );
});
