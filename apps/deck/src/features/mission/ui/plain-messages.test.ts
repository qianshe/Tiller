import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentMessage } from "@tiller/shared";
import {
  DEFAULT_VISIBLE_MESSAGE_LIMIT,
  PlainMessages,
  resolveLoadMoreMessagesLabel,
  resolvePlainMessageRenderItems,
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

test("plain message render keys stay unique for duplicate provider ids", () => {
  const duplicateMessages: AgentMessage[] = [
    { ...message(1), id: "session-1-msg-s0", text: "第一段" },
    { ...message(2), id: "session-1-msg-s0", text: "第二段" },
    { ...message(3), id: "session-1-msg-s1", text: "第三段" },
  ];

  assert.deepEqual(
    resolvePlainMessageRenderItems(duplicateMessages).map((item) => item.renderKey),
    ["session-1-msg-s0", "session-1-msg-s0#1", "session-1-msg-s1"],
  );
});

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

test("plain message load-more label reports visible and loaded counts", () => {
  assert.equal(
    resolveLoadMoreMessagesLabel({
      hasMoreHistory: true,
      loading: false,
      pageSize: DEFAULT_VISIBLE_MESSAGE_LIMIT,
      totalLoaded: 45,
      visible: 20,
    }),
    "查看更多（已显示 20/45，继续加载每次最多 20 条）",
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

test("plain message timeline filters OpenCode prompt wrapper echoes", () => {
  const messages: AgentMessage[] = [
    {
      id: "wrapper-1",
      role: "user",
      text: "[analyze-mode]\nANALYSIS MODE. Gather context before diving deep:",
      timestamp: "2026-05-06T01:05:01.000Z",
    },
    {
      id: "wrapper-2",
      role: "user",
      text: "SYNTHESIZE findings before proceeding.",
      timestamp: "2026-05-06T01:05:02.000Z",
    },
    {
      id: "wrapper-3",
      role: "user",
      text: "---",
      timestamp: "2026-05-06T01:05:03.000Z",
    },
    {
      id: "real-user",
      role: "user",
      text: "帮我分析下现在项目的分支是什么？",
      timestamp: "2026-05-06T01:05:04.000Z",
    },
  ];

  assert.deepEqual(resolveVisiblePlainMessages(messages).map((item) => item.text), [
    "帮我分析下现在项目的分支是什么？",
  ]);
});

test("plain message timeline filters whole OpenCode wrapper echo messages", () => {
  const wrappedPrompt = [
    "[analyze-mode]",
    "ANALYSIS MODE. Gather context before diving deep:",
    "SYNTHESIZE findings before proceeding.",
    "---",
    "MANDATORY delegate_task params: ALWAYS include load_skills=[] and run_in_background when calling delegate_task.",
    "---",
    "帮我分析下现在项目的分支是什么？",
  ].join("\n");

  assert.deepEqual(
    resolveVisiblePlainMessages([
      {
        id: "real-user",
        role: "user",
        text: "帮我分析下现在项目的分支是什么？",
        timestamp: "2026-05-06T01:05:00.000Z",
      },
      {
        id: "wrapper-whole",
        role: "user",
        text: wrappedPrompt,
        timestamp: "2026-05-06T01:05:01.000Z",
      },
    ]).map((item) => item.text),
    ["帮我分析下现在项目的分支是什么？"],
  );
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

test("plain message timeline renders assistant segment dots for tool-boundary splits", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "019dfc94-a921-7112-8980-8d57cd537787-msg-a",
          role: "assistant",
          text: "第一段",
          timestamp: "2026-05-06T01:10:01.000Z",
        },
        {
          id: "019dfc94-a921-7112-8980-8d57cd537787-msg-b",
          role: "assistant",
          text: "第一段第二段",
          timestamp: "2026-05-06T01:10:03.000Z",
        },
        {
          id: "019dfc94-a921-7112-8980-8d57cd537787-msg-c",
          role: "assistant",
          text: "第一段第二段第三段",
          timestamp: "2026-05-06T01:10:05.000Z",
        },
      ],
      boundaryTimestamps: [
        "2026-05-06T01:10:02.000Z",
        "2026-05-06T01:10:04.000Z",
      ],
      emptyText: "empty",
      assistantLabel: "CODEX",
      roleLabels: { user: "你", assistant: "CODEX", system: "系统" },
      expandedMessageIds: new Set<string>(),
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.equal(html.match(/plain-assistant-segment-dot/g)?.length, 3);
  assert.equal(html.match(/plain-message-role[^>]*sr-only/g)?.length, 2);
  assert.match(html, /第一段/);
  assert.match(html, /第二段/);
  assert.match(html, /第三段/);
});

test("plain message timeline does not render visual tool-boundary dividers", () => {
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

  assert.doesNotMatch(html, /mission-message-tool-boundary/);
  assert.doesNotMatch(html, />---/);
});

test("assistant phase notes render as ordinary markdown instead of structured cards", () => {
  const assistantText = [
    "[⚔️金] 验证",
    "**验证**：已定位会话栏问题。",
    "普通补充说明。",
  ].join("\n\n");

  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "assistant-markdown-phase",
          role: "assistant",
          text: assistantText,
          timestamp: "2026-05-06T01:30:00.000Z",
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

  assert.match(html, /markdown-message/);
  assert.match(html, /\[⚔️金\] 验证/);
  assert.match(html, /<strong>验证<\/strong>：已定位会话栏问题/);
  assert.doesNotMatch(html, /structured-assistant-message/);
  assert.doesNotMatch(html, /structured-message-phase/);
  assert.doesNotMatch(html, /Assistant response/);
});

test("assistant non-structured messages keep markdown fallback", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "assistant-markdown",
          role: "assistant",
          text: "这是一段普通回复，包含 **强调** 但没有结构字段。",
          timestamp: "2026-05-06T01:40:00.000Z",
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

  assert.match(html, /markdown-message/);
  assert.doesNotMatch(html, /structured-assistant-message/);
});

test("streaming assistant messages render as lightweight plain text", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "assistant-streaming",
          role: "assistant",
          text: "| A | B |\n| - | - |\n| 1 | 2 |",
          timestamp: "2026-05-12T00:00:00.000Z",
          streaming: true,
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

  assert.match(html, /plain-message-streaming/);
  assert.match(html, /plain-message-text/);
  assert.match(html, /\| A \| B \|/);
  assert.doesNotMatch(html, /markdown-message/);
  assert.doesNotMatch(html, /<table/);
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
  assert.doesNotMatch(html, />你<\/span>/);
  assert.doesNotMatch(html, /plain-assistant-segment-dot/);
});
