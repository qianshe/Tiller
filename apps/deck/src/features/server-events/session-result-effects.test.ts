import assert from "node:assert/strict";
import test from "node:test";
import type { SessionCleanupResult } from "@tiller/shared";
import { resolveSessionCleanupToast } from "./session-result-effects.js";

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
