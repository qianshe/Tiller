import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentPromptContent } from "@tiller/shared";
import {
  pendingInitialPromptMessageId,
  pendingPromptImages,
  replaceInitialMessageHistory,
} from "./session-message-history.js";

function message(overrides: Partial<AgentMessage> & Pick<AgentMessage, "id" | "role" | "text">): AgentMessage {
  return {
    timestamp: "2026-05-29T00:00:00.000Z",
    ...overrides,
  } as AgentMessage;
}

test("pendingInitialPromptMessageId creates the deterministic pending user message id", () => {
  assert.equal(pendingInitialPromptMessageId("session-1"), "session-1-user-pending");
});

test("pendingPromptImages keeps only prompt image content", () => {
  const content: AgentPromptContent[] = [
    { type: "text", text: "hello" },
    { type: "image", data: "abc", mimeType: "image/png" },
  ];

  assert.deepEqual(pendingPromptImages(content), [content[1]]);
  assert.deepEqual(pendingPromptImages(undefined), []);
});

test("replaceInitialMessageHistory preserves local user attachments when loaded history represents the same prompt", () => {
  const current = [
    message({
      id: "local-user",
      role: "user",
      text: "build it",
      timestamp: "2026-05-29T00:00:01.000Z",
      attachments: [{ type: "image", data: "abc", mimeType: "image/png" }],
    }),
  ];
  const loaded = [
    message({
      id: "provider-user",
      role: "user",
      text: " build it ",
      timestamp: "2026-05-29T00:00:00.000Z",
    }),
    message({
      id: "assistant-1",
      role: "assistant",
      text: "done",
      timestamp: "2026-05-29T00:00:02.000Z",
    }),
  ];

  const merged = replaceInitialMessageHistory(current, loaded);

  assert.equal(merged[0]?.id, "local-user");
  assert.equal(merged[0]?.timestamp, "2026-05-29T00:00:01.000Z");
  assert.deepEqual(merged[0]?.attachments, current[0]?.attachments);
  assert.deepEqual(merged.map((item) => item.id), ["local-user", "assistant-1"]);
});

test("replaceInitialMessageHistory keeps live streaming and newer local messages not represented by loaded history", () => {
  const current = [
    message({
      id: "loaded-user",
      role: "user",
      text: "prompt",
      timestamp: "2026-05-29T00:00:00.000Z",
    }),
    message({
      id: "streaming-assistant",
      role: "assistant",
      text: "still streaming",
      timestamp: "2026-05-29T00:00:03.000Z",
      streaming: true,
    }),
    message({
      id: "local-newer",
      role: "assistant",
      text: "newer local chunk",
      timestamp: "2026-05-29T00:00:04.000Z",
    }),
  ];
  const loaded = [
    message({
      id: "loaded-user",
      role: "user",
      text: "prompt",
      timestamp: "2026-05-29T00:00:00.000Z",
    }),
    message({
      id: "loaded-assistant",
      role: "assistant",
      text: "loaded",
      timestamp: "2026-05-29T00:00:02.000Z",
    }),
  ];

  const merged = replaceInitialMessageHistory(current, loaded);

  assert.deepEqual(merged.map((item) => item.id), [
    "loaded-user",
    "loaded-assistant",
    "streaming-assistant",
    "local-newer",
  ]);
});

test("replaceInitialMessageHistory keeps earlier repeated local user prompts when loaded history represents one copy", () => {
  const current = [
    message({
      id: "local-user-1",
      role: "user",
      text: "继续",
      timestamp: "2026-05-29T10:00:00.000Z",
    }),
    message({
      id: "local-user-2",
      role: "user",
      text: "继续",
      timestamp: "2026-05-29T10:00:03.000Z",
    }),
  ];
  const loaded = [
    message({
      id: "provider-user-2",
      role: "user",
      text: "继续",
      timestamp: "2026-05-29T10:00:03.000Z",
    }),
  ];

  const merged = replaceInitialMessageHistory(current, loaded);

  assert.deepEqual(
    merged.map((item) => item.id),
    ["local-user-1", "provider-user-2"],
  );
});
