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
  assert.match(html, /next prompt/);
  assert.match(html, /mission-prompt-queue[^\"]*p-1/);
  assert.match(html, /mission-queued-prompt-text[^\"]*text-xs/);
  assert.match(html, /h-6/);
  assert.doesNotMatch(html, /<input/);
  assert.doesNotMatch(html, /<textarea/);
  assert.match(html, /编辑/);
  assert.doesNotMatch(html, />保存</);
  assert.match(html, /删除/);
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
