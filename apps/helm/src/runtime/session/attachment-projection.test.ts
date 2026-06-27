import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, AgentPromptContent } from "@tiller/shared";
import { persistMessageImageAttachments, persistPromptImageAttachments } from "./attachment-projection.js";

test("persistPromptImageAttachments stores inline images and returns reference-only content", () => {
  const storedInputs: unknown[] = [];
  const content: AgentPromptContent[] = [
    { type: "text", text: "hello" },
    {
      type: "image",
      data: Buffer.from("png").toString("base64"),
      mimeType: "image/png",
      name: "screen.png",
    },
  ];

  const projected = persistPromptImageAttachments({
    sessionId: "session-1",
    messageId: "message-1",
    content,
    attachments: {
      put: (input) => {
        storedInputs.push(input);
        return {
          id: "attachment-1",
          sessionId: input.sessionId,
          messageId: input.messageId,
          mimeType: input.mimeType,
          name: input.name,
          sha256: "sha256",
          byteSize: 3,
          storageKey: "storage-key",
          uri: "/api/sessions/session-1/attachments/attachment-1",
          createdAt: "2026-06-01T00:00:00.000Z",
        };
      },
      get: () => undefined,
      listForMessage: () => [],
      readBytes: () => undefined,
      removeSession: () => undefined,
    },
  });

  assert.deepEqual(storedInputs, [
    {
      sessionId: "session-1",
      messageId: "message-1",
      mimeType: "image/png",
      name: "screen.png",
      dataBase64: Buffer.from("png").toString("base64"),
    },
  ]);
  assert.deepEqual(projected, [
    { type: "text", text: "hello" },
    {
      type: "image",
      mimeType: "image/png",
      name: "screen.png",
      uri: "/api/sessions/session-1/attachments/attachment-1",
      attachmentId: "attachment-1",
      sha256: "sha256",
      byteSize: 3,
    },
  ]);
});

test("persistPromptImageAttachments keeps reference-only images unchanged", () => {
  const content: AgentPromptContent[] = [
    {
      type: "image",
      mimeType: "image/png",
      uri: "/api/sessions/session-1/attachments/attachment-1",
      attachmentId: "attachment-1",
    },
  ];

  const projected = persistPromptImageAttachments({
    sessionId: "session-1",
    messageId: "message-1",
    content,
    attachments: {
      put: () => {
        throw new Error("put should not be called");
      },
      get: () => undefined,
      listForMessage: () => [],
      readBytes: () => undefined,
      removeSession: () => undefined,
    },
  });

  assert.deepEqual(projected, content);
});

test("persistMessageImageAttachments projects message attachments without changing the message text", () => {
  const message: AgentMessage = {
    id: "message-1",
    role: "user",
    text: "hello",
    timestamp: "2026-06-01T00:00:00.000Z",
    attachments: [
      {
        type: "image",
        data: Buffer.from("png").toString("base64"),
        mimeType: "image/png",
      },
    ],
  };

  const projected = persistMessageImageAttachments({
    sessionId: "session-1",
    message,
    attachments: {
      put: (input) => ({
        id: "attachment-1",
        sessionId: input.sessionId,
        messageId: input.messageId,
        mimeType: input.mimeType,
        sha256: "sha256",
        byteSize: 3,
        storageKey: "storage-key",
        uri: "/api/sessions/session-1/attachments/attachment-1",
        createdAt: "2026-06-01T00:00:00.000Z",
      }),
      get: () => undefined,
      listForMessage: () => [],
      readBytes: () => undefined,
      removeSession: () => undefined,
    },
  });

  assert.equal(projected.id, "message-1");
  assert.equal(projected.text, "hello");
  assert.deepEqual(projected.attachments, [
    {
      type: "image",
      mimeType: "image/png",
      uri: "/api/sessions/session-1/attachments/attachment-1",
      attachmentId: "attachment-1",
      sha256: "sha256",
      byteSize: 3,
    },
  ]);
});
