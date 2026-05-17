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

test("plain messages merges adjacent thinking tool calls in the conversation timeline", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "工具前说明。",
          timestamp: "2026-05-17T10:00:00.000Z",
        },
        {
          id: "assistant-2",
          role: "assistant",
          text: "工具后说明。",
          timestamp: "2026-05-17T10:00:04.000Z",
        },
      ],
      thinkingToolCalls: [
        {
          id: "think-1",
          kind: "think",
          title: "Thinking",
          status: "completed",
          output: "第一段 Thinking",
          timestamp: "2026-05-17T10:00:01.000Z",
          updatedAt: "2026-05-17T10:00:01.000Z",
        },
        {
          id: "think-2",
          kind: "think",
          title: "Thinking",
          status: "completed",
          output: "第二段 Thinking",
          timestamp: "2026-05-17T10:00:02.000Z",
          updatedAt: "2026-05-17T10:00:02.000Z",
        },
        {
          id: "think-3",
          kind: "think",
          title: "Thinking",
          status: "completed",
          output: "第三段 Thinking",
          timestamp: "2026-05-17T10:00:03.000Z",
          updatedAt: "2026-05-17T10:00:03.000Z",
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

  assert.equal(html.match(/plain-thinking/g)?.length, 1);
  assert.match(html, /第一段 Thinking/);
  assert.match(html, /第二段 Thinking/);
  assert.match(html, /第三段 Thinking/);
});

test("plain messages hides local command wrappers and model switch stdout", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "cmd-name",
          role: "user",
          text: "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>",
          timestamp: "2026-05-17T10:00:00.000Z",
        },
        {
          id: "cmd-caveat",
          role: "user",
          text: "<local-command-caveat>Caveat: generated local command metadata</local-command-caveat>",
          timestamp: "2026-05-17T10:00:01.000Z",
        },
        {
          id: "cmd-model-stdout",
          role: "user",
          text: "<local-command-stdout>Set model to opus (claude-opus-4-7)</local-command-stdout>",
          timestamp: "2026-05-17T10:00:02.000Z",
        },
        {
          id: "cmd-stdout",
          role: "user",
          text: "<local-command-stdout>Command finished</local-command-stdout>",
          timestamp: "2026-05-17T10:00:03.000Z",
        },
      ],
      thinkingToolCalls: [],
      emptyText: "等待回复",
      assistantLabel: "Assistant",
      roleLabels: { assistant: "Assistant", system: "System", user: "User" },
      expandedMessageIds: new Set(),
      historyState: { hasMore: false, loading: false },
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.match(html, /Command finished/);
  assert.doesNotMatch(html, /Set model to opus/);
  assert.doesNotMatch(html, /command-name/);
  assert.doesNotMatch(html, /local-command-caveat/);
  assert.doesNotMatch(html, /command-args/);
});
