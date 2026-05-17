import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlainMessages } from "./plain-messages.js";

test("plain messages renders thinking tool calls in the conversation timeline", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "先给一个结论。",
          timestamp: "2026-05-17T10:00:00.000Z",
        },
      ],
      thinkingToolCalls: [
        {
          id: "think-1",
          kind: "think",
          title: "Tab 替换边界探索",
          status: "completed",
          output: "完整 Thinking 内容",
          timestamp: "2026-05-17T10:00:01.000Z",
          updatedAt: "2026-05-17T10:00:02.000Z",
        },
      ],
      emptyText: "等待回复",
      assistantLabel: "Assistant",
      roleLabels: { assistant: "Assistant", system: "System", user: "User" },
      expandedMessageIds: new Set(),
      historyState: { hasMore: false, loading: false },
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.match(html, /Assistant/);
  assert.match(html, /先给一个结论。/);
  assert.match(html, /Thinking/);
  assert.match(html, /Tab 替换边界探索/);
  assert.match(html, /完整 Thinking 内容/);
});

test("plain messages avoids duplicated generic thinking titles", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [],
      thinkingToolCalls: [
        {
          id: "think-1",
          kind: "think",
          title: "Thinking",
          status: "completed",
          output: "需要先定位数据链路",
          timestamp: "2026-05-17T10:00:01.000Z",
          updatedAt: "2026-05-17T10:00:02.000Z",
        },
      ],
      emptyText: "等待回复",
      assistantLabel: "Assistant",
      roleLabels: { assistant: "Assistant", system: "System", user: "User" },
      expandedMessageIds: new Set(),
      historyState: { hasMore: false, loading: false },
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.match(html, /Thinking/);
  assert.doesNotMatch(html, /Thinking · Thinking/);
});
