import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, CommandChunk, AgentToolCall, FileDiffSummary } from "@tiller/shared";
import { createStore } from "zustand/vanilla";
import { createMessagesSlice, type MessagesSlice } from "./messages-slice.js";

function createTestStore() {
  return createStore<MessagesSlice>()((...args) => ({ ...createMessagesSlice(...args) }));
}

test("message maps support value and updater forms", () => {
  const store = createTestStore();
  const message: AgentMessage = { id: "m1", role: "user", text: "hi", timestamp: "now" };
  store.getState().setMessages({ s1: [message] });
  store.getState().setMessages((current) => ({ ...current, s1: [...(current.s1 ?? []), { ...message, id: "m2" }] }));
  assert.deepEqual(store.getState().messages.s1?.map((item) => item.id), ["m1", "m2"]);
});

test("artifact maps support updater forms", () => {
  const store = createTestStore();
  const output: CommandChunk = { id: "o1", commandId: "c1", stream: "stdout", text: "ok", timestamp: "now" };
  const tool = { id: "t1" } as unknown as AgentToolCall;
  const diff: FileDiffSummary = { path: "file.ts", status: "modified", additions: 1, deletions: 0 };
  store.getState().setOutputs({ s1: [output] });
  store.getState().setToolCalls({ s1: [tool] });
  store.getState().setDiffs((current) => ({ ...current, s1: [diff] }));
  assert.equal(store.getState().outputs.s1?.[0]?.text, "ok");
  assert.equal(store.getState().toolCalls.s1?.[0]?.id, "t1");
  assert.equal(store.getState().diffs.s1?.[0]?.path, "file.ts");
});

test("messages slice stores session plans by session id", () => {
  const store = createTestStore();
  const plan = {
    entries: [{ content: "Render drawer", priority: "medium" as const, status: "pending" as const }],
    updatedAt: "2026-06-02T00:00:00.000Z",
  };

  store.getState().setSessionPlans({ s1: plan });

  assert.deepEqual(store.getState().sessionPlans.s1, plan);
});
