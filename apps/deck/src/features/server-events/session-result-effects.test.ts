import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, SessionCleanupResult, SessionHistoryReimportResult } from "@tiller/shared";
import {
  deriveSessionReimportState,
  resolveSessionCleanupToast,
} from "./session-result-effects.js";

function message(id: string, timestamp: string): AgentMessage {
  return { id, role: "assistant", text: id, timestamp } as AgentMessage;
}

test("deriveSessionReimportState sorts messages and builds history state", () => {
  const payload: SessionHistoryReimportResult = {
    sessionId: "s1",
    messages: [
      message("late", "2026-05-29T00:02:00.000Z"),
      message("early", "2026-05-29T00:01:00.000Z"),
    ],
    outputs: [],
    diffs: [],
    toolCalls: [],
    nextCursor: "older-message",
    hasMore: true,
    activityNextCursor: "older-activity",
    activityHasMore: false,
    message: "已重新导入",
  };

  const state = deriveSessionReimportState(payload);

  assert.deepEqual(state.messages.map((item) => item.id), ["early", "late"]);
  assert.deepEqual(state.messageHistoryState, {
    nextCursor: "older-message",
    hasMore: true,
    loading: false,
  });
  assert.deepEqual(state.activityHistoryState, {
    nextCursor: "older-activity",
    hasMore: false,
    loading: false,
  });
  assert.deepEqual(state.toast, { tone: "success", message: "已重新导入" });
});

test("resolveSessionCleanupToast maps remote cleanup outcomes", () => {
  const base: SessionCleanupResult = {
    sessionId: "s1",
    localDeleted: true,
    remoteDeleted: false,
    remoteDeletionAttempted: false,
    message: "本地已删除",
  };

  assert.deepEqual(resolveSessionCleanupToast({ ...base, remoteDeleted: true }), {
    tone: "success",
    message: "会话已删除",
  });
  assert.deepEqual(resolveSessionCleanupToast({ ...base, remoteDeletionAttempted: true, message: "远端删除失败" }), {
    tone: "warning",
    message: "远端删除失败",
  });
  assert.deepEqual(resolveSessionCleanupToast(base), {
    tone: "info",
    message: "本地已删除",
  });
});
