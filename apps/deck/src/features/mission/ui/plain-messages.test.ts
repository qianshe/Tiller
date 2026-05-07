import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentMessage } from "@tiller/shared";
import {
  DEFAULT_VISIBLE_MESSAGE_LIMIT,
  PlainMessages,
  resolveVisiblePlainMessages,
} from "./plain-messages.js";

function message(index: number): AgentMessage {
  return {
    id: `m-${index}`,
    role: index % 2 === 0 ? "assistant" : "user",
    text: `message ${index}`,
    timestamp: `2026-05-06T00:${String(index).padStart(2, "0")}:00.000Z`,
  };
}

test("plain message timeline initially renders the latest 20 messages", () => {
  const messages = Array.from({ length: 25 }, (_, index) => message(index + 1));

  assert.deepEqual(
    resolveVisiblePlainMessages(messages, DEFAULT_VISIBLE_MESSAGE_LIMIT).map(
      (item) => item.id,
    ),
    messages.slice(-20).map((item) => item.id),
  );
});

test("plain message timeline can reveal older loaded messages", () => {
  const messages = Array.from({ length: 45 }, (_, index) => message(index + 1));

  assert.deepEqual(
    resolveVisiblePlainMessages(messages, DEFAULT_VISIBLE_MESSAGE_LIMIT * 2).map(
      (item) => item.id,
    ),
    messages.slice(-40).map((item) => item.id),
  );
});

test("plain message timeline uses chronological latest messages from newest-first pages", () => {
  const messages = Array.from({ length: 25 }, (_, index) => message(index + 1));
  const newestFirstMessages = [...messages].reverse();

  assert.deepEqual(
    resolveVisiblePlainMessages(newestFirstMessages, DEFAULT_VISIBLE_MESSAGE_LIMIT).map(
      (item) => item.id,
    ),
    messages.slice(-20).map((item) => item.id),
  );
});

test("plain message timeline coalesces runtime assistant chunks before windowing", () => {
  const chunks: AgentMessage[] = "具体消息内容".split("").map((text, index) => ({
    id: `019dfc94-a921-7112-8980-8d57cd537787-msg-${(1000 + index).toString(36)}`,
    role: "assistant",
    text,
    timestamp: `2026-05-06T01:00:${String(index).padStart(2, "0")}.000Z`,
  }));

  assert.deepEqual(resolveVisiblePlainMessages(chunks).map((item) => item.text), [
    "具体消息内容",
  ]);
});

test("plain message timeline splits cumulative assistant chunks at tool call boundaries", () => {
  const chunks: AgentMessage[] = [
    {
      id: "019dfc94-a921-7112-8980-8d57cd537787-msg-a",
      role: "assistant",
      text: "先说明",
      timestamp: "2026-05-06T01:10:01.000Z",
    },
    {
      id: "019dfc94-a921-7112-8980-8d57cd537787-msg-b",
      role: "assistant",
      text: "先说明再继续",
      timestamp: "2026-05-06T01:10:03.000Z",
    },
  ];

  assert.deepEqual(
    resolveVisiblePlainMessages(chunks, DEFAULT_VISIBLE_MESSAGE_LIMIT, [
      "2026-05-06T01:10:02.000Z",
    ]).map((item) => item.text),
    ["先说明", "再继续"],
  );
});

test("plain message timeline renders a divider where tool calls split assistant chunks", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "019dfc94-a921-7112-8980-8d57cd537787-msg-a",
          role: "assistant",
          text: "先说明",
          timestamp: "2026-05-06T01:10:01.000Z",
        },
        {
          id: "019dfc94-a921-7112-8980-8d57cd537787-msg-b",
          role: "assistant",
          text: "先说明再继续",
          timestamp: "2026-05-06T01:10:03.000Z",
        },
      ],
      boundaryTimestamps: ["2026-05-06T01:10:02.000Z"],
      emptyText: "empty",
      assistantLabel: "CODEX",
      roleLabels: { user: "你", assistant: "CODEX", system: "系统" },
      expandedMessageIds: new Set<string>(),
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.match(html, /mission-message-tool-boundary/);
  assert.match(html, />---</);
});

test("user messages render as plain text and keep the collapse affordance", () => {
  const longUserMessage = [
    "# 标题",
    "| 列 1 | 列 2 |",
    "| --- | --- |",
    "| 很长的文本 | 仍然应该按纯文本展示 |",
    "第五行内容",
    "第六行内容",
  ].join("\n");

  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "user-1",
          role: "user",
          text: longUserMessage,
          timestamp: "2026-05-06T02:00:00.000Z",
        },
      ],
      emptyText: "empty",
      assistantLabel: "CODEX",
      roleLabels: { user: "你", assistant: "CODEX", system: "系统" },
      expandedMessageIds: new Set<string>(),
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.match(html, /plain-message-text/);
  assert.match(html, /plain-message-text-collapsed/);
  assert.match(html, /展开完整消息/);
  assert.match(html, /很长的文本/);
  assert.doesNotMatch(html, /markdown-message/);
  assert.doesNotMatch(html, /<table>/);
});
