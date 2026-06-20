import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionQueuedPrompts } from "./queued-prompts";

test("MissionQueuedPrompts renders queued items and actions", () => {
  const html = renderToStaticMarkup(
    createElement(MissionQueuedPrompts, {
      queue: {
        sessionId: "session-1",
        queued: [
          {
            id: "queue-1",
            sessionId: "session-1",
            text: "next prompt",
            clientMessageId: "client-1",
            createdAt: "2026-05-15T00:00:00.000Z",
            updatedAt: "2026-05-15T00:00:00.000Z",
            status: "queued",
          },
        ],
      },
      onUpdate: () => undefined,
      onDelete: () => undefined,
    }),
  );

  assert.match(html, /Prompt 队列/);
  assert.match(html, /data-prompt-queue-details/);
  assert.match(html, /data-prompt-queue-summary/);
  assert.match(html, /next prompt/);
  assert.match(html, /mission-prompt-queue[^\"]*p-1/);
  assert.match(html, /mission-queued-prompt-text[^\"]*text-xs/);
  assert.match(html, /aria-label="直接发送队列 Prompt（待接入）"/);
  assert.match(html, /aria-label="编辑队列 Prompt"/);
  assert.match(html, /aria-label="删除队列 Prompt"/);
  assert.match(html, /disabled=""/);
  assert.match(html, /size-3/);
  assert.doesNotMatch(html, /排队 #/);
  assert.doesNotMatch(html, /ACP 完成当前 Prompt 后自动发送队首/);
  assert.doesNotMatch(html, /<input/);
  assert.doesNotMatch(html, /<textarea/);
  assert.doesNotMatch(html, />编辑</);
  assert.doesNotMatch(html, />直接发送</);
  assert.doesNotMatch(html, />保存</);
  assert.doesNotMatch(html, />删除</);
});

test("MissionQueuedPrompts hides in-flight prompts when nothing is queued", () => {
  const html = renderToStaticMarkup(
    createElement(MissionQueuedPrompts, {
      queue: {
        sessionId: "session-1",
        inFlight: {
          id: "queue-0",
          sessionId: "session-1",
          text: "direct prompt",
          clientMessageId: "client-0",
          createdAt: "2026-05-15T00:00:00.000Z",
          updatedAt: "2026-05-15T00:00:00.000Z",
          status: "sending",
        },
        queued: [],
      },
      onUpdate: () => undefined,
      onDelete: () => undefined,
    }),
  );

  assert.equal(html, "");
});

test("MissionQueuedPrompts floating placement keeps layout without shadow", () => {
  const html = renderToStaticMarkup(
    createElement(MissionQueuedPrompts, {
      queue: {
        sessionId: "session-1",
        queued: [
          {
            id: "queue-1",
            sessionId: "session-1",
            text: "next prompt",
            clientMessageId: "client-1",
            createdAt: "2026-05-15T00:00:00.000Z",
            updatedAt: "2026-05-15T00:00:00.000Z",
            status: "queued",
          },
        ],
      },
      placement: "floating",
      onUpdate: () => undefined,
      onDelete: () => undefined,
    }),
  );

  assert.match(html, /data-prompt-queue-placement="floating"/);
  assert.match(html, /rounded-\[8px\]/);
  assert.match(html, /border-border-ghost/);
  assert.doesNotMatch(html, /shadow-\[0_-14px_32px_rgb\(0_0_0\/0\.18\)\]/);
});
