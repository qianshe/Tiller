import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentMessage, SessionTimelineEntry } from "@tiller/shared";
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

test("plain message display recomputes the timeline boundary when hasMore changes", () => {
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
  const liveMessages: AgentMessage[] = [
    {
      id: "assistant-live-older",
      role: "assistant",
      text: "更早的 fallback 回复",
      timestamp: "2026-05-17T10:00:00.500Z",
      timelineSequence: 1,
    },
  ];

  const whilePaged = resolvePlainConversationDisplayItems({
    displayMessages: liveMessages,
    timelineItems,
    showThinking: true,
    thinkingToolCalls: [],
    toolCalls: [],
    timelineHasMore: true,
  });
  const afterBoundaryResolved = resolvePlainConversationDisplayItems({
    displayMessages: liveMessages,
    timelineItems,
    showThinking: true,
    thinkingToolCalls: [],
    toolCalls: [],
    timelineHasMore: false,
  });

  assert.equal(whilePaged.some((item) => item.kind === "message" && item.message.id === "assistant-live-older"), false);
  assert.equal(afterBoundaryResolved.some((item) => item.kind === "message" && item.message.id === "assistant-live-older"), true);
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
          timelineSequence: 2,
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
          timelineSequence: 3,
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
          timelineSequence: 1,
        },
        {
          id: "assistant-entry:content:after",
          kind: "content",
          text: "工具后继续输出。",
          timestamp: "2026-05-17T10:00:04.000Z",
          timelineSequence: 4,
        },
      ],
      timestamp: "2026-05-17T10:00:00.000Z",
      updatedAt: "2026-05-17T10:00:04.000Z",
      timelineSequence: 1,
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
        timelineSequence: 2,
      },
      timestamp: "2026-05-17T10:00:01.000Z",
      updatedAt: "2026-05-17T10:00:01.000Z",
      timelineSequence: 2,
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
        timelineSequence: 3,
      },
      timestamp: "2026-05-17T10:00:02.000Z",
      updatedAt: "2026-05-17T10:00:02.000Z",
      timelineSequence: 3,
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
