import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionTimelineEntry } from "@tiller/shared";
import { PlainMessages } from "./plain-messages.js";

function renderPlainMessages(props: Partial<Parameters<typeof PlainMessages>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [],
      thinkingToolCalls: [],
      toolCalls: [],
      emptyText: "等待回复",
      assistantLabel: "Assistant",
      roleLabels: { assistant: "Assistant", system: "System", user: "User" },
      expandedMessageIds: new Set<string>(),
      historyState: { hasMore: false, loading: false },
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
      ...props,
    }),
  );
}

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
      expandedMessageIds: new Set<string>(),
      historyState: { hasMore: false, loading: false },
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.match(html, /Assistant/);
  assert.match(html, /先给一个结论。/);
  assert.match(html, /Thinking/);
  assert.doesNotMatch(html, /Thinking · Tab 替换边界探索/);
  assert.match(html, /完整 Thinking 内容/);
  assert.match(html, /plain-thinking-row[^"]*grid-cols-\[0\.75rem_minmax\(0,1fr\)\]/);
  assert.match(html, /plain-thinking[^"]*rounded-\[8px\][^"]*bg-surface-sunken\/55/);
  assert.match(html, /plain-thinking-content[^"]*border-l/);
  assert.match(html, /aria-label="展开 Thinking"/);
  assert.doesNotMatch(html, /plain-thinking[^"]*rounded-xl/);
  assert.doesNotMatch(html, /plain-thinking[^"]*bg-surface-elevated/);
});

test("plain messages can render unified timeline entries with ordered assistant chunks", () => {
  const timelineItems: SessionTimelineEntry[] = [
    {
      id: "user-1",
      kind: "user_message",
      message: {
        id: "user-1",
        role: "user",
        text: "开始",
        timestamp: "2026-05-17T10:00:00.000Z",
        timelineSequence: 1,
      },
      timestamp: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:00.000Z",
      timelineSequence: 1,
    },
    {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-1:thinking",
          kind: "thinking",
          text: "先思考",
          title: "Thinking",
          status: "completed",
          timestamp: "2026-05-17T10:00:01.000Z",
          updatedAt: "2026-05-17T10:00:01.000Z",
          timelineSequence: 2,
        },
        {
          id: "assistant-1:content",
          kind: "content",
          text: "最终回答",
          timestamp: "2026-05-17T10:00:02.000Z",
          timelineSequence: 3,
        },
      ],
      timestamp: "2026-05-17T10:00:01.000Z",
      updatedAt: "2026-05-17T10:00:02.000Z",
      timelineSequence: 2,
    },
  ];

  const html = renderPlainMessages({
    timelineItems,
    items: [],
    thinkingToolCalls: [],
    toolCalls: [],
  } as any);

  const userIndex = html.indexOf("开始");
  const thinkingIndex = html.indexOf("先思考");
  const answerIndex = html.indexOf("最终回答");
  assert.ok(userIndex >= 0);
  assert.ok(thinkingIndex > userIndex);
  assert.ok(answerIndex > thinkingIndex);
});

test("plain messages keeps loaded content visible when timeline has many tool and thinking entries", () => {
  const timelineItems: SessionTimelineEntry[] = [
    {
      id: "assistant-intro",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-intro:content",
          kind: "content",
          text: "开头说明应当仍然可见",
          timestamp: "2026-05-17T10:00:00.000Z",
          timelineSequence: 1,
        },
      ],
      timestamp: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:00.000Z",
      timelineSequence: 1,
    },
    ...Array.from({ length: 24 }, (_, index) => {
      const sequence = index * 2 + 2;
      return [
        {
          id: `tool-${index}`,
          kind: "tool_call" as const,
          toolCall: {
            id: `tool-${index}`,
            kind: "read" as const,
            title: `Read ${index}`,
            status: "completed" as const,
            timestamp: `2026-05-17T10:00:${String(sequence).padStart(2, "0")}.000Z`,
            updatedAt: `2026-05-17T10:00:${String(sequence).padStart(2, "0")}.000Z`,
            timelineSequence: sequence,
          },
          timestamp: `2026-05-17T10:00:${String(sequence).padStart(2, "0")}.000Z`,
          updatedAt: `2026-05-17T10:00:${String(sequence).padStart(2, "0")}.000Z`,
          timelineSequence: sequence,
        },
        {
          id: `thinking-${index}`,
          kind: "assistant_message" as const,
          chunks: [
            {
              id: `thinking-${index}:chunk`,
              kind: "thinking" as const,
              text: `Thinking ${index}`,
              title: "Thinking",
              status: "completed" as const,
              timestamp: `2026-05-17T10:00:${String(sequence + 1).padStart(2, "0")}.000Z`,
              updatedAt: `2026-05-17T10:00:${String(sequence + 1).padStart(2, "0")}.000Z`,
              timelineSequence: sequence + 1,
            },
          ],
          timestamp: `2026-05-17T10:00:${String(sequence + 1).padStart(2, "0")}.000Z`,
          updatedAt: `2026-05-17T10:00:${String(sequence + 1).padStart(2, "0")}.000Z`,
          timelineSequence: sequence + 1,
        },
      ];
    }).flat(),
    {
      id: "assistant-final",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-final:content",
          kind: "content",
          text: "最终汇总",
          timestamp: "2026-05-17T10:01:00.000Z",
          timelineSequence: 99,
        },
      ],
      timestamp: "2026-05-17T10:01:00.000Z",
      updatedAt: "2026-05-17T10:01:00.000Z",
      timelineSequence: 99,
    },
  ];

  const html = renderPlainMessages({ timelineItems });

  assert.match(html, /开头说明应当仍然可见/);
  assert.match(html, /最终汇总/);
});

test("plain messages reveals leading timeline details when all loaded messages fit", () => {
  const timelineItems: SessionTimelineEntry[] = [
    {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-1:thinking",
          kind: "thinking",
          text: "开头 Thinking 不应被窗口裁掉",
          title: "Thinking",
          status: "completed",
          timestamp: "2026-05-17T10:00:00.000Z",
          updatedAt: "2026-05-17T10:00:00.000Z",
          timelineSequence: 1,
        },
        {
          id: "assistant-1:content",
          kind: "content",
          text: "只有一条正文时应展示完整已加载条目",
          timestamp: "2026-05-17T10:00:01.000Z",
          timelineSequence: 2,
        },
      ],
      timestamp: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:01.000Z",
      timelineSequence: 1,
    },
  ];

  const html = renderPlainMessages({ timelineItems });

  assert.match(html, /开头 Thinking 不应被窗口裁掉/);
  assert.match(html, /只有一条正文时应展示完整已加载条目/);
  assert.doesNotMatch(html, />查看更多<\/button>/);
});

test("plain messages counts coalesced provider paragraphs as one green-dot message block", () => {
  const timelineItems: SessionTimelineEntry[] = [
    {
      id: "user-latest",
      kind: "user_message",
      message: {
        id: "user-latest",
        role: "user",
        text: "继续",
        timestamp: "2026-05-17T10:00:00.000Z",
        timelineSequence: 1,
      },
      timestamp: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:00.000Z",
      timelineSequence: 1,
    },
    ...Array.from({ length: 30 }, (_, index) => ({
      id: `assistant-final#p${index}`,
      kind: "assistant_message" as const,
      chunks: [
        {
          id: `assistant-final#p${index}:content`,
          kind: "content" as const,
          text: `段落 ${index}`,
          timestamp: `2026-05-17T10:00:${String(index + 1).padStart(2, "0")}.000Z`,
          timelineSequence: index + 2,
        },
      ],
      timestamp: `2026-05-17T10:00:${String(index + 1).padStart(2, "0")}.000Z`,
      updatedAt: `2026-05-17T10:00:${String(index + 1).padStart(2, "0")}.000Z`,
      timelineSequence: index + 2,
    })),
  ];

  const html = renderPlainMessages({ timelineItems });

  assert.match(html, /继续/);
  assert.match(html, /段落 0/);
  assert.match(html, /段落 29/);
  assert.equal(html.match(/plain-assistant-segment-dot/g)?.length, 1);
});

test("plain messages renders all loaded timeline message blocks without manual load-more", () => {
  const timelineItems: SessionTimelineEntry[] = Array.from(
    { length: 25 },
    (_, index) => ({
      id: `assistant-loaded-${index}`,
      kind: "assistant_message" as const,
      chunks: [
        {
          id: `assistant-loaded-${index}:content`,
          kind: "content" as const,
          text: `已加载消息 ${index}`,
          timestamp: `2026-05-17T10:01:${String(index).padStart(2, "0")}.000Z`,
          timelineSequence: index + 1,
        },
      ],
      timestamp: `2026-05-17T10:01:${String(index).padStart(2, "0")}.000Z`,
      updatedAt: `2026-05-17T10:01:${String(index).padStart(2, "0")}.000Z`,
      timelineSequence: index + 1,
    }),
  );

  const html = renderPlainMessages({
    timelineItems,
    historyState: { hasMore: true, loading: false },
  });

  assert.match(html, /已加载消息 0/);
  assert.match(html, /已加载消息 24/);
  assert.equal(html.match(/plain-assistant-segment-dot/g)?.length, 25);
  assert.doesNotMatch(html, />查看更多<\/button>/);
});

test("plain messages can hide thinking cards without dropping normal messages", () => {
  const html = renderPlainMessages({
    items: [
      {
        id: "assistant-1",
        role: "assistant",
        text: "最终回答",
        timestamp: "2026-05-17T10:00:02.000Z",
      },
    ],
    thinkingToolCalls: [
      {
        id: "think-1",
        kind: "think",
        title: "Thinking",
        status: "completed",
        output: "不应显示的 Thinking 内容",
        timestamp: "2026-05-17T10:00:01.000Z",
        updatedAt: "2026-05-17T10:00:02.000Z",
      },
    ],
    showThinking: false,
  });

  assert.match(html, /最终回答/);
  assert.doesNotMatch(html, /不应显示的 Thinking 内容/);
  assert.doesNotMatch(html, /plain-thinking/);
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
      expandedMessageIds: new Set<string>(),
      historyState: { hasMore: false, loading: false },
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.match(html, /Thinking/);
  assert.doesNotMatch(html, /Thinking · Thinking/);
});

test("plain messages auto-expands running thinking and collapses completed thinking", () => {
  const renderThinking = (status: "running" | "completed") =>
    renderToStaticMarkup(
      createElement(PlainMessages, {
        sessionId: "session-1",
        items: [],
        thinkingToolCalls: [
          {
            id: `think-${status}`,
            kind: "think",
            title: "Thinking",
            status,
            output: `${status} Thinking`,
            timestamp: "2026-05-17T10:00:01.000Z",
            updatedAt: "2026-05-17T10:00:02.000Z",
          },
        ],
        emptyText: "等待回复",
        assistantLabel: "Assistant",
        roleLabels: { assistant: "Assistant", system: "System", user: "User" },
        expandedMessageIds: new Set<string>(),
        historyState: { hasMore: false, loading: false },
        onLoadOlderMessages: () => {},
        onToggleExpandedMessage: () => {},
      }),
    );

  const runningHtml = renderThinking("running");
  const completedHtml = renderThinking("completed");

  assert.match(runningHtml, /<details[^>]*open=""/);
  assert.doesNotMatch(completedHtml, /<details[^>]*open=""/);
  assert.match(runningHtml, /aria-label="收起 Thinking"/);
  assert.match(completedHtml, /aria-label="展开 Thinking"/);
  assert.match(runningHtml, /class="[^"]*rotate-180/);
  assert.doesNotMatch(completedHtml, /class="[^"]*rotate-180/);
});

test("plain messages collapses merged thinking when the latest chunk completes", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [],
      thinkingToolCalls: [
        {
          id: "think-running",
          kind: "think",
          title: "Thinking",
          status: "running",
          output: "running Thinking",
          timestamp: "2026-05-17T10:00:01.000Z",
          updatedAt: "2026-05-17T10:00:02.000Z",
        },
        {
          id: "think-running",
          kind: "think",
          title: "Thinking",
          status: "completed",
          output: "completed Thinking",
          timestamp: "2026-05-17T10:00:03.000Z",
          updatedAt: "2026-05-17T10:00:04.000Z",
        },
      ],
      emptyText: "等待回复",
      assistantLabel: "Assistant",
      roleLabels: { assistant: "Assistant", system: "System", user: "User" },
      expandedMessageIds: new Set<string>(),
      historyState: { hasMore: false, loading: false },
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.doesNotMatch(html, /<details[^>]*open=""/);
  assert.match(html, /aria-label="展开 Thinking"/);
});

test("plain messages keeps merged thinking open while the latest chunk is running", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [],
      thinkingToolCalls: [
        {
          id: "think-completed",
          kind: "think",
          title: "Thinking",
          status: "completed",
          output: "completed Thinking",
          timestamp: "2026-05-17T10:00:01.000Z",
          updatedAt: "2026-05-17T10:00:02.000Z",
        },
        {
          id: "think-completed",
          kind: "think",
          title: "Thinking",
          status: "running",
          output: "running Thinking",
          timestamp: "2026-05-17T10:00:03.000Z",
          updatedAt: "2026-05-17T10:00:04.000Z",
        },
      ],
      emptyText: "等待回复",
      assistantLabel: "Assistant",
      roleLabels: { assistant: "Assistant", system: "System", user: "User" },
      expandedMessageIds: new Set<string>(),
      historyState: { hasMore: false, loading: false },
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.match(html, /<details[^>]*open=""/);
  assert.match(html, /aria-label="收起 Thinking"/);
});

test("plain messages does not render a manual load-more history button", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        { id: "user-1", role: "user", text: "第一条", timestamp: "2026-05-17T10:00:00.000Z" },
      ],
      thinkingToolCalls: [],
      emptyText: "等待回复",
      assistantLabel: "Assistant",
      roleLabels: { assistant: "Assistant", system: "System", user: "User" },
      expandedMessageIds: new Set<string>(),
      historyState: { hasMore: true, loading: false },
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.match(html, /第一条/);
  assert.doesNotMatch(html, />查看更多<\/button>/);
  assert.doesNotMatch(html, /load-more-history/);
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
          id: "think-1",
          kind: "think",
          title: "Thinking",
          status: "completed",
          output: "第二段 Thinking",
          timestamp: "2026-05-17T10:00:02.000Z",
          updatedAt: "2026-05-17T10:00:02.000Z",
        },
        {
          id: "think-1",
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
      expandedMessageIds: new Set<string>(),
      historyState: { hasMore: false, loading: false },
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.equal(html.match(/<details class="plain-thinking/g)?.length, 1);
  assert.match(html, /第一段 Thinking/);
  assert.match(html, /第二段 Thinking/);
  assert.match(html, /第三段 Thinking/);
});

test("plain messages keeps adjacent thinking tool calls separate when ids differ", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [],
      thinkingToolCalls: [
        {
          id: "message-a:thinking",
          kind: "think",
          title: "Thinking",
          status: "completed",
          output: "第一轮 Thinking",
          timestamp: "2026-05-17T10:00:01.000Z",
          updatedAt: "2026-05-17T10:00:01.000Z",
        },
        {
          id: "message-b:thinking",
          kind: "think",
          title: "Thinking",
          status: "completed",
          output: "第二轮 Thinking",
          timestamp: "2026-05-17T10:00:02.000Z",
          updatedAt: "2026-05-17T10:00:02.000Z",
        },
      ],
      emptyText: "等待回复",
      assistantLabel: "Assistant",
      roleLabels: { assistant: "Assistant", system: "System", user: "User" },
      expandedMessageIds: new Set<string>(),
      historyState: { hasMore: false, loading: false },
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.equal(html.match(/<details class="plain-thinking/g)?.length, 2);
  assert.match(html, /第一轮 Thinking/);
  assert.match(html, /第二轮 Thinking/);
});

test("plain messages groups adjacent normal tool calls between assistant segments", () => {
  const html = renderPlainMessages({
    items: [
      {
        id: "assistant-before",
        role: "assistant",
        text: "先说明。",
        timestamp: "2026-05-17T10:00:00.000Z",
      },
      {
        id: "assistant-after",
        role: "assistant",
        text: "工具后继续输出。",
        timestamp: "2026-05-17T10:00:04.000Z",
      },
    ],
    toolCalls: [
      {
        id: "tool-read",
        kind: "read",
        title: "Read file",
        status: "completed",
        output: "file content",
        timestamp: "2026-05-17T10:00:01.000Z",
        updatedAt: "2026-05-17T10:00:01.000Z",
      },
      {
        id: "tool-search",
        kind: "search",
        title: "Search code",
        status: "completed",
        output: "search result",
        timestamp: "2026-05-17T10:00:02.000Z",
        updatedAt: "2026-05-17T10:00:02.000Z",
      },
    ],
  });

  assert.match(html, /工具调用 · 2 项/);
  assert.match(html, /Read \/ Search/);
  assert.match(html, /data-tool-group-kind="read"/);
  assert.doesNotMatch(html, />混合</);
  assert.match(html, /data-tool-kind="read"/);
  assert.match(html, /data-tool-kind="search"/);
  assert.equal(html.match(/<details class="plain-tool-group/g)?.length, 1);
  assert.doesNotMatch(html, /<details class="plain-tool-group[^"]*" open=""/);
  assert.equal(html.match(/<details class="plain-tool-call/g)?.length, 2);
  assert.doesNotMatch(html, /<details class="plain-tool-call[^"]*" open=""/);
  assert.ok(html.indexOf("先说明。") < html.indexOf("工具调用 · 2 项"));
  assert.ok(html.indexOf("工具调用 · 2 项") < html.indexOf("工具后继续输出。"));
  assert.match(html, /file content/);
  assert.match(html, /search result/);
});

test("plain messages keeps the latest completed tool group expanded by default", () => {
  const html = renderPlainMessages({
    items: [
      {
        id: "assistant-before",
        role: "assistant",
        text: "先说明。",
        timestamp: "2026-05-17T10:00:00.000Z",
      },
    ],
    toolCalls: [
      {
        id: "tool-read",
        kind: "read",
        title: "Read file",
        status: "completed",
        output: "file content",
        timestamp: "2026-05-17T10:00:01.000Z",
        updatedAt: "2026-05-17T10:00:02.000Z",
      },
    ],
  });

  assert.match(html, /工具调用 · 1 项/);
  assert.match(html, /<details class="plain-tool-group[^>]*open=""/);
  assert.match(html, /aria-label="收起工具调用"/);
  assert.ok(html.indexOf("先说明。") < html.indexOf("工具调用 · 1 项"));
});

test("plain messages starts a new tool group after assistant text resumes", () => {
  const html = renderPlainMessages({
    items: [
      {
        id: "assistant-before",
        role: "assistant",
        text: "第一段。",
        timestamp: "2026-05-17T10:00:00.000Z",
      },
      {
        id: "assistant-middle",
        role: "assistant",
        text: "第二段。",
        timestamp: "2026-05-17T10:00:03.000Z",
      },
      {
        id: "assistant-after",
        role: "assistant",
        text: "第三段。",
        timestamp: "2026-05-17T10:00:05.000Z",
      },
    ],
    toolCalls: [
      {
        id: "tool-a",
        kind: "read",
        title: "Read A",
        status: "completed",
        output: "read a output",
        timestamp: "2026-05-17T10:00:01.000Z",
        updatedAt: "2026-05-17T10:00:01.000Z",
      },
      {
        id: "tool-b",
        kind: "shell",
        title: "Run B",
        status: "running",
        timestamp: "2026-05-17T10:00:04.000Z",
        updatedAt: "2026-05-17T10:00:04.000Z",
      },
    ],
  });

  assert.equal(html.match(/<details class="plain-tool-group/g)?.length, 2);
  assert.match(html, /工具调用 · 1 项/);
  assert.match(html, /Shell/);
  assert.match(html, /<details class="plain-tool-group[^>]*open=""/);
  assert.equal(html.match(/<details class="plain-tool-call/g)?.length, 2);
  assert.doesNotMatch(html, /<details class="plain-tool-call[^"]*" open=""/);
  assert.ok(html.indexOf("第一段。") < html.indexOf("read a output"));
  assert.ok(html.indexOf("read a output") < html.indexOf("第二段。"));
  assert.ok(html.indexOf("第二段。") < html.indexOf("Run B"));
  assert.ok(html.indexOf("Run B") < html.indexOf("第三段。"));
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
      expandedMessageIds: new Set<string>(),
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
