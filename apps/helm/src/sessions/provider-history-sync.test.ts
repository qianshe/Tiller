import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@tiller/shared";
import {
  buildProviderHistoryState,
  planProviderHistorySync,
  shouldRepairProviderHistorySnapshot,
  toParagraphMessages,
} from "./provider-history-sync.js";
import type { StoredProviderHistoryState } from "./runtime-store.js";

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
