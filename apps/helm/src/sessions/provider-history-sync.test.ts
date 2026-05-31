import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@tiller/shared";
import {
  buildProviderHistoryState,
  filterNewProviderHistoryMessages,
  planProviderHistorySync,
  shouldRepairProviderHistorySnapshot,
  toParagraphMessages,
  shouldImportAuthoritativeProviderHistory,
  mergeAuthoritativeMessagesWithLocalUserPrompts,
} from "./provider-history-sync.js";
import type { StoredProviderHistoryState } from "@tiller/persistence";

const baseMessage = (
  id: string,
  text: string,
  timestamp = "2026-05-07T08:00:00.000Z",
): AgentMessage => ({
  id,
  role: "assistant",
  text,
  timestamp,
});

test("buildProviderHistoryState records latest provider message hash", () => {
  const state = buildProviderHistoryState(
    [
      baseMessage("provider-1", "第一段"),
      baseMessage("provider-2", "第二段", "2026-05-07T08:01:00.000Z"),
    ],
    "2026-05-07T08:02:00.000Z",
  );

  assert.equal(state.latestMessageId, "provider-2");
  assert.equal(state.latestMessageTimestamp, "2026-05-07T08:01:00.000Z");
  assert.equal(state.messageCount, 2);
  assert.equal(state.syncedAt, "2026-05-07T08:02:00.000Z");
  assert.equal(typeof state.latestMessageHash, "string");
  assert.ok(state.latestMessageHash);
  assert.ok(state.latestMessageHash.length > 0);
});

test("planProviderHistorySync skips unchanged provider history", () => {
  const providerMessages = [baseMessage("provider-1", "没有变化")];
  const currentState = buildProviderHistoryState(
    providerMessages,
    "2026-05-07T08:00:01.000Z",
  );

  const decision = planProviderHistorySync({
    currentState,
    providerMessages,
    syncedAt: "2026-05-07T08:00:02.000Z",
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.nextState.latestMessageId, "provider-1");
});

test("planProviderHistorySync replaces when provider history gains timeline sequence metadata", () => {
  const oldProviderMessages = [baseMessage("provider-1", "没有变化")];
  const currentState = buildProviderHistoryState(
    oldProviderMessages,
    "2026-05-07T08:00:01.000Z",
  );
  const sequencedProviderMessages: AgentMessage[] = [
    {
      ...baseMessage("provider-1", "没有变化"),
      timelineSequence: 7,
    },
  ];

  const decision = planProviderHistorySync({
    currentState,
    providerMessages: sequencedProviderMessages,
    syncedAt: "2026-05-07T08:00:02.000Z",
  });

  assert.equal(decision.action, "replace");
  assert.deepEqual(decision.messages.map((message) => message.timelineSequence), [7]);
});

test("planProviderHistorySync replaces when provider history gains attachments", () => {
  const oldProviderMessages: AgentMessage[] = [
    { ...baseMessage("provider-user", "请看图"), role: "user" },
  ];
  const currentState = buildProviderHistoryState(
    oldProviderMessages,
    "2026-05-07T08:00:01.000Z",
  );
  const providerMessagesWithImage: AgentMessage[] = [
    {
      ...baseMessage("provider-user", "请看图"),
      role: "user",
      attachments: [
        {
          type: "image",
          data: "iVBORw0KGgo=",
          mimeType: "image/png",
          name: "prompt.png",
        },
      ],
    },
  ];

  const decision = planProviderHistorySync({
    currentState,
    providerMessages: providerMessagesWithImage,
    syncedAt: "2026-05-07T08:00:02.000Z",
  });

  assert.equal(decision.action, "replace");
  assert.deepEqual(decision.messages[0]?.attachments, providerMessagesWithImage[0]?.attachments);
});

test("planProviderHistorySync skips unchanged empty provider history", () => {
  const decision = planProviderHistorySync({
    currentState: {
      messageCount: 0,
      syncedAt: "2026-05-07T08:00:00.000Z",
    },
    providerMessages: [],
    syncedAt: "2026-05-07T08:00:01.000Z",
  });

  assert.equal(decision.action, "skip");
  assert.equal(decision.nextState.messageCount, 0);
});

test("shouldImportAuthoritativeProviderHistory keeps local history as the source once local messages exist", () => {
  const localMessages = [baseMessage("session-1-msg-s0", "本地流式消息")];

  assert.equal(
    shouldImportAuthoritativeProviderHistory({
      localMessages,
      currentState: undefined,
    }),
    false,
  );
});

test("shouldImportAuthoritativeProviderHistory allows provider history for empty local cache or existing provider source", () => {
  const providerMessages = [baseMessage("provider-1", "真实历史")];
  const currentState = buildProviderHistoryState(providerMessages);

  assert.equal(
    shouldImportAuthoritativeProviderHistory({
      localMessages: [],
      currentState: undefined,
    }),
    true,
  );
  assert.equal(
    shouldImportAuthoritativeProviderHistory({
      localMessages: [baseMessage("provider-1#p0", "真实历史")],
      currentState,
    }),
    true,
  );
});

test("planProviderHistorySync appends messages after known latest provider id", () => {
  const currentState: StoredProviderHistoryState = {
    latestMessageId: "provider-1",
    latestMessageHash: buildProviderHistoryState(
      [baseMessage("provider-1", "旧消息")],
      "2026-05-07T08:00:00.000Z",
    ).latestMessageHash,
    latestMessageTimestamp: "2026-05-07T08:00:00.000Z",
    messageCount: 1,
    syncedAt: "2026-05-07T08:00:00.000Z",
  };

  const decision = planProviderHistorySync({
    currentState,
    providerMessages: [
      baseMessage("provider-1", "旧消息"),
      baseMessage(
        "provider-2",
        "新消息第一段\n\n新消息第二段",
        "2026-05-07T08:01:00.000Z",
      ),
    ],
    syncedAt: "2026-05-07T08:02:00.000Z",
  });

  assert.equal(decision.action, "append");
  assert.deepEqual(decision.messages.map((message) => message.id), [
    "provider-2#p0",
    "provider-2#p1",
  ]);
  assert.equal(decision.nextState.latestMessageId, "provider-2");
});

test("planProviderHistorySync replaces when known latest provider id is missing", () => {
  const decision = planProviderHistorySync({
    currentState: {
      latestMessageId: "missing-provider-id",
      latestMessageHash: "old-hash",
      latestMessageTimestamp: "2026-05-07T08:00:00.000Z",
      messageCount: 1,
      syncedAt: "2026-05-07T08:00:00.000Z",
    },
    providerMessages: [baseMessage("provider-2", "重建历史")],
    syncedAt: "2026-05-07T08:02:00.000Z",
  });

  assert.equal(decision.action, "replace");
  assert.deepEqual(decision.messages.map((message) => message.id), [
    "provider-2#p0",
  ]);
});

test("planProviderHistorySync replaces when latest id matches but hash changed", () => {
  const decision = planProviderHistorySync({
    currentState: {
      latestMessageId: "provider-1",
      latestMessageHash: "stale-hash",
      latestMessageTimestamp: "2026-05-07T08:00:00.000Z",
      messageCount: 1,
      syncedAt: "2026-05-07T08:00:00.000Z",
    },
    providerMessages: [baseMessage("provider-1", "内容已修正")],
    syncedAt: "2026-05-07T08:02:00.000Z",
  });

  assert.equal(decision.action, "replace");
  assert.deepEqual(decision.messages.map((message) => message.text), [
    "内容已修正",
  ]);
});

test("toParagraphMessages keeps stable assistant paragraph ids and trims blank paragraphs", () => {
  const messages = toParagraphMessages([
    baseMessage("provider-1", "第一段\n\n\n第二段\n\n  \n第三段"),
  ]);

  assert.deepEqual(
    messages.map((message) => [message.id, message.text]),
    [
      ["provider-1#p0", "第一段"],
      ["provider-1#p1", "第二段"],
      ["provider-1#p2", "第三段"],
    ],
  );
});

test("toParagraphMessages keeps assistant paragraphs on the source message sequence", () => {
  const paragraphs = toParagraphMessages([
    {
      id: "assistant-1",
      role: "assistant",
      text: "first paragraph\n\nsecond paragraph\n\nthird paragraph",
      timestamp: "2026-05-28T00:00:00.000Z",
      timelineSequence: 10,
    },
  ]);

  assert.equal(paragraphs.length, 3);
  assert.deepEqual(
    paragraphs.map((message) => message.timelineSequence),
    [10, 10, 10],
  );
});

test("toParagraphMessages keeps provider user prompts as one message", () => {
  const message = baseMessage(
    "provider-user",
    [
      "IF COMPLEX - DO NOT STRUGGLE ALONE.",
      "",
      "# Task",
      "",
      "调查这个 bug 的根因。",
      "",
      "# Acceptance Criteria",
      "",
      "- 给出触发路径。",
    ].join("\n"),
  );
  const messages = toParagraphMessages([{ ...message, role: "user" }]);

  assert.deepEqual(messages, [{ ...message, role: "user" }]);
});

test("mergeAuthoritativeMessagesWithLocalUserPrompts keeps local user prompts omitted by provider history", () => {
  const localUser: AgentMessage = {
    id: "client-user-1",
    role: "user",
    text: "请检查这个 session 的消息显示。",
    timestamp: "2026-05-24T10:00:00.000Z",
  };
  const providerAssistant = baseMessage(
    "provider-assistant-1#p0",
    "已经完成检查。",
    "2026-05-24T10:01:00.000Z",
  );

  assert.deepEqual(
    mergeAuthoritativeMessagesWithLocalUserPrompts(
      [localUser],
      [providerAssistant],
    ),
    [localUser, providerAssistant],
  );
});

test("mergeAuthoritativeMessagesWithLocalUserPrompts preserves local user attachments", () => {
  const localUser: AgentMessage = {
    id: "local-user-1",
    role: "user",
    text: "describe this image",
    timestamp: "2026-05-28T00:00:00.000Z",
    timelineSequence: 1,
    attachments: [
      {
        type: "image",
        mimeType: "image/png",
        name: "image.png",
        data: "data:image/png;base64,AAA",
      },
    ],
  };
  const providerUser: AgentMessage = {
    id: "provider-user-1",
    role: "user",
    text: "describe this image",
    timestamp: "2026-05-28T00:00:01.000Z",
    timelineSequence: 2,
  };

  const merged = mergeAuthoritativeMessagesWithLocalUserPrompts([localUser], [providerUser]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, "local-user-1");
  assert.deepEqual(merged[0]?.attachments, localUser.attachments);
  assert.equal(merged[0]?.timelineSequence, 1);
});

test("mergeAuthoritativeMessagesWithLocalUserPrompts does not duplicate provider user prompts", () => {
  const localUser: AgentMessage = {
    id: "client-user-1",
    role: "user",
    text: "同一个用户问题",
    timestamp: "2026-05-24T10:00:00.000Z",
  };
  const providerUser: AgentMessage = {
    id: "provider-user-1",
    role: "user",
    text: "同一个用户问题",
    timestamp: "2026-05-24T10:00:01.000Z",
  };

  assert.deepEqual(
    mergeAuthoritativeMessagesWithLocalUserPrompts(
      [localUser],
      [providerUser],
    ),
    [providerUser],
  );
});

test("filterNewProviderHistoryMessages skips already stored paragraph ids", () => {
  const providerMessages = [
    baseMessage("provider-1", "旧消息"),
    baseMessage("provider-2", "新消息第一段\n\n新消息第二段"),
  ];
  const incomingMessages = toParagraphMessages(providerMessages.slice(1));

  assert.deepEqual(
    filterNewProviderHistoryMessages(
      [
        ...toParagraphMessages(providerMessages),
        baseMessage("local-extra", "本地额外消息"),
      ],
      incomingMessages,
    ),
    [],
  );
  assert.deepEqual(
    filterNewProviderHistoryMessages(
      [toParagraphMessages(providerMessages)[0]],
      incomingMessages,
    ).map((message) => message.id),
    ["provider-2#p0", "provider-2#p1"],
  );
});

test("shouldRepairProviderHistorySnapshot detects persisted restore replay mixed with authoritative paragraphs", () => {
  const providerMessages = [baseMessage("provider-1", "第一段\n\n第二段")];
  const authoritativeParagraphs = toParagraphMessages(providerMessages);
  const pollutedLocalMessages: AgentMessage[] = [
    baseMessage("provider-1", "第一段\n\n第二段", "2026-05-08T08:00:00.000Z"),
    ...authoritativeParagraphs,
  ];

  assert.equal(
    shouldRepairProviderHistorySnapshot(pollutedLocalMessages, providerMessages),
    true,
  );
});

test("shouldRepairProviderHistorySnapshot detects matching paragraphs missing timeline sequence metadata", () => {
  const providerMessages: AgentMessage[] = [
    {
      ...baseMessage("provider-1", "第一段\n\n第二段"),
      timelineSequence: 10,
    },
  ];
  const localMessagesWithoutSequence = toParagraphMessages([
    baseMessage("provider-1", "第一段\n\n第二段"),
  ]);

  assert.equal(
    shouldRepairProviderHistorySnapshot(localMessagesWithoutSequence, providerMessages),
    true,
  );
});

test("shouldRepairProviderHistorySnapshot detects matching user messages missing attachments", () => {
  const providerMessages: AgentMessage[] = [
    {
      id: "provider-user",
      role: "user",
      text: "请看图",
      timestamp: "2026-05-07T08:00:00.000Z",
      attachments: [
        {
          type: "image",
          data: "iVBORw0KGgo=",
          mimeType: "image/png",
          name: "prompt.png",
        },
      ],
    },
  ];
  const localMessagesWithoutAttachments: AgentMessage[] = [
    {
      id: "provider-user",
      role: "user",
      text: "请看图",
      timestamp: "2026-05-07T08:00:00.000Z",
    },
  ];

  assert.equal(
    shouldRepairProviderHistorySnapshot(localMessagesWithoutAttachments, providerMessages),
    true,
  );
});

test("shouldRepairProviderHistorySnapshot keeps matching authoritative paragraphs", () => {
  const providerMessages = [baseMessage("provider-1", "第一段\n\n第二段")];

  assert.equal(
    shouldRepairProviderHistorySnapshot(
      toParagraphMessages(providerMessages),
      providerMessages,
    ),
    false,
  );
});
