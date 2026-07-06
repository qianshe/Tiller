import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentMessage, SessionTimelineEntry } from "@tiller/shared";
import { resolveMessageImageSource } from "./plain-message-items.js";
import {
  PlainMessages,
  INITIAL_PLAIN_MESSAGE_RENDER_LIMIT,
  PLAIN_MESSAGE_RENDER_LOAD_STEP,
  resolveRemoteHistoryRevealAction,
  resolveNextPlainConversationRenderLimit,
  resolveFinalAssistantActionTarget,
  resolvePlainConversationItemSpacingClass,
  resolvePlainDisplayMessages,
  resolvePlainConversationDisplayItems,
  resolvePlainMessageRenderSignature,
  resolvePlainMessageRenderItems,
  resolvePlainMessageScrollContainer,
  resolveRemoteHistoryRevealBaseline,
  resolveVisiblePlainConversationItems,
  resolveLocalHistoryRevealPlan,
  shouldPrimeOlderHistoryLoad,
  shouldAutoLoadOlderHistory,
} from "./plain-messages.js";

const plainMessagesSource = readFileSync(
  new URL("./plain-messages.tsx", import.meta.url),
  "utf8",
);

function renderPlainMessages(props: Partial<Parameters<typeof PlainMessages>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [],
      thinkingToolCalls: [],
      toolCalls: [],
      emptyText: "等待回复",
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
      expandedMessageIds: new Set<string>(),
      historyState: { hasMore: false, loading: false },
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.doesNotMatch(html, /plain-message-role/);
  assert.match(html, /先给一个结论。/);
  assert.match(html, /Thinking/);
  assert.doesNotMatch(html, /Thinking · Tab 替换边界探索/);
  assert.match(html, /完整 Thinking 内容/);
  assert.match(html, /plain-thinking-row[^"]*grid-cols-\[0\.375rem_minmax\(0,1fr\)\][^"]*gap-x-1/);
  assert.match(html, /plain-thinking[^"]*rounded-\[8px\][^"]*bg-surface-sunken\/55/);
  assert.match(html, /plain-thinking-content[^"]*border-l/);
  assert.match(html, /aria-label="展开 Thinking"/);
  assert.doesNotMatch(html, /plain-thinking[^"]*rounded-xl/);
  assert.doesNotMatch(html, /plain-thinking[^"]*bg-surface-elevated/);
});

test("plain messages renders pending compaction rows from timeline entries", () => {
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "compaction-pending",
        kind: "context_compaction",
        phase: "started",
        source: "provider",
        timestamp: "2026-06-28T00:00:00.000Z",
        updatedAt: "2026-06-28T00:00:00.000Z",
        replayCompleteness: "compacted",
      },
      {
        id: "assistant-1",
        kind: "assistant_message",
        chunks: [
          {
            id: "assistant-1:content",
            kind: "content",
            text: "我先继续处理剩余上下文。",
            timestamp: "2026-06-28T00:00:01.000Z",
            sequence: 1,
          },
        ],
        timestamp: "2026-06-28T00:00:01.000Z",
        updatedAt: "2026-06-28T00:00:01.000Z",
        sequence: 1,
      },
    ],
  } as any);

  assert.match(html, /正在压缩上下文/);
  assert.ok(html.indexOf("正在压缩上下文") < html.indexOf("我先继续处理剩余上下文。"));
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
        sequence: 1,
      },
      timestamp: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:00.000Z",
      sequence: 1,
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
          sequence: 2,
        },
        {
          id: "assistant-1:content",
          kind: "content",
          text: "最终回答",
          timestamp: "2026-05-17T10:00:02.000Z",
          sequence: 3,
        },
      ],
      timestamp: "2026-05-17T10:00:01.000Z",
      updatedAt: "2026-05-17T10:00:02.000Z",
      sequence: 2,
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

test("plain messages preserves persisted timeline order during sequence resets", () => {
  const timelineItems: SessionTimelineEntry[] = [
    {
      id: "restored-user",
      kind: "user_message",
      message: {
        id: "restored-user",
        role: "user",
        text: "恢复后的 prompt",
        timestamp: "2026-06-10T10:19:22.000Z",
        sequence: 2,
      },
      timestamp: "2026-06-10T10:19:22.000Z",
      updatedAt: "2026-06-10T10:19:22.000Z",
      sequence: 2,
    },
    {
      id: "older-assistant",
      kind: "assistant_message",
      chunks: [
        {
          id: "older-assistant:content",
          kind: "content",
          text: "更早的回复",
          timestamp: "2026-06-10T09:28:50.000Z",
          sequence: 87,
        },
      ],
      timestamp: "2026-06-10T09:28:50.000Z",
      updatedAt: "2026-06-10T09:28:50.000Z",
      sequence: 87,
    },
    {
      id: "restored-assistant",
      kind: "assistant_message",
      chunks: [
        {
          id: "restored-assistant:content",
          kind: "content",
          text: "恢复后的回复",
          timestamp: "2026-06-10T10:19:40.000Z",
          sequence: 4,
        },
      ],
      timestamp: "2026-06-10T10:19:40.000Z",
      updatedAt: "2026-06-10T10:19:40.000Z",
      sequence: 4,
    },
  ];

  const html = renderPlainMessages({
    timelineItems,
    items: [],
    thinkingToolCalls: [],
    toolCalls: [],
  } as any);

  const restoredPromptIndex = html.indexOf("恢复后的 prompt");
  const olderReplyIndex = html.indexOf("更早的回复");
  const restoredReplyIndex = html.indexOf("恢复后的回复");
  assert.ok(restoredPromptIndex >= 0);
  assert.ok(olderReplyIndex > restoredPromptIndex);
  assert.ok(restoredReplyIndex > olderReplyIndex);
});

test("plain messages appends live sequenced prompts without reordering persisted timeline", () => {
  const timelineItems: SessionTimelineEntry[] = [
    {
      id: "restored-user",
      kind: "user_message",
      message: {
        id: "restored-user",
        role: "user",
        text: "恢复后的 prompt",
        timestamp: "2026-06-10T10:19:22.000Z",
        sequence: 2,
      },
      timestamp: "2026-06-10T10:19:22.000Z",
      updatedAt: "2026-06-10T10:19:22.000Z",
      sequence: 2,
    },
    {
      id: "older-assistant",
      kind: "assistant_message",
      chunks: [
        {
          id: "older-assistant:content",
          kind: "content",
          text: "更早的回复",
          timestamp: "2026-06-10T09:28:50.000Z",
          sequence: 87,
        },
      ],
      timestamp: "2026-06-10T09:28:50.000Z",
      updatedAt: "2026-06-10T09:28:50.000Z",
      sequence: 87,
    },
  ];

  const html = renderPlainMessages({
    timelineItems,
    items: [
      {
        id: "live-user",
        role: "user",
        text: "最新 live prompt",
        timestamp: "2026-06-10T10:20:00.000Z",
        sequence: 88,
      },
    ],
    thinkingToolCalls: [],
    toolCalls: [],
  } as any);

  const restoredPromptIndex = html.indexOf("恢复后的 prompt");
  const olderReplyIndex = html.indexOf("更早的回复");
  const livePromptIndex = html.indexOf("最新 live prompt");
  assert.ok(restoredPromptIndex >= 0);
  assert.ok(olderReplyIndex > restoredPromptIndex);
  assert.ok(livePromptIndex > olderReplyIndex);
});

test("plain messages inserts unsequenced compact summary messages by timestamp", () => {
  const timelineItems: SessionTimelineEntry[] = [
    {
      id: "older-assistant",
      kind: "assistant_message",
      chunks: [
        {
          id: "older-assistant:content",
          kind: "content",
          text: "还没有，之前上下文断了。",
          timestamp: "2026-06-18T12:13:00.540Z",
          sequence: 255,
        },
      ],
      timestamp: "2026-06-18T12:13:00.540Z",
      updatedAt: "2026-06-18T12:13:00.540Z",
      sequence: 255,
    },
    {
      id: "current-user",
      kind: "user_message",
      message: {
        id: "current-user",
        role: "user",
        text: "结束任务",
        timestamp: "2026-06-18T14:01:49.292Z",
        sequence: 256,
      },
      timestamp: "2026-06-18T14:01:49.292Z",
      updatedAt: "2026-06-18T14:01:49.292Z",
      sequence: 256,
    },
    {
      id: "current-assistant",
      kind: "assistant_message",
      chunks: [
        {
          id: "current-assistant:content",
          kind: "content",
          text: "好的，我来完成剩余的两处改动然后收尾。",
          timestamp: "2026-06-18T14:02:15.534Z",
          sequence: 275,
        },
      ],
      timestamp: "2026-06-18T14:02:15.534Z",
      updatedAt: "2026-06-18T14:02:15.534Z",
      sequence: 275,
    },
  ];

  const html = renderPlainMessages({
    timelineItems,
    items: [
      {
        id: "compaction-summary",
        role: "user",
        text: "This session is being continued from a previous conversation that ran out of context.",
        timestamp: "2026-06-18T13:55:25.193Z",
      },
      {
        id: "previous-user",
        role: "user",
        text: "完成了嘛？",
        timestamp: "2026-06-18T13:55:25.197Z",
      },
    ],
    thinkingToolCalls: [],
    toolCalls: [],
  } as any);

  const olderReplyIndex = html.indexOf("还没有，之前上下文断了。");
  const summaryIndex = html.indexOf("This session is being continued from a previous conversation");
  const previousUserIndex = html.indexOf("完成了嘛？");
  const currentUserIndex = html.indexOf("结束任务");
  const currentAssistantIndex = html.indexOf("好的，我来完成剩余的两处改动然后收尾。");
  assert.ok(olderReplyIndex >= 0);
  assert.ok(summaryIndex > olderReplyIndex);
  assert.ok(previousUserIndex > summaryIndex);
  assert.ok(currentUserIndex > previousUserIndex);
  assert.ok(currentAssistantIndex > currentUserIndex);
});

test("plain messages keeps compact continuation preface ahead of the resumed window even when timestamps are later", () => {
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "current-user",
        kind: "user_message",
        message: {
          id: "current-user",
          role: "user",
          text: "结束任务",
          timestamp: "2026-06-18T14:01:49.292Z",
          sequence: 256,
        },
        timestamp: "2026-06-18T14:01:49.292Z",
        updatedAt: "2026-06-18T14:01:49.292Z",
        sequence: 256,
      },
      {
        id: "current-assistant",
        kind: "assistant_message",
        chunks: [
          {
            id: "current-assistant:content",
            kind: "content",
            text: "好的，我来完成剩余的两处改动然后收尾。",
            timestamp: "2026-06-18T14:02:15.534Z",
            sequence: 275,
          },
        ],
        timestamp: "2026-06-18T14:02:15.534Z",
        updatedAt: "2026-06-18T14:02:15.534Z",
        sequence: 275,
      },
    ],
    items: [
      {
        id: "compaction-summary",
        role: "user",
        text: "This session is being continued from a previous conversation that ran out of context.",
        timestamp: "2026-06-18T14:05:25.193Z",
      },
      {
        id: "previous-user",
        role: "user",
        text: "完成了嘛？",
        timestamp: "2026-06-18T14:05:25.197Z",
      },
      {
        id: "provider-current-user",
        role: "user",
        text: "结束任务",
        timestamp: "2026-06-18T14:01:49.292Z",
        sequence: 256,
      },
      {
        id: "provider-current-assistant",
        role: "assistant",
        text: "好的，我来完成剩余的两处改动然后收尾。",
        timestamp: "2026-06-18T14:02:15.534Z",
        sequence: 275,
      },
    ],
  });

  const summaryIndex = html.indexOf("This session is being continued from a previous conversation");
  const previousUserIndex = html.indexOf("完成了嘛？");
  const currentUserIndex = html.indexOf("结束任务");
  const currentAssistantIndex = html.indexOf("好的，我来完成剩余的两处改动然后收尾。");
  assert.ok(summaryIndex >= 0);
  assert.ok(previousUserIndex > summaryIndex);
  assert.ok(currentUserIndex > previousUserIndex);
  assert.ok(currentAssistantIndex > currentUserIndex);
});

test("plain messages keeps local continuation records visible while paged timeline still has more", () => {
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "current-user",
        kind: "user_message",
        message: {
          id: "current-user",
          role: "user",
          text: "结束任务",
          timestamp: "2026-06-18T14:01:49.292Z",
          sequence: 256,
        },
        timestamp: "2026-06-18T14:01:49.292Z",
        updatedAt: "2026-06-18T14:01:49.292Z",
        sequence: 256,
      },
      {
        id: "current-assistant",
        kind: "assistant_message",
        chunks: [
          {
            id: "current-assistant:content",
            kind: "content",
            text: "好的，我来完成剩余的两处改动然后收尾。",
            timestamp: "2026-06-18T14:02:15.534Z",
            sequence: 275,
          },
        ],
        timestamp: "2026-06-18T14:02:15.534Z",
        updatedAt: "2026-06-18T14:02:15.534Z",
        sequence: 275,
      },
    ],
    items: [
      {
        id: "compaction-summary",
        role: "user",
        text: "This session is being continued from a previous conversation that ran out of context.",
        timestamp: "2026-06-18T13:55:25.193Z",
      },
      {
        id: "previous-user",
        role: "user",
        text: "完成了嘛？",
        timestamp: "2026-06-18T13:55:25.197Z",
      },
    ],
    historyState: {
      hasMore: true,
      loading: false,
    },
  });

  assert.match(html, /This session is being continued from a previous conversation/);
  assert.match(html, /完成了嘛？/);
  assert.ok(html.indexOf("This session is being continued from a previous conversation") < html.indexOf("完成了嘛？"));
  assert.ok(html.indexOf("完成了嘛？") < html.indexOf("结束任务"));
});

test("plain messages prefers transcript compaction events over duplicate continuation summary messages", () => {
  const summaryText = "This session is being continued from a previous conversation that ran out of context.";
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "compaction-1",
        kind: "context_compaction",
        phase: "completed",
        source: "provider",
        summaryMessageId: "compaction-summary",
        summaryText,
        timestamp: "2026-06-18T13:55:25.193Z",
        updatedAt: "2026-06-18T13:55:25.193Z",
        replayCompleteness: "compacted",
      },
      {
        id: "current-user",
        kind: "user_message",
        message: {
          id: "current-user",
          role: "user",
          text: "结束任务",
          timestamp: "2026-06-18T14:01:49.292Z",
          sequence: 256,
        },
        timestamp: "2026-06-18T14:01:49.292Z",
        updatedAt: "2026-06-18T14:01:49.292Z",
        sequence: 256,
      },
      {
        id: "current-assistant",
        kind: "assistant_message",
        chunks: [
          {
            id: "current-assistant:content",
            kind: "content",
            text: "好的，我来完成剩余的两处改动然后收尾。",
            timestamp: "2026-06-18T14:02:15.534Z",
            sequence: 275,
          },
        ],
        timestamp: "2026-06-18T14:02:15.534Z",
        updatedAt: "2026-06-18T14:02:15.534Z",
        sequence: 275,
      },
    ],
    items: [
      {
        id: "compaction-summary",
        role: "user",
        text: summaryText,
        timestamp: "2026-06-18T13:55:25.193Z",
      },
      {
        id: "previous-user",
        role: "user",
        text: "完成了嘛？",
        timestamp: "2026-06-18T13:55:25.197Z",
      },
      {
        id: "provider-current-user",
        role: "user",
        text: "结束任务",
        timestamp: "2026-06-18T14:01:49.292Z",
        sequence: 256,
      },
      {
        id: "provider-current-assistant",
        role: "assistant",
        text: "好的，我来完成剩余的两处改动然后收尾。",
        timestamp: "2026-06-18T14:02:15.534Z",
        sequence: 275,
      },
    ],
  });

  assert.equal(
    html.match(/This session is being continued from a previous conversation/g)?.length,
    1,
  );
  assert.match(html, /上下文已压缩/);
  assert.match(html, /展开摘要/);
  assert.ok(html.indexOf("完成了嘛？") > html.indexOf("上下文已压缩"));
  assert.ok(html.indexOf("结束任务") > html.indexOf("完成了嘛？"));
});

test("plain messages suppresses timeline summary messages once compaction transcript events exist", () => {
  const summaryText = "This session is being continued from a previous conversation that ran out of context.";
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "previous-assistant",
        kind: "assistant_message",
        chunks: [
          {
            id: "previous-assistant:content",
            kind: "content",
            text: "更早的回复",
            timestamp: "2026-06-18T13:50:00.000Z",
            sequence: 240,
          },
        ],
        timestamp: "2026-06-18T13:50:00.000Z",
        updatedAt: "2026-06-18T13:50:00.000Z",
        sequence: 240,
      },
      {
        id: "compaction-summary",
        kind: "user_message",
        message: {
          id: "compaction-summary",
          role: "user",
          text: summaryText,
          timestamp: "2026-06-18T13:55:25.193Z",
        },
        timestamp: "2026-06-18T13:55:25.193Z",
        updatedAt: "2026-06-18T13:55:25.193Z",
      },
      {
        id: "compaction-1",
        kind: "context_compaction",
        phase: "completed",
        source: "provider",
        summaryMessageId: "compaction-summary",
        summaryText,
        timestamp: "2026-06-18T13:55:25.193Z",
        updatedAt: "2026-06-18T13:55:25.193Z",
        replayCompleteness: "compacted",
      },
      {
        id: "current-user",
        kind: "user_message",
        message: {
          id: "current-user",
          role: "user",
          text: "结束任务",
          timestamp: "2026-06-18T14:01:49.292Z",
          sequence: 256,
        },
        timestamp: "2026-06-18T14:01:49.292Z",
        updatedAt: "2026-06-18T14:01:49.292Z",
        sequence: 256,
      },
    ],
    items: [],
  });

  assert.equal(
    html.match(/This session is being continued from a previous conversation/g)?.length,
    1,
  );
  assert.ok(html.indexOf("上下文已压缩") > html.indexOf("更早的回复"));
  assert.ok(html.indexOf("结束任务") > html.indexOf("上下文已压缩"));
});

test("plain messages suppresses raw compaction lifecycle messages once compaction transcript events exist", () => {
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "compaction-1",
        kind: "context_compaction",
        phase: "completed",
        source: "provider",
        timestamp: "2026-06-18T13:55:25.193Z",
        updatedAt: "2026-06-18T13:55:25.193Z",
        replayCompleteness: "compacted",
      },
      {
        id: "assistant-answer",
        kind: "assistant_message",
        chunks: [
          {
            id: "assistant-answer:content",
            kind: "content",
            text: "有个测试失败了，看一下具体原因。",
            timestamp: "2026-06-18T13:55:26.000Z",
            sequence: 1,
          },
        ],
        timestamp: "2026-06-18T13:55:26.000Z",
        updatedAt: "2026-06-18T13:55:26.000Z",
        sequence: 1,
      },
    ],
    items: [
      {
        id: "compaction-started",
        role: "assistant",
        text: "Compacting...",
        timestamp: "2026-06-18T13:55:24.000Z",
      },
      {
        id: "compaction-completed",
        role: "assistant",
        text: "Compacting completed.",
        timestamp: "2026-06-18T13:55:25.000Z",
      },
    ],
  });

  assert.match(html, /上下文已压缩/);
  assert.doesNotMatch(html, /Compacting\.\.\./);
  assert.doesNotMatch(html, /Compacting completed\./);
  assert.ok(html.indexOf("上下文已压缩") < html.indexOf("有个测试失败了，看一下具体原因。"));
});

test("plain messages preserves transcript boundary anchor order when compaction timestamps are later than the first post-compaction message", () => {
  const summaryText = "This session is being continued from a previous conversation that ran out of context.";
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "older-assistant",
        kind: "assistant_message",
        chunks: [
          {
            id: "older-assistant:content",
            kind: "content",
            text: "验证不过的项告诉我具体表现，我来定位修。",
            timestamp: "2026-06-18T14:01:30.000Z",
            sequence: 255,
          },
        ],
        timestamp: "2026-06-18T14:01:30.000Z",
        updatedAt: "2026-06-18T14:01:30.000Z",
        sequence: 255,
      },
      {
        id: "compaction-1",
        kind: "context_compaction",
        phase: "completed",
        source: "provider",
        summaryMessageId: "compaction-summary",
        summaryText,
        timestamp: "2026-06-18T14:05:25.193Z",
        updatedAt: "2026-06-18T14:05:25.193Z",
        replayCompleteness: "compacted",
      },
      {
        id: "current-user",
        kind: "user_message",
        message: {
          id: "current-user",
          role: "user",
          text: "给我验证清单",
          timestamp: "2026-06-18T14:01:49.292Z",
          sequence: 256,
        },
        timestamp: "2026-06-18T14:01:49.292Z",
        updatedAt: "2026-06-18T14:01:49.292Z",
        sequence: 256,
      },
      {
        id: "assistant-answer",
        kind: "assistant_message",
        chunks: [
          {
            id: "assistant-answer:content",
            kind: "content",
            text: "验证清单",
            timestamp: "2026-06-18T14:02:16.000Z",
            sequence: 276,
          },
        ],
        timestamp: "2026-06-18T14:02:16.000Z",
        updatedAt: "2026-06-18T14:02:16.000Z",
        sequence: 276,
      },
    ],
    items: [],
  });

  assert.ok(html.indexOf("验证不过的项告诉我具体表现，我来定位修。") < html.indexOf("上下文已压缩"));
  assert.ok(html.indexOf("上下文已压缩") < html.indexOf("给我验证清单"));
  assert.ok(html.indexOf("给我验证清单") < html.indexOf("验证清单"));
});

test("plain messages renders compaction-only transcript prefixes using the stored canonical order", () => {
  const summaryText = "This session is being continued from a previous conversation that ran out of context.";
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "older-assistant",
        kind: "assistant_message",
        chunks: [
          {
            id: "older-assistant:content",
            kind: "content",
            text: "验证不过的项告诉我具体表现，我来定位修。",
            timestamp: "2026-06-18T14:01:30.000Z",
            sequence: 255,
          },
        ],
        timestamp: "2026-06-18T14:01:30.000Z",
        updatedAt: "2026-06-18T14:01:30.000Z",
        sequence: 255,
      },
      {
        id: "compaction-1",
        kind: "context_compaction",
        phase: "completed",
        source: "provider",
        summaryMessageId: "compaction-summary",
        summaryText,
        timestamp: "2026-06-18T14:05:25.193Z",
        updatedAt: "2026-06-18T14:05:25.193Z",
        replayCompleteness: "compacted",
      },
      {
        id: "current-user",
        kind: "user_message",
        message: {
          id: "current-user",
          role: "user",
          text: "给我验证清单",
          timestamp: "2026-06-18T14:01:49.292Z",
          sequence: 256,
        },
        timestamp: "2026-06-18T14:01:49.292Z",
        updatedAt: "2026-06-18T14:01:49.292Z",
        sequence: 256,
      },
      {
        id: "assistant-answer",
        kind: "assistant_message",
        chunks: [
          {
            id: "assistant-answer:content",
            kind: "content",
            text: "验证清单",
            timestamp: "2026-06-18T14:02:16.000Z",
            sequence: 276,
          },
        ],
        timestamp: "2026-06-18T14:02:16.000Z",
        updatedAt: "2026-06-18T14:02:16.000Z",
        sequence: 276,
      },
    ],
    items: [],
  });

  assert.ok(html.indexOf("验证不过的项告诉我具体表现，我来定位修。") < html.indexOf("上下文已压缩"));
  assert.ok(html.indexOf("上下文已压缩") < html.indexOf("给我验证清单"));
  assert.ok(html.indexOf("给我验证清单") < html.indexOf("验证清单"));
});

test("plain messages dedupes live assistant replies already represented after a compaction boundary", () => {
  const summaryText = "This session is being continued from a previous conversation that ran out of context.";
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "older-assistant",
        kind: "assistant_message",
        chunks: [
          {
            id: "older-assistant:content",
            kind: "content",
            text: "压缩前最后一条可见回复",
            timestamp: "2026-06-18T13:50:00.000Z",
            sequence: 240,
          },
        ],
        timestamp: "2026-06-18T13:50:00.000Z",
        updatedAt: "2026-06-18T13:50:00.000Z",
        sequence: 240,
      },
      {
        id: "compaction-1",
        kind: "context_compaction",
        phase: "completed",
        source: "provider",
        summaryMessageId: "compaction-summary",
        summaryText,
        timestamp: "2026-06-18T13:55:25.193Z",
        updatedAt: "2026-06-18T13:55:25.193Z",
        replayCompleteness: "compacted",
      },
      {
        id: "assistant-after-compaction",
        kind: "assistant_message",
        chunks: [
          {
            id: "assistant-after-compaction:content",
            kind: "content",
            text: "这是压缩后的第一条回复。",
            timestamp: "2026-06-18T14:02:15.534Z",
            sequence: 275,
          },
        ],
        timestamp: "2026-06-18T14:02:15.534Z",
        updatedAt: "2026-06-18T14:02:15.534Z",
        sequence: 275,
      },
    ],
    items: [
      {
        id: "provider-assistant-after-compaction",
        role: "assistant",
        text: "这是压缩后的第一条回复。",
        timestamp: "2026-06-18T14:02:15.534Z",
        sequence: 275,
      },
    ],
  });

  assert.equal(html.match(/这是压缩后的第一条回复。/g)?.length, 1);
  assert.ok(html.indexOf("压缩前最后一条可见回复") < html.indexOf("上下文已压缩"));
  assert.ok(html.indexOf("上下文已压缩") < html.indexOf("这是压缩后的第一条回复。"));
});

test("plain messages dedupes live assistant replies already represented by timeline content outside compaction flows", () => {
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "assistant-final",
        kind: "assistant_message",
        chunks: [
          {
            id: "assistant-final:content",
            kind: "content",
            text: "明白了，MCP 工具应该保持 mcp 类型，不应该被重新分类为 read/search/write。移除 MCP 语义细分逻辑。",
            timestamp: "2026-06-28T00:00:10.000Z",
            sequence: 42,
          },
        ],
        timestamp: "2026-06-28T00:00:10.000Z",
        updatedAt: "2026-06-28T00:00:10.000Z",
        sequence: 42,
      },
    ],
    items: [
      {
        id: "provider-assistant-final",
        role: "assistant",
        text: "明白了，MCP 工具应该保持 mcp 类型，不应该被重新分类为 read/search/write。移除 MCP 语义细分逻辑。",
        timestamp: "2026-06-28T00:00:10.000Z",
        sequence: 42,
      },
    ],
  });

  assert.equal(
    html.match(/明白了，MCP 工具应该保持 mcp 类型，不应该被重新分类为 read\/search\/write。移除 MCP 语义细分逻辑。/g)?.length,
    1,
  );
});

test("plain messages does not append live user prompts already represented by timeline", () => {
  const timelineItems: SessionTimelineEntry[] = [
    {
      id: "provider-user-1",
      kind: "user_message",
      message: {
        id: "provider-user-1",
        role: "user",
        text: "继续检查历史",
        timestamp: "2026-05-17T10:00:01.000Z",
        sequence: 1,
      },
      timestamp: "2026-05-17T10:00:01.000Z",
      updatedAt: "2026-05-17T10:00:01.000Z",
      sequence: 1,
    },
    {
      id: "assistant-1",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-1:content",
          kind: "content",
          text: "已检查",
          timestamp: "2026-05-17T10:00:02.000Z",
          sequence: 2,
        },
      ],
      timestamp: "2026-05-17T10:00:02.000Z",
      updatedAt: "2026-05-17T10:00:02.000Z",
      sequence: 2,
    },
  ];

  const html = renderPlainMessages({
    timelineItems,
    items: [
      {
        id: "local-user-1",
        role: "user",
        text: "继续检查历史",
        timestamp: "2026-05-17T10:00:00.000Z",
        sequence: 1,
      },
    ],
  });

  assert.equal(html.match(/继续检查历史/g)?.length, 1);
});

test("plain messages keeps repeated live user prompts not represented by timeline", () => {
  const timelineItems: SessionTimelineEntry[] = [
    {
      id: "provider-user-2",
      kind: "user_message",
      message: {
        id: "provider-user-2",
        role: "user",
        text: "继续",
        timestamp: "2026-05-17T10:00:03.000Z",
      },
      timestamp: "2026-05-17T10:00:03.000Z",
      updatedAt: "2026-05-17T10:00:03.000Z",
    },
  ];

  const html = renderPlainMessages({
    timelineItems,
    items: [
      {
        id: "local-user-1",
        role: "user",
        text: "继续",
        timestamp: "2026-05-17T10:00:00.000Z",
      },
      {
        id: "local-user-2",
        role: "user",
        text: "继续",
        timestamp: "2026-05-17T10:00:03.000Z",
      },
    ],
  });

  assert.equal(html.match(/继续/g)?.length, 2);
});

test("plain messages renders persisted image attachment URIs", () => {
  const html = renderPlainMessages({
    items: [
      {
        id: "user-image",
        role: "user",
        text: "看图",
        timestamp: "2026-06-01T10:00:00.000Z",
        attachments: [
          {
            type: "image",
            mimeType: "image/png",
            uri: "/api/sessions/session-1/attachments/attachment-1",
            name: "screen.png",
          },
        ],
      },
    ],
  });

  assert.match(html, /src="\/api\/sessions\/session-1\/attachments\/attachment-1"/);
  assert.doesNotMatch(html, /base64,undefined/);
});

test("plain message image sources route persisted attachment APIs to Helm in dev mode", () => {
  assert.equal(
    resolveMessageImageSource(
      {
        type: "image",
        mimeType: "image/png",
        uri: "/api/sessions/session-1/attachments/attachment-1",
      },
      {
        location: { protocol: "http:", hostname: "127.0.0.1", port: "5173" },
        storage: {
          getItem: (key: string) => key === "tiller.daemon-port" ? "47631" : "127.0.0.1",
        },
      },
    ),
    "http://127.0.0.1:47631/api/sessions/session-1/attachments/attachment-1",
  );
});

test("plain messages render local prompt images from data instead of placeholder URIs", () => {
  const html = renderPlainMessages({
    items: [
      {
        id: "user-local-image",
        role: "user",
        text: "看图",
        timestamp: "2026-06-01T10:00:00.000Z",
        attachments: [
          {
            type: "image",
            data: "QUJD",
            mimeType: "image/png",
            uri: "tiller:///agent/prompt-image?name=screen.png&index=0",
            name: "screen.png",
          },
        ],
      },
    ],
  });

  assert.match(html, /src="data:image\/png;base64,QUJD"/);
  assert.doesNotMatch(html, /tiller:\/\/\/agent\/prompt-image/);
});

test("plain message image attachments wrap right and expose preview buttons", () => {
  const html = renderPlainMessages({
    items: [
      {
        id: "user-multi-image",
        role: "user",
        text: "看这两张图",
        timestamp: "2026-06-01T10:00:00.000Z",
        attachments: [
          { type: "image", data: "QUJD", mimeType: "image/png", name: "a.png" },
          { type: "image", data: "REVG", mimeType: "image/png", name: "b.png" },
        ],
      },
    ],
  });

  assert.match(html, /mission-message-attachments[^"]*w-fit[^"]*flex-wrap[^"]*justify-end/);
  assert.equal(html.match(/mission-message-image-preview-trigger/g)?.length, 2);
  assert.match(html, /aria-label="放大查看 a.png"/);
  assert.match(html, /aria-label="放大查看 b.png"/);
  assert.doesNotMatch(html, /<figcaption/);
  assert.doesNotMatch(html, />a\.png</);
  assert.doesNotMatch(html, />b\.png</);
  assert.doesNotMatch(html, /overflow-x-auto/);
});

test("plain user messages cap at the wide reading rail", () => {
  const html = renderPlainMessages({
    items: [
      {
        id: "user-wide",
        role: "user",
        text: "This session has a user message that should not be cramped in a narrow pane.",
        timestamp: "2026-06-01T10:00:00.000Z",
      },
    ],
  });

  assert.match(html, /plain-user[^\"]*w-full[^\"]*justify-items-end/);
  assert.match(html, /plain-message-user-row[^"]*w-full[^"]*min-w-0[^"]*max-w-full/);
  assert.match(
    html,
    /plain-message-body[^"]*w-fit[^"]*max-w-\[min\(56rem,76%\)\]/,
  );
});

test("plain short user messages size to their content before wrapping", () => {
  const html = renderPlainMessages({
    items: [
      {
        id: "user-short",
        role: "user",
        text: "你好",
        timestamp: "2026-06-01T10:00:00.000Z",
      },
    ],
  });

  assert.match(
    html,
    /plain-message-body[^"]*w-fit[^"]*max-w-\[min\(56rem,76%\)\][^"]*break-words/,
  );
  assert.doesNotMatch(html, /plain-message-body[^"]*(?:min-w-14|\sw-\[min\()/);
});

test("plain user messages allow long tokens to wrap inside the bubble", () => {
  const html = renderPlainMessages({
    items: [
      {
        id: "user-long-token",
        role: "user",
        text: "审核 `docs/superpowers/plans/2026-06-09-git-commit-workflow.md` 对照 checklist",
        timestamp: "2026-06-01T10:00:00.000Z",
      },
    ],
  });

  assert.match(html, /plain-message-body[^"]*min-w-0/);
  assert.match(html, /plain-message-body[^"]*\[overflow-wrap:anywhere\]/);
});

test("plain long user prompt messages collapse without losing actions", () => {
  const html = renderPlainMessages({
    items: [
      {
        id: "user-long-prompt",
        role: "user",
        text: [
          "审核 docs/superpowers/plans/2026-06-09-git-commit-workflow.md",
          "对照 checklist",
          "确认 plan 是否完整",
          "最后一行需要直接可见",
        ].join("\n"),
        timestamp: "2026-06-01T10:00:00.000Z",
      },
    ],
  });

  assert.match(html, /最后一行需要直接可见/);
  assert.match(html, /plain-message-user-row[^"]*min-w-0/);
  assert.match(html, /plain-message-body[^"]*plain-message-body-collapsed/);
  assert.match(html, /plain-message-text-collapsed/);
  assert.match(html, /line-clamp-3/);
  assert.match(html, /展开完整消息/);
  assert.match(html, /plain-message-copy/);
});

test("plain assistant markdown keeps horizontal overflow inside the message body", () => {
  const html = renderPlainMessages({
    items: [
      {
        id: "assistant-table",
        role: "assistant",
        text: "| 文件 | 改动 |\n|---|---|\n| `very/long/path/that/should/not/stretch/the/session/card/body.tsx` | `extremely-long-token-without-breaks-that-belongs-inside-the-table-scroll` |",
        timestamp: "2026-06-01T10:00:00.000Z",
      },
    ],
  });

  assert.match(
    html,
    /plain-message-body[^"]*max-w-full[^"]*overflow-hidden/,
  );
  assert.match(html, /markdown-table-scroll/);
  assert.match(html, /overflow-x-auto/);
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
          sequence: 1,
        },
      ],
      timestamp: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:00.000Z",
      sequence: 1,
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
            sequence: sequence,
          },
          timestamp: `2026-05-17T10:00:${String(sequence).padStart(2, "0")}.000Z`,
          updatedAt: `2026-05-17T10:00:${String(sequence).padStart(2, "0")}.000Z`,
          sequence: sequence,
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
              sequence: sequence + 1,
            },
          ],
          timestamp: `2026-05-17T10:00:${String(sequence + 1).padStart(2, "0")}.000Z`,
          updatedAt: `2026-05-17T10:00:${String(sequence + 1).padStart(2, "0")}.000Z`,
          sequence: sequence + 1,
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
          sequence: 99,
        },
      ],
      timestamp: "2026-05-17T10:01:00.000Z",
      updatedAt: "2026-05-17T10:01:00.000Z",
      sequence: 99,
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
          sequence: 1,
        },
        {
          id: "assistant-1:content",
          kind: "content",
          text: "只有一条正文时应展示完整已加载条目",
          timestamp: "2026-05-17T10:00:01.000Z",
          sequence: 2,
        },
      ],
      timestamp: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:01.000Z",
      sequence: 1,
    },
  ];

  const html = renderPlainMessages({ timelineItems });

  assert.match(html, /开头 Thinking 不应被窗口裁掉/);
  assert.match(html, /只有一条正文时应展示完整已加载条目/);
  assert.doesNotMatch(html, />查看更多<\/button>/);
});

test("plain messages marks paged windows that start inside earlier context", () => {
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "assistant-thinking-only",
        kind: "assistant_message",
        chunks: [
          {
            id: "assistant-thinking-only:thinking",
            kind: "thinking",
            text: "缺少上方正文上下文的 Thinking",
            title: "Thinking",
            status: "completed",
            timestamp: "2026-05-17T10:00:00.000Z",
            updatedAt: "2026-05-17T10:00:00.000Z",
            sequence: 1,
          },
        ],
        timestamp: "2026-05-17T10:00:00.000Z",
        updatedAt: "2026-05-17T10:00:00.000Z",
        sequence: 1,
      },
      {
        id: "assistant-answer",
        kind: "assistant_message",
        chunks: [
          {
            id: "assistant-answer:content",
            kind: "content",
            text: "后续正文",
            timestamp: "2026-05-17T10:00:01.000Z",
            sequence: 2,
          },
        ],
        timestamp: "2026-05-17T10:00:01.000Z",
        updatedAt: "2026-05-17T10:00:01.000Z",
        sequence: 2,
      },
    ],
    historyState: { hasMore: true, loading: false },
  });

  assert.match(html, /plain-history-boundary/);
  assert.match(html, /上方还有上下文/);
  assert.doesNotMatch(html, /缺少上方正文上下文的 Thinking/);
  assert.ok(html.indexOf("上方还有上下文") < html.indexOf("后续正文"));
});

test("plain messages keeps transcript boundary rows when paged windows start before the first post-compaction message", () => {
  const summaryText = "This session is being continued from a previous conversation that ran out of context.";
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "compaction-1",
        kind: "context_compaction",
        phase: "completed",
        source: "provider",
        summaryMessageId: "compaction-summary",
        summaryText,
        timestamp: "2026-06-18T13:55:25.193Z",
        updatedAt: "2026-06-18T13:55:25.193Z",
        replayCompleteness: "compacted",
      },
      {
        id: "assistant-answer",
        kind: "assistant_message",
        chunks: [
          {
            id: "assistant-answer:content",
            kind: "content",
            text: "后续正文",
            timestamp: "2026-06-18T13:55:26.000Z",
            sequence: 1,
          },
        ],
        timestamp: "2026-06-18T13:55:26.000Z",
        updatedAt: "2026-06-18T13:55:26.000Z",
        sequence: 1,
      },
    ],
    historyState: { hasMore: true, loading: false },
  });

  assert.match(html, /plain-history-boundary/);
  assert.match(html, /上方还有上下文/);
  assert.match(html, /上下文已压缩/);
  assert.ok(html.indexOf("上方还有上下文") < html.indexOf("上下文已压缩"));
  assert.ok(html.indexOf("上下文已压缩") < html.indexOf("后续正文"));
});

test("plain messages drops replay-duplicate live assistant messages already covered by timeline history", () => {
  const assistantText = "我来看看项目结构和相关代码。";
  const html = renderPlainMessages({
    items: [
      {
        id: "provider-assistant-1",
        role: "assistant",
        text: assistantText,
        timestamp: "2026-06-28T12:44:23.973Z",
        sequence: 3,
      },
    ],
    timelineItems: [
      {
        id: "session-1-msg-000001",
        kind: "assistant_message",
        chunks: [
          {
            id: "session-1-msg-000001:content",
            kind: "content",
            text: assistantText,
            timestamp: "2026-06-28T12:42:44.452Z",
            sequence: 40,
          },
        ],
        timestamp: "2026-06-28T12:42:44.452Z",
        updatedAt: "2026-06-28T12:42:44.452Z",
        sequence: 40,
      },
    ],
  });

  assert.equal(html.match(new RegExp(assistantText, "g"))?.length ?? 0, 1);
});

test("plain messages does not mark paged windows that start at a normal message", () => {
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "user-start",
        kind: "user_message",
        message: {
          id: "user-start",
          role: "user",
          text: "正常起点",
          timestamp: "2026-05-17T10:00:00.000Z",
          sequence: 1,
        },
        timestamp: "2026-05-17T10:00:00.000Z",
        updatedAt: "2026-05-17T10:00:00.000Z",
        sequence: 1,
      },
      {
        id: "assistant-answer",
        kind: "assistant_message",
        chunks: [
          {
            id: "assistant-answer:content",
            kind: "content",
            text: "回答",
            timestamp: "2026-05-17T10:00:01.000Z",
            sequence: 2,
          },
        ],
        timestamp: "2026-05-17T10:00:01.000Z",
        updatedAt: "2026-05-17T10:00:01.000Z",
        sequence: 2,
      },
    ],
    historyState: {
      hasMore: true,
      loading: false,
    },
  });

  assert.doesNotMatch(html, /plain-history-boundary/);
  assert.match(html, /正常起点/);
});

test("plain messages keep optimistic live messages visible when timeline history exists", () => {
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "history-user",
        kind: "user_message",
        message: {
          id: "history-user",
          role: "user",
          text: "历史问题",
          timestamp: "2026-05-17T10:00:00.000Z",
          sequence: 1,
        },
        timestamp: "2026-05-17T10:00:00.000Z",
        updatedAt: "2026-05-17T10:00:00.000Z",
        sequence: 1,
      },
    ],
    items: [
      {
        id: "session-1-user-pending",
        role: "user",
        text: "新的 OpenCode prompt",
        timestamp: "2026-05-17T10:00:02.000Z",
      },
    ],
  });

  assert.match(html, /历史问题/);
  assert.match(html, /新的 OpenCode prompt/);
  assert.ok(html.indexOf("历史问题") < html.indexOf("新的 OpenCode prompt"));
});

test("plain messages do not append persisted runtime assistant history to the optimistic tail", () => {
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "history-user",
        kind: "user_message",
        message: {
          id: "history-user",
          role: "user",
          text: "历史问题",
          timestamp: "2026-05-17T10:00:00.000Z",
          sequence: 1,
        },
        timestamp: "2026-05-17T10:00:00.000Z",
        updatedAt: "2026-05-17T10:00:00.000Z",
        sequence: 1,
      },
      {
        id: "history-assistant",
        kind: "assistant_message",
        chunks: [
          {
            id: "history-assistant:content",
            kind: "content",
            text: "较晚的历史回复",
            timestamp: "2026-05-17T10:10:00.000Z",
            sequence: 2,
          },
        ],
        timestamp: "2026-05-17T10:10:00.000Z",
        updatedAt: "2026-05-17T10:10:00.000Z",
        sequence: 2,
      },
    ],
    items: [
      {
        id: "session-1-msg-000001-000000-cdeadbeef",
        role: "assistant",
        text: "重新导入恢复出的 assistant 历史",
        timestamp: "2026-05-17T10:05:00.000Z",
      },
    ],
  });

  const historyUserIndex = html.indexOf("历史问题");
  const restoredAssistantIndex = html.indexOf("重新导入恢复出的 assistant 历史");
  const laterHistoryAssistantIndex = html.indexOf("较晚的历史回复");
  assert.ok(historyUserIndex >= 0);
  assert.ok(restoredAssistantIndex > historyUserIndex);
  assert.ok(laterHistoryAssistantIndex > restoredAssistantIndex);
});

test("plain messages append live prompts after restored timeline history", () => {
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "history-user",
        kind: "user_message",
        message: {
          id: "history-user",
          role: "user",
          text: "历史问题",
          timestamp: "2026-05-17T10:00:00.000Z",
          sequence: 1,
        },
        timestamp: "2026-05-17T10:00:00.000Z",
        updatedAt: "2026-05-17T10:00:00.000Z",
        sequence: 1,
      },
      {
        id: "history-assistant",
        kind: "assistant_message",
        chunks: [
          {
            id: "history-assistant:content",
            kind: "content",
            text: "旧回复历史",
            timestamp: "2026-05-17T10:10:00.000Z",
            sequence: 2,
          },
        ],
        timestamp: "2026-05-17T10:10:00.000Z",
        updatedAt: "2026-05-17T10:10:00.000Z",
        sequence: 2,
      },
    ],
    items: [
      {
        id: "session-1-user-pending",
        role: "user",
        text: "刚发送的新消息",
        timestamp: "2026-05-17T10:05:00.000Z",
      },
    ],
  });

  const historyUserIndex = html.indexOf("历史问题");
  const historyAssistantIndex = html.indexOf("旧回复历史");
  const liveUserIndex = html.indexOf("刚发送的新消息");
  assert.ok(historyUserIndex >= 0);
  assert.ok(historyAssistantIndex > historyUserIndex);
  assert.ok(liveUserIndex > historyAssistantIndex);
});

test("plain messages keep assistant fallback visible when only message pagination remains", () => {
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "tool-history",
        kind: "tool_call",
        toolCall: {
          id: "tool-history",
          commandId: "tool-history",
          kind: "shell",
          title: "Shell",
          status: "completed",
          output: "stdout",
          timestamp: "2026-05-17T10:00:02.000Z",
          updatedAt: "2026-05-17T10:00:02.000Z",
          sequence: 2,
        },
        timestamp: "2026-05-17T10:00:02.000Z",
        updatedAt: "2026-05-17T10:00:02.000Z",
        sequence: 2,
      },
    ],
    items: [
      {
        id: "assistant-final",
        role: "assistant",
        text: "最终答复",
        timestamp: "2026-05-17T10:00:00.500Z",
        sequence: 1,
      },
    ],
    historyState: {
      hasMore: false,
      loading: false,
    },
  });

  assert.match(html, /最终答复/);
  assert.match(html, /工具调用 · 1 项/);
  assert.ok(html.indexOf("最终答复") < html.indexOf("工具调用 · 1 项"));
});

test("plain messages append live prompts after a paged restored timeline", () => {
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "paged-assistant",
        kind: "assistant_message",
        chunks: [
          {
            id: "paged-assistant:content",
            kind: "content",
            text: "旧会话窗口里的回复",
            timestamp: "2026-05-17T10:10:00.000Z",
            sequence: 50,
          },
        ],
        timestamp: "2026-05-17T10:10:00.000Z",
        updatedAt: "2026-05-17T10:10:00.000Z",
        sequence: 50,
      },
    ],
    items: [
      {
        id: "session-1-user-pending",
        role: "user",
        text: "刚发送到旧会话的新消息",
        timestamp: "2026-05-17T10:20:00.000Z",
      },
    ],
    historyState: {
      hasMore: true,
      loading: false,
    },
  });

  const historyAssistantIndex = html.indexOf("旧会话窗口里的回复");
  const liveUserIndex = html.indexOf("刚发送到旧会话的新消息");
  assert.ok(historyAssistantIndex >= 0);
  assert.ok(liveUserIndex > historyAssistantIndex);
});

test("plain messages keep older fallback messages ahead of the loaded timeline window", () => {
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "loaded-assistant",
        kind: "assistant_message",
        chunks: [
          {
            id: "loaded-assistant:content",
            kind: "content",
            text: "已加载窗口里的回复",
            timestamp: "2026-05-17T10:10:00.000Z",
            sequence: 50,
          },
        ],
        timestamp: "2026-05-17T10:10:00.000Z",
        updatedAt: "2026-05-17T10:10:00.000Z",
        sequence: 50,
      },
    ],
    items: [
      {
        id: "legacy-user-before-window",
        role: "user",
        text: "最早的用户消息不应追加到末尾",
        timestamp: "2026-05-17T10:00:00.000Z",
        sequence: 1,
      },
    ],
    historyState: {
      hasMore: true,
      loading: false,
    },
  });

  const legacyUserIndex = html.indexOf("最早的用户消息不应追加到末尾");
  const loadedAssistantIndex = html.indexOf("已加载窗口里的回复");

  assert.match(html, /已加载窗口里的回复/);
  assert.match(html, /最早的用户消息不应追加到末尾/);
  assert.ok(legacyUserIndex >= 0 && loadedAssistantIndex > legacyUserIndex);
});

test("plain messages sort fallback messages with the restored timeline window", () => {
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "latest-assistant",
        kind: "assistant_message",
        chunks: [
          {
            id: "latest-assistant:content",
            kind: "content",
            text: "底部窗口里较新的助手回复",
            timestamp: "2026-05-17T10:30:00.000Z",
            sequence: 116,
          },
        ],
        timestamp: "2026-05-17T10:30:00.000Z",
        updatedAt: "2026-05-17T10:30:00.000Z",
        sequence: 116,
      },
    ],
    items: [
      {
        id: "legacy-user-first",
        role: "user",
        text: "旧的用户问题一",
        timestamp: "2026-05-17T10:00:00.000Z",
        sequence: 49,
      },
      {
        id: "legacy-assistant-first",
        role: "assistant",
        text: "旧的助手回复一",
        timestamp: "2026-05-17T10:01:00.000Z",
        sequence: 50,
      },
      {
        id: "legacy-user-second",
        role: "user",
        text: "旧的用户问题二",
        timestamp: "2026-05-17T10:02:00.000Z",
        sequence: 63,
      },
      {
        id: "legacy-assistant-second",
        role: "assistant",
        text: "旧的助手回复二",
        timestamp: "2026-05-17T10:03:00.000Z",
        sequence: 64,
      },
    ],
  });

  const firstUserIndex = html.indexOf("旧的用户问题一");
  const firstAssistantIndex = html.indexOf("旧的助手回复一");
  const secondUserIndex = html.indexOf("旧的用户问题二");
  const secondAssistantIndex = html.indexOf("旧的助手回复二");
  const latestAssistantIndex = html.indexOf("底部窗口里较新的助手回复");
  assert.ok(firstUserIndex >= 0);
  assert.ok(firstAssistantIndex > firstUserIndex);
  assert.ok(secondUserIndex > firstAssistantIndex);
  assert.ok(secondAssistantIndex > secondUserIndex);
  assert.ok(latestAssistantIndex > secondAssistantIndex);
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
        sequence: 1,
      },
      timestamp: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:00.000Z",
      sequence: 1,
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
          sequence: index + 2,
        },
      ],
      timestamp: `2026-05-17T10:00:${String(index + 1).padStart(2, "0")}.000Z`,
      updatedAt: `2026-05-17T10:00:${String(index + 1).padStart(2, "0")}.000Z`,
      sequence: index + 2,
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
          sequence: index + 1,
        },
      ],
      timestamp: `2026-05-17T10:01:${String(index).padStart(2, "0")}.000Z`,
      updatedAt: `2026-05-17T10:01:${String(index).padStart(2, "0")}.000Z`,
      sequence: index + 1,
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

test("plain messages initially renders only the newest window for large loaded timelines", () => {
  const timelineItems: SessionTimelineEntry[] = Array.from(
    { length: 140 },
    (_, index) => ({
      id: `assistant-large-${index}`,
      kind: "assistant_message" as const,
      chunks: [
        {
          id: `assistant-large-${index}:content`,
          kind: "content" as const,
          text: `大历史消息 ${index}`,
          timestamp: `2026-05-17T10:02:${String(index).padStart(2, "0")}.000Z`,
          sequence: index + 1,
        },
      ],
      timestamp: `2026-05-17T10:02:${String(index).padStart(2, "0")}.000Z`,
      updatedAt: `2026-05-17T10:02:${String(index).padStart(2, "0")}.000Z`,
      sequence: index + 1,
    }),
  );

  const html = renderPlainMessages({ timelineItems });

  assert.doesNotMatch(html, /大历史消息 0/);
  assert.match(html, /大历史消息 139/);
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

test("plain messages collapses still-running thinking once newer content follows", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "最终回答",
          timestamp: "2026-05-17T10:00:05.000Z",
        },
      ],
      thinkingToolCalls: [
        {
          id: "think-1",
          kind: "think",
          title: "Thinking",
          status: "running",
          output: "仍标记为运行中的 Thinking",
          timestamp: "2026-05-17T10:00:01.000Z",
          updatedAt: "2026-05-17T10:00:02.000Z",
        },
      ],
      emptyText: "等待回复",
      expandedMessageIds: new Set<string>(),
      historyState: { hasMore: false, loading: false },
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.doesNotMatch(html, /<details[^>]*open=""/);
  assert.match(html, /aria-label="展开 Thinking"/);
  assert.ok(html.indexOf("仍标记为运行中的 Thinking") < html.indexOf("最终回答"));
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

test("plain messages coalesces adjacent duplicate generic thinking snapshots", () => {
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "opencode-thinking-a",
        kind: "assistant_message",
        chunks: [
          {
            id: "opencode-thinking-a:thinking",
            kind: "thinking",
            text: "",
            title: "Thinking",
            status: "completed",
            timestamp: "2026-05-17T10:00:00.000Z",
            updatedAt: "2026-05-17T10:00:00.000Z",
            sequence: 1,
          },
        ],
        timestamp: "2026-05-17T10:00:00.000Z",
        updatedAt: "2026-05-17T10:00:00.000Z",
        sequence: 1,
      },
      {
        id: "opencode-thinking-b",
        kind: "assistant_message",
        chunks: [
          {
            id: "opencode-thinking-b:thinking",
            kind: "thinking",
            text: "",
            title: "Thinking",
            status: "running",
            timestamp: "2026-05-17T10:00:01.000Z",
            updatedAt: "2026-05-17T10:00:01.000Z",
            sequence: 2,
          },
        ],
        timestamp: "2026-05-17T10:00:01.000Z",
        updatedAt: "2026-05-17T10:00:01.000Z",
        sequence: 2,
      },
      {
        id: "assistant-answer",
        kind: "assistant_message",
        chunks: [
          {
            id: "assistant-answer:content",
            kind: "content",
            text: "最终回答",
            timestamp: "2026-05-17T10:00:02.000Z",
            sequence: 3,
          },
        ],
        timestamp: "2026-05-17T10:00:02.000Z",
        updatedAt: "2026-05-17T10:00:02.000Z",
        sequence: 3,
      },
    ],
  });

  assert.equal(html.match(/<details class="plain-thinking/g)?.length, 1);
  assert.match(html, /最终回答/);
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

test("plain messages renders subagents as standalone timeline rows", () => {
  const html = renderPlainMessages({
    items: [
      {
        id: "assistant-before",
        role: "assistant",
        text: "准备委派。",
        timestamp: "2026-05-17T10:00:00.000Z",
      },
    ],
    toolCalls: [
      {
        id: "tool-subagent",
        kind: "subagent",
        title: "spawn_agents_on_csv",
        status: "completed",
        output: "Explorer summarized affected files.",
        timestamp: "2026-05-17T10:00:01.000Z",
        updatedAt: "2026-05-17T10:00:02.000Z",
      },
    ],
  });

  assert.match(html, /plain-subagent/);
  assert.match(html, /spawn_agents_on_csv/);
  assert.match(html, /Explorer summarized affected files\./);
  assert.doesNotMatch(html, /工具调用 · 1 项/);
  assert.doesNotMatch(html, /plain-tool-group/);
  assert.doesNotMatch(html, /data-tool-group-kind="subagent"/);
  assert.match(html, /aria-label="展开 spawn_agents_on_csv"/);
  assert.ok(html.indexOf("准备委派。") < html.indexOf("spawn_agents_on_csv"));
});

test("plain messages keeps subagents out of adjacent normal tool groups", () => {
  const html = renderPlainMessages({
    items: [
      {
        id: "assistant-before",
        role: "assistant",
        text: "开始检查。",
        timestamp: "2026-05-17T10:00:00.000Z",
      },
    ],
    toolCalls: [
      {
        id: "tool-subagent",
        kind: "subagent",
        title: "background_output",
        status: "completed",
        output: "Explore result.",
        timestamp: "2026-05-17T10:00:01.000Z",
        updatedAt: "2026-05-17T10:00:01.000Z",
      },
      {
        id: "tool-search-a",
        kind: "search",
        title: "Search runtime async guard patterns",
        status: "completed",
        output: "search a",
        timestamp: "2026-05-17T10:00:02.000Z",
        updatedAt: "2026-05-17T10:00:02.000Z",
      },
      {
        id: "tool-search-b",
        kind: "search",
        title: "Search async functions in helm",
        status: "completed",
        output: "search b",
        timestamp: "2026-05-17T10:00:03.000Z",
        updatedAt: "2026-05-17T10:00:03.000Z",
      },
    ],
  });

  assert.equal(html.match(/<details class="plain-subagent/g)?.length, 1);
  assert.equal(html.match(/<details class="plain-tool-group/g)?.length, 1);
  assert.match(html, /工具调用 · 2 项/);
  assert.match(html, /Search/);
  assert.doesNotMatch(html, /工具调用 · 3 项/);
  assert.doesNotMatch(html, /Subagent \/ Search/);
  assert.ok(html.indexOf("background_output") < html.indexOf("工具调用 · 2 项"));
});

test("plain messages keeps tool call rows vertically centered with symmetric padding", () => {
  const html = renderPlainMessages({
    toolCalls: [
      {
        id: "tool-search-a",
        kind: "search",
        title: "Search runtime async guard patterns",
        status: "completed",
        output: "search a",
        timestamp: "2026-05-17T10:00:02.000Z",
        updatedAt: "2026-05-17T10:00:02.000Z",
      },
    ],
  });

  assert.match(html, /plain-tool-call/);
  assert.match(html, /<details class="plain-tool-call text-muted-foreground"/);
  assert.match(html, /<summary class="flex min-w-0 cursor-pointer list-none items-center gap-1\.5 py-0\.5 text-2xs leading-4 \[\&amp;::-webkit-details-marker\]:hidden">/);
  assert.match(html, /class="grid size-3 shrink-0 place-items-center rounded-sm/);
  assert.match(html, /inline-flex h-4 shrink-0 items-center rounded-sm px-1\.5 py-0 text-\[10px\] font-semibold leading-none/);
  assert.match(html, /<strong class="min-w-0 flex-1 truncate font-medium leading-4 text-foreground">/);
  assert.match(html, /class="ml-auto inline-flex h-4 shrink-0 items-center text-2xs text-muted-foreground\/60"/);
  assert.match(html, /<pre class="mt-0\.5 max-h-48 overflow-auto whitespace-pre-wrap break-words pl-8 font-mono text-xs leading-snug text-foreground\/85"/);
});

test("plain messages surfaces subagent type and task summary when available", () => {
  const html = renderPlainMessages({
    toolCalls: [
      {
        id: "tool-subagent",
        kind: "subagent",
        title: "background_output",
        status: "running",
        input: JSON.stringify({
          subagent_type: "Explore",
          description: "trace async refresh flow",
        }),
        output: "",
        timestamp: "2026-05-17T10:00:01.000Z",
        updatedAt: "2026-05-17T10:00:01.000Z",
      },
    ],
  });

  assert.match(html, /aria-label="收起 Explore"/);
  assert.match(html, /Explore/);
  assert.match(html, /trace async refresh flow/);
  assert.match(html, /运行中/);
  assert.match(html, /<summary class="flex w-full cursor-pointer list-none items-center gap-2 rounded-sm py-1 text-xs leading-4 text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-border-ghost \[\&amp;::-webkit-details-marker\]:hidden"/);
  assert.match(html, /class="flex min-w-0 flex-1 items-center gap-2"/);
  assert.match(html, /class="inline-flex size-4 shrink-0 items-center justify-center"/);
  assert.match(html, /class="inline-flex h-4 shrink-0 items-center font-medium leading-none"/);
  assert.match(html, /class="inline-flex h-4 min-w-0 items-center truncate leading-none text-muted-foreground\/70"/);
  assert.match(html, /class="inline-flex h-4 shrink-0 items-center rounded-sm px-1\.5 py-0\.5 text-2xs font-semibold leading-none/);
  assert.match(html, /class="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground\/60 transition-transform duration-150 rotate-180"/);
});

test("plain messages removes vertical guide lines from thinking, subagent, and tool group details", () => {
  const html = renderPlainMessages({
    thinkingToolCalls: [
      {
        id: "assistant-1:thinking",
        commandId: "assistant-1:thinking",
        kind: "think",
        title: "Thinking",
        status: "running",
        output: "Reasoning...",
        timestamp: "2026-05-17T10:00:00.000Z",
        updatedAt: "2026-05-17T10:00:00.000Z",
      },
    ],
    toolCalls: [
      {
        id: "tool-subagent",
        kind: "subagent",
        title: "background_output",
        status: "running",
        input: JSON.stringify({
          subagent_type: "Explore",
          description: "trace async refresh flow",
        }),
        output: "",
        timestamp: "2026-05-17T10:00:01.000Z",
        updatedAt: "2026-05-17T10:00:01.000Z",
      },
      {
        id: "tool-read",
        kind: "read",
        title: "Read file",
        status: "completed",
        output: "file content",
        timestamp: "2026-05-17T10:00:02.000Z",
        updatedAt: "2026-05-17T10:00:02.000Z",
      },
    ],
  });

  assert.match(html, /class="plain-thinking-content pt-1 text-\[12\.5px\]/);
  assert.match(html, /class="plain-subagent-content pt-1 text-\[12\.5px\]/);
  assert.match(html, /class="plain-tool-group-content grid max-h-36 gap-1 overflow-y-auto pt-1 pr-1 text-\[12\.5px\] text-muted-foreground"/);
  assert.doesNotMatch(html, /border-l border-primary\/25/);
});

test("plain messages does not treat OpenCode task-like payloads as subagents without typed kind", () => {
  const html = renderPlainMessages({
    toolCalls: [
      {
        id: "tool-opencode-subagent",
        kind: "search",
        title: "Review concurrency findings",
        status: "completed",
        input: JSON.stringify({
          description: "Review concurrency findings",
          prompt: "TASK: Review race-condition findings.",
          run_in_background: false,
          subagent_type: "oracle",
          task_id: "",
        }),
        output: "Task completed.",
        timestamp: "2026-05-17T10:00:01.000Z",
        updatedAt: "2026-05-17T10:00:01.000Z",
      },
      {
        id: "tool-search",
        kind: "search",
        title: "Search async functions in helm",
        status: "completed",
        output: "search result",
        timestamp: "2026-05-17T10:00:02.000Z",
        updatedAt: "2026-05-17T10:00:02.000Z",
      },
    ],
  });

  assert.equal(html.match(/<details class="plain-subagent/g)?.length ?? 0, 0);
  assert.equal(html.match(/<details class="plain-tool-group/g)?.length, 1);
  assert.match(html, /工具调用 · 2 项/);
  assert.match(html, /Review concurrency findings/);
  assert.doesNotMatch(html, /data-subagent-call/);
});

test("plain messages marks cancelled and failed subagent rows clearly", () => {
  const html = renderPlainMessages({
    toolCalls: [
      {
        id: "tool-subagent-cancel",
        kind: "subagent",
        title: "background_cancel",
        status: "completed",
        input: JSON.stringify({ taskId: "bg_cancelled", all: false }),
        output: "",
        timestamp: "2026-05-17T10:00:01.000Z",
        updatedAt: "2026-05-17T10:00:01.000Z",
      },
      {
        id: "tool-subagent-failed",
        kind: "subagent",
        title: "",
        status: "failed",
        input: "",
        output: "Subagent failed to start.",
        timestamp: "2026-05-17T10:00:02.000Z",
        updatedAt: "2026-05-17T10:00:02.000Z",
      },
    ],
  });

  assert.match(html, /background_cancel/);
  assert.match(html, /取消后台任务/);
  assert.match(html, /已取消/);
  assert.match(html, /Error/);
  assert.match(html, /错误/);
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

test("plain messages preserves source order for tied unsequenced tool calls and messages", () => {
  const timestamp = "2026-05-17T10:00:00.000Z";
  const html = renderPlainMessages({
    timelineItems: [
      {
        id: "assistant-before",
        kind: "assistant_message",
        chunks: [
          {
            id: "assistant-before:content",
            kind: "content",
            text: "第一段。",
            timestamp,
          },
        ],
        timestamp,
        updatedAt: timestamp,
      },
      {
        id: "tool-a",
        kind: "tool_call",
        toolCall: {
          id: "tool-a",
          kind: "read",
          title: "Read A",
          status: "completed",
          output: "read a output",
          timestamp,
          updatedAt: timestamp,
        },
        timestamp,
        updatedAt: timestamp,
      },
      {
        id: "assistant-middle",
        kind: "assistant_message",
        chunks: [
          {
            id: "assistant-middle:content",
            kind: "content",
            text: "第二段。",
            timestamp,
          },
        ],
        timestamp,
        updatedAt: timestamp,
      },
      {
        id: "tool-b",
        kind: "tool_call",
        toolCall: {
          id: "tool-b",
          kind: "shell",
          title: "Run B",
          status: "running",
          timestamp,
          updatedAt: timestamp,
        },
        timestamp,
        updatedAt: timestamp,
      },
      {
        id: "assistant-after",
        kind: "assistant_message",
        chunks: [
          {
            id: "assistant-after:content",
            kind: "content",
            text: "第三段。",
            timestamp,
          },
        ],
        timestamp,
        updatedAt: timestamp,
      },
    ],
  });

  assert.equal(html.match(/<details class="plain-tool-group/g)?.length, 2);
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

test("plain message timeline keeps tool and thinking rows tighter than content boundaries", () => {
  assert.equal(
    resolvePlainConversationItemSpacingClass("thinking", "tool-group"),
    "plain-message-block min-w-0",
  );
  assert.equal(
    resolvePlainConversationItemSpacingClass("subagent", "thinking"),
    "plain-message-block min-w-0",
  );
  assert.equal(
    resolvePlainConversationItemSpacingClass("tool-group", "subagent"),
    "plain-message-block min-w-0",
  );
  assert.equal(
    resolvePlainConversationItemSpacingClass("message", "tool-group"),
    "plain-message-block min-w-0 mt-2",
  );
  assert.equal(
    resolvePlainConversationItemSpacingClass("thinking", "message"),
    "plain-message-block min-w-0 mt-2",
  );
  assert.equal(
    resolvePlainConversationItemSpacingClass("message", "message", "assistant", "user"),
    "plain-message-block min-w-0 mt-4",
  );
  assert.equal(
    resolvePlainConversationItemSpacingClass("message", "message", "user", "assistant"),
    "plain-message-block min-w-0 mt-4",
  );
  assert.equal(
    resolvePlainConversationItemSpacingClass("message", "message", "assistant", "assistant"),
    "plain-message-block min-w-0 mt-2",
  );
  assert.match(plainMessagesSource, /gap-y-1/);
});

test("plain user messages render a copy action", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "user-1",
          role: "user",
          text: "需要复制的用户消息",
          timestamp: "2026-05-06T00:00:00.000Z",
        },
        {
          id: "assistant-1",
          role: "assistant",
          text: "助手回复",
          timestamp: "2026-05-06T00:00:01.000Z",
        },
      ] as AgentMessage[],
      timelineItems: [],
      thinkingToolCalls: [],
      toolCalls: [],
      emptyText: "empty",
      expandedMessageIds: new Set<string>(),
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.equal(html.match(/aria-label="复制用户消息"/g)?.length, 1);
  assert.match(html, /plain-message-copy/);
});

test("plain assistant actions target only the final stable assistant block", () => {
  const renderItems = resolvePlainMessageRenderItems([
    {
      id: "assistant-1",
      role: "assistant",
      text: "上一段 assistant",
      timestamp: "2026-05-06T00:00:00.000Z",
    },
    {
      id: "assistant-2",
      role: "assistant",
      text: "最后一段 assistant",
      timestamp: "2026-05-06T00:00:01.000Z",
    },
  ]);

  assert.deepEqual(resolveFinalAssistantActionTarget(renderItems), {
    copyText: "最后一段 assistant",
    messageId: "assistant-2",
    renderKey: "assistant-2",
  });
});

test("plain assistant actions skip streaming or non-final assistant blocks", () => {
  assert.equal(
    resolveFinalAssistantActionTarget(
      resolvePlainMessageRenderItems([
        {
          id: "assistant-streaming",
          role: "assistant",
          text: "还在输出",
          streaming: true,
          timestamp: "2026-05-06T00:00:00.000Z",
        },
      ]),
    ),
    null,
  );
  assert.equal(
    resolveFinalAssistantActionTarget(
      resolvePlainMessageRenderItems([
        {
          id: "assistant-1",
          role: "assistant",
          text: "不是最终 item",
          timestamp: "2026-05-06T00:00:00.000Z",
        },
        {
          id: "user-1",
          role: "user",
          text: "后面还有用户消息",
          timestamp: "2026-05-06T00:00:01.000Z",
        },
      ]),
    ),
    null,
  );
});

test("plain assistant actions render copy and configured Handoff under final assistant", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "可复制的最后回复",
          timestamp: "2026-05-06T00:00:00.000Z",
        },
      ] as AgentMessage[],
      canHandoffAssistantMessage: true,
      assistantHandoffBusy: false,
      onHandoffAssistantMessage: () => {},
      timelineItems: [],
      thinkingToolCalls: [],
      toolCalls: [],
      emptyText: "empty",
      expandedMessageIds: new Set<string>(),
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.equal(html.match(/plain-assistant-actions/g)?.length, 1);
  assert.equal(html.match(/aria-label=\"复制回复\"/g)?.length, 1);
  assert.equal(html.match(/aria-label=\"生成 Handoff\"/g)?.length, 1);
  assert.match(html, /border-t/);
});

test("plain assistant actions hide Handoff when LLM is not configured", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "可复制的最后回复",
          timestamp: "2026-05-06T00:00:00.000Z",
        },
      ] as AgentMessage[],
      canHandoffAssistantMessage: false,
      onHandoffAssistantMessage: () => {},
      timelineItems: [],
      thinkingToolCalls: [],
      toolCalls: [],
      emptyText: "empty",
      expandedMessageIds: new Set<string>(),
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.equal(html.match(/aria-label=\"复制回复\"/g)?.length, 1);
  assert.doesNotMatch(html, /生成 Handoff/);
});

test("plain assistant actions do not backtrack when final rendered item is a tool group", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "assistant-1",
          role: "assistant",
          text: "工具前回复",
          timestamp: "2026-05-06T00:00:00.000Z",
        },
      ] as AgentMessage[],
      toolCalls: [
        {
          id: "tool-1",
          kind: "shell",
          title: "Run tests",
          status: "completed",
          output: "ok",
          timestamp: "2026-05-06T00:00:01.000Z",
          updatedAt: "2026-05-06T00:00:01.000Z",
        },
      ],
      canHandoffAssistantMessage: true,
      onHandoffAssistantMessage: () => {},
      timelineItems: [],
      thinkingToolCalls: [],
      emptyText: "empty",
      expandedMessageIds: new Set<string>(),
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.doesNotMatch(html, /aria-label=\"复制回复\"/);
  assert.doesNotMatch(html, /生成 Handoff/);
});

test("plain user message actions render below the message body", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "user-1",
          role: "user",
          text: "这是一条需要折叠的用户消息。".repeat(24),
          timestamp: "2026-05-06T00:00:00.000Z",
        },
      ] as AgentMessage[],
      timelineItems: [],
      thinkingToolCalls: [],
      toolCalls: [],
      emptyText: "empty",
      expandedMessageIds: new Set<string>(),
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  const userRowIndex = html.indexOf("plain-message-user-row");
  const actionsIndex = html.indexOf("plain-message-actions");
  const copyIndex = html.indexOf("plain-message-copy");
  const expandIndex = html.indexOf("plain-message-expand");

  assert.ok(userRowIndex >= 0);
  assert.ok(actionsIndex > userRowIndex);
  assert.ok(copyIndex > actionsIndex);
  assert.ok(expandIndex > actionsIndex);
  assert.ok(expandIndex < copyIndex);
  assert.doesNotMatch(html.slice(userRowIndex, actionsIndex), /plain-message-copy/);
});

test("plain message display keeps all loaded messages", () => {
  const messages = Array.from({ length: 25 }, (_, index) => message(index + 1));

  assert.deepEqual(
    resolvePlainDisplayMessages(messages).map((item) => item.id),
    messages.map((item) => item.id),
  );
});

test("plain message render window keeps newest loaded items first", () => {
  const messages = Array.from(
    { length: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT + 5 },
    (_, index) => message(index + 1),
  );

  assert.deepEqual(
    resolveVisiblePlainConversationItems(messages).map((item) => item.id),
    messages.slice(5).map((item) => item.id),
  );
});

test("plain message render window keeps the preceding message for leading tool context", () => {
  const items = [
    ...Array.from({ length: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT }, (_, index) => message(index + 1)),
    {
      kind: "message" as const,
      timestamp: "2026-05-06T01:00:00.000Z",
      message: {
        id: "assistant-context",
        role: "assistant" as const,
        text: "工具前回复正文",
        timestamp: "2026-05-06T01:00:00.000Z",
      },
    },
    {
      kind: "thinking" as const,
      timestamp: "2026-05-06T01:00:01.000Z",
      toolCall: {
        id: "thinking-1",
        kind: "think" as const,
        title: "Thinking",
        status: "completed" as const,
        output: "推理内容",
        timestamp: "2026-05-06T01:00:01.000Z",
        updatedAt: "2026-05-06T01:00:01.000Z",
      },
    },
    {
      kind: "tool-group" as const,
      timestamp: "2026-05-06T01:00:02.000Z",
      group: [
        {
          id: "tool-1",
          kind: "read" as const,
          title: "Read",
          status: "completed" as const,
          timestamp: "2026-05-06T01:00:02.000Z",
          updatedAt: "2026-05-06T01:00:02.000Z",
        },
      ],
    },
    {
      kind: "message" as const,
      timestamp: "2026-05-06T01:00:03.000Z",
      message: {
        id: "assistant-after-tools",
        role: "assistant" as const,
        text: "工具后回复正文",
        timestamp: "2026-05-06T01:00:03.000Z",
      },
    },
  ];

  assert.deepEqual(
    resolveVisiblePlainConversationItems(items, 3).map((item) => "role" in item ? item.id : item.kind === "message" ? item.message.id : item.kind),
    ["assistant-context", "thinking", "tool-group", "assistant-after-tools"],
  );
});

test("plain message render window reveals local loaded items before remote history", () => {
  assert.equal(
    resolveNextPlainConversationRenderLimit(
      INITIAL_PLAIN_MESSAGE_RENDER_LIMIT,
      INITIAL_PLAIN_MESSAGE_RENDER_LIMIT + 5,
    ),
    INITIAL_PLAIN_MESSAGE_RENDER_LIMIT + 5,
  );
  assert.equal(
    resolveNextPlainConversationRenderLimit(
      INITIAL_PLAIN_MESSAGE_RENDER_LIMIT,
      INITIAL_PLAIN_MESSAGE_RENDER_LIMIT + PLAIN_MESSAGE_RENDER_LOAD_STEP + 5,
    ),
    INITIAL_PLAIN_MESSAGE_RENDER_LIMIT + PLAIN_MESSAGE_RENDER_LOAD_STEP,
  );
});

test("plain message local top reveal expands all loaded history without preserving scroll", () => {
  assert.deepEqual(
    resolveLocalHistoryRevealPlan({
      scrollTop: 0,
      currentLimit: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT,
      totalItems: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT + PLAIN_MESSAGE_RENDER_LOAD_STEP + 5,
    }),
    {
      nextLimit: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT + PLAIN_MESSAGE_RENDER_LOAD_STEP + 5,
      preserveScroll: false,
    },
  );
});

test("plain message local near-top reveal keeps stepped expansion and preserves scroll", () => {
  assert.deepEqual(
    resolveLocalHistoryRevealPlan({
      scrollTop: 32,
      currentLimit: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT,
      totalItems: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT + PLAIN_MESSAGE_RENDER_LOAD_STEP + 5,
    }),
    {
      nextLimit: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT + PLAIN_MESSAGE_RENDER_LOAD_STEP,
      preserveScroll: true,
    },
  );
});

test("plain message history auto-loads older pages when loaded content does not fill the viewport", () => {
  assert.equal(
    shouldAutoLoadOlderHistory({ scrollHeight: 720, clientHeight: 760 }),
    true,
  );
  assert.equal(
    shouldAutoLoadOlderHistory({ scrollHeight: 1200, clientHeight: 760 }),
    false,
  );
});

test("plain message history primes another older-page load when the session opens already pinned to the top", () => {
  assert.equal(
    shouldPrimeOlderHistoryLoad({
      scrollTop: 0,
      scrollHeight: 2396,
      clientHeight: 699,
      canLoadMore: true,
    }),
    true,
  );
  assert.equal(
    shouldPrimeOlderHistoryLoad({
      scrollTop: 240,
      scrollHeight: 2396,
      clientHeight: 699,
      canLoadMore: true,
    }),
    false,
  );
  assert.equal(
    shouldPrimeOlderHistoryLoad({
      scrollTop: 0,
      scrollHeight: 2396,
      clientHeight: 699,
      canLoadMore: false,
    }),
    false,
  );
});

test("plain message history uses the session card body as the scroll container", () => {
  const wrapper = {} as HTMLDivElement;
  const scrollContainer = {} as HTMLDivElement;
  const list = {
    parentElement: wrapper,
    closest(selector: string) {
      return selector === "[data-session-card-body]" ? scrollContainer : null;
    },
  } as unknown as HTMLDivElement;

  assert.equal(resolvePlainMessageScrollContainer(list), scrollContainer);
});

test("plain message remote history requests reset so repeated top scroll can load again", () => {
  const resetCount = plainMessagesSource.match(/olderLoadRequestedRef\.current = false/g)?.length ?? 0;

  assert.ok(resetCount >= 3);
  assert.match(
    plainMessagesSource,
    /pendingRemoteHistoryRevealRef\.current = false;\s+olderLoadRequestedRef\.current = false;/,
  );
});

test("plain message history restores scroll during layout instead of after paint", () => {
  assert.match(
    plainMessagesSource,
    /useLayoutEffect\(\(\) => \{\s+renderRevealRequestedRef\.current = false;/,
  );
  assert.match(
    plainMessagesSource,
    /scrollContainer\.scrollTop = newScrollTop;/,
  );
  assert.doesNotMatch(
    plainMessagesSource,
    /requestAnimationFrame\(\(\) => \{\s+const newScrollTop = snapshot\.mode === "top"/,
  );
});

test("plain message remote history preserves scroll when compact shifts the visible window without growing total items", () => {
  assert.equal(
    resolveRemoteHistoryRevealAction({
      previousDisplayItemsLength: 120,
      nextDisplayItemsLength: 120,
      previousVisibleRenderSignature: "assistant-12|assistant-13|assistant-14",
      nextVisibleRenderSignature: "assistant-11|assistant-12|assistant-13|assistant-14",
      visibleItemLimit: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT,
    }),
    "preserve-scroll",
  );
});

test("plain message remote history expands the render window when an older page increases loaded items", () => {
  assert.equal(
    resolveRemoteHistoryRevealAction({
      previousDisplayItemsLength: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT,
      nextDisplayItemsLength: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT + 8,
      previousVisibleRenderSignature: "assistant-1|assistant-2",
      nextVisibleRenderSignature: "assistant-1|assistant-2",
      visibleItemLimit: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT,
    }),
    "reveal-more",
  );
});

test("plain message remote history keeps the request baseline while loading commits new items", () => {
  const requestBaseline = {
    displayItemsLength: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT,
    visibleRenderSignature: "assistant-10|assistant-11",
  };
  const loadingBaseline = resolveRemoteHistoryRevealBaseline({
    previousBaseline: requestBaseline,
    pendingRemoteHistoryReveal: true,
    displayItemsLength: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT + 8,
    visibleRenderSignature: "assistant-2|assistant-10|assistant-11",
  });

  assert.deepEqual(loadingBaseline, requestBaseline);
  assert.equal(
    resolveRemoteHistoryRevealAction({
      previousDisplayItemsLength: loadingBaseline.displayItemsLength,
      nextDisplayItemsLength: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT + 8,
      previousVisibleRenderSignature: loadingBaseline.visibleRenderSignature,
      nextVisibleRenderSignature: "assistant-2|assistant-10|assistant-11",
      visibleItemLimit: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT,
    }),
    "reveal-more",
  );
});

test("plain message remote history clears pending state only when neither size nor visible window changed", () => {
  assert.equal(
    resolveRemoteHistoryRevealAction({
      previousDisplayItemsLength: 120,
      nextDisplayItemsLength: 120,
      previousVisibleRenderSignature: "assistant-12|assistant-13|assistant-14",
      nextVisibleRenderSignature: "assistant-12|assistant-13|assistant-14",
      visibleItemLimit: INITIAL_PLAIN_MESSAGE_RENDER_LIMIT,
    }),
    "clear-pending",
  );
});

test("plain message render signature changes when the same render key changes height", () => {
  const before = resolvePlainMessageRenderItems([
    {
      ...message(1),
      id: "assistant-same-key",
      role: "assistant",
      text: "短回复",
    },
  ]);
  const after = resolvePlainMessageRenderItems([
    {
      ...message(1),
      id: "assistant-same-key",
      role: "assistant",
      text: "短回复\n补充一行会改变高度",
    },
  ]);

  assert.notEqual(
    resolvePlainMessageRenderSignature(before),
    resolvePlainMessageRenderSignature(after),
  );
});

test("plain message display stops merging fallback messages once canonical timeline exists", () => {
  const timelineItems: SessionTimelineEntry[] = [
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
          sequence: 2,
        },
        {
          id: "assistant-1:content",
          kind: "content",
          text: "最终回答",
          timestamp: "2026-05-17T10:00:02.000Z",
          sequence: 3,
        },
      ],
      timestamp: "2026-05-17T10:00:01.000Z",
      updatedAt: "2026-05-17T10:00:02.000Z",
      sequence: 2,
    },
  ];
  const liveMessages: AgentMessage[] = [
    {
      id: "assistant-live-older",
      role: "assistant",
      text: "更早的 fallback 回复",
      timestamp: "2026-05-17T10:00:00.500Z",
      sequence: 1,
    },
  ];

  const displayItems = resolvePlainConversationDisplayItems({
    displayMessages: liveMessages,
    timelineItems,
    showThinking: true,
    thinkingToolCalls: [],
    toolCalls: [],
  });

  assert.equal(
    displayItems.some(
      (item) => item.kind === "message" && item.message.id === "assistant-live-older",
    ),
    false,
  );
});

test("plain message display keeps optimistic user prompts visible alongside canonical timeline", () => {
  const timelineItems: SessionTimelineEntry[] = [
    {
      id: "canonical-user-entry-1",
      kind: "user_message",
      message: {
        id: "canonical-user-1",
        role: "user",
        text: "上一条消息",
        timestamp: "2026-05-17T10:00:00.000Z",
      },
      timestamp: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:00.000Z",
      sequence: 1,
    },
  ];
  const liveMessages: AgentMessage[] = [
    {
      id: "session-1-user-optimistic",
      role: "user",
      text: "刚发送的新消息",
      timestamp: "2026-05-17T10:00:01.000Z",
    },
  ];

  const displayItems = resolvePlainConversationDisplayItems({
    displayMessages: liveMessages,
    timelineItems,
    showThinking: true,
    thinkingToolCalls: [],
    toolCalls: [],
  });

  assert.equal(
    displayItems.some(
      (item) => item.kind === "message" && item.message.id === "session-1-user-optimistic",
    ),
    true,
  );
});

test("plain message display uses chronological order from newest-first pages", () => {
  const messages = Array.from({ length: 25 }, (_, index) => message(index + 1));
  const newestFirstMessages = [...messages].reverse();

  assert.deepEqual(
    resolvePlainDisplayMessages(newestFirstMessages).map((item) => item.id),
    messages.map((item) => item.id),
  );
});

test("plain message timeline coalesces runtime assistant chunks before rendering", () => {
  const chunks: AgentMessage[] = "具体消息内容".split("").map((text, index) => ({
    id: `019dfc94-a921-7112-8980-8d57cd537787-msg-${(1000 + index).toString(36)}`,
    role: "assistant",
    text,
    timestamp: `2026-05-06T01:00:${String(index).padStart(2, "0")}.000Z`,
  }));

  assert.deepEqual(resolvePlainDisplayMessages(chunks).map((item) => item.text), [
    "具体消息内容",
  ]);
});

test("plain message timeline orders mixed sequence history by timestamp across tool calls", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "legacy-user",
          role: "user",
          text: "旧用户提问",
          timestamp: "2026-05-06T01:00:03.000Z",
        },
        {
          id: "provider-assistant",
          role: "assistant",
          text: "Provider 回复",
          timestamp: "2026-05-06T01:00:01.000Z",
          sequence: 2,
        },
      ],
      toolCalls: [
        {
          id: "tool-seq-3",
          kind: "shell",
          title: "Run tests",
          status: "completed",
          commandId: "cmd-seq-3",
          output: "PASS",
          stream: "stdout",
          timestamp: "2026-05-06T01:00:02.000Z",
          updatedAt: "2026-05-06T01:00:02.000Z",
          sequence: 3,
        },
      ],
      emptyText: "empty",
      expandedMessageIds: new Set<string>(),
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  const userIndex = html.indexOf("旧用户提问");
  const assistantIndex = html.indexOf("Provider 回复");
  const toolIndex = html.indexOf("Run tests");
  assert.ok(assistantIndex >= 0 && toolIndex > assistantIndex && userIndex > toolIndex);
});

test("plain message timeline interleaves assistant chunks with tool entries", () => {
  const timelineItems: SessionTimelineEntry[] = [
    {
      id: "assistant-entry",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-entry:content:before",
          kind: "content",
          text: "先说明。",
          timestamp: "2026-05-17T10:00:00.000Z",
          sequence: 1,
        },
        {
          id: "assistant-entry:content:after",
          kind: "content",
          text: "工具后继续输出。",
          timestamp: "2026-05-17T10:00:04.000Z",
          sequence: 4,
        },
      ],
      timestamp: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:04.000Z",
      sequence: 1,
    },
    {
      id: "tool:tool-read",
      kind: "tool_call",
      toolCall: {
        id: "tool-read",
        kind: "read",
        title: "Read file",
        status: "completed",
        output: "file content",
        timestamp: "2026-05-17T10:00:01.000Z",
        updatedAt: "2026-05-17T10:00:01.000Z",
        sequence: 2,
      },
      timestamp: "2026-05-17T10:00:01.000Z",
      updatedAt: "2026-05-17T10:00:01.000Z",
      sequence: 2,
    },
    {
      id: "tool:tool-search",
      kind: "tool_call",
      toolCall: {
        id: "tool-search",
        kind: "search",
        title: "Search code",
        status: "completed",
        output: "search result",
        timestamp: "2026-05-17T10:00:02.000Z",
        updatedAt: "2026-05-17T10:00:02.000Z",
        sequence: 3,
      },
      timestamp: "2026-05-17T10:00:02.000Z",
      updatedAt: "2026-05-17T10:00:02.000Z",
      sequence: 3,
    },
  ];
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [],
      timelineItems,
      thinkingToolCalls: [],
      toolCalls: [],
      emptyText: "empty",
      expandedMessageIds: new Set<string>(),
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.equal(html.match(/<details class="plain-tool-group/g)?.length, 1);
  assert.match(html, /工具调用 · 2 项/);
  assert.ok(html.indexOf("先说明。") < html.indexOf("工具调用 · 2 项"));
  assert.ok(html.indexOf("工具调用 · 2 项") < html.indexOf("工具后继续输出。"));
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

  assert.deepEqual(resolvePlainDisplayMessages(messages).map((item) => item.text), [
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
    resolvePlainDisplayMessages([
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

test("plain message timeline keeps a single OpenCode wrapper when no original prompt exists", () => {
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
    resolvePlainDisplayMessages([
      {
        id: "wrapper-whole",
        role: "user",
        text: wrappedPrompt,
        timestamp: "2026-05-06T01:05:01.000Z",
      },
    ]).map((item) => item.text),
    [wrappedPrompt],
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
    resolvePlainDisplayMessages(chunks, [
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
      expandedMessageIds: new Set<string>(),
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.equal(html.match(/plain-assistant-segment-dot/g)?.length, 3);
  assert.equal(html.match(/plain-message-role/g)?.length ?? 0, 0);
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
      expandedMessageIds: new Set<string>(),
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.match(html, /markdown-message/);
  assert.doesNotMatch(html, /structured-assistant-message/);
});

test("streaming assistant messages keep incomplete markdown as lightweight plain text", () => {
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

test("streaming assistant messages render completed markdown blocks before the active tail", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "assistant-streaming",
          role: "assistant",
          text: [
            "现在我已收集了足够的上下文。",
            "",
            "## Bug 根因分析",
            "",
            "概览：命令数据流",
            "",
            "slash 命令的数据流如下：",
          ].join("\n"),
          timestamp: "2026-05-12T00:00:00.000Z",
          streaming: true,
        },
      ],
      emptyText: "empty",
      expandedMessageIds: new Set<string>(),
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.match(html, /markdown-message/);
  assert.match(html, /<h2 class="markdown-heading[^"]*">Bug 根因分析<\/h2>/);
  assert.match(html, /plain-message-streaming-tail/);
  assert.match(html, /slash 命令的数据流如下：/);
});

test("streaming assistant Mermaid blocks stay as code until the message finishes", () => {
  const html = renderToStaticMarkup(
    createElement(PlainMessages, {
      sessionId: "session-1",
      items: [
        {
          id: "assistant-streaming-mermaid",
          role: "assistant",
          text: [
            "先给出已经稳定的结论：",
            "",
            "```mermaid",
            "flowchart TD",
            "  A[stream] --> B[jitter]",
            "```",
            "",
            "后续说明仍在继续输出中。",
          ].join("\n"),
          timestamp: "2026-07-06T00:00:00.000Z",
          streaming: true,
        },
      ],
      emptyText: "empty",
      expandedMessageIds: new Set<string>(),
      onLoadOlderMessages: () => {},
      onToggleExpandedMessage: () => {},
    }),
  );

  assert.match(html, /markdown-message/);
  assert.match(html, /markdown-code-block/);
  assert.match(html, /language-mermaid/);
  assert.doesNotMatch(html, /markdown-mermaid-block/);
  assert.match(html, /plain-message-streaming-tail/);
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
