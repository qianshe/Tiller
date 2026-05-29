import assert from "node:assert/strict";
import test from "node:test";
import {
  acpReconnectKey,
  formatAcpConnectionStatus,
  formatRuntimeSessionCount,
  isManagedWorktreeWorktree,
  normalizeWorktreePath,
} from "./runtime-display";

test("acpReconnectKey builds stable keys with fallbacks", () => {
  assert.equal(acpReconnectKey("codex", "D:/repo"), "codex::D:/repo");
  assert.equal(acpReconnectKey(undefined, undefined), "unknown::global");
});

test("formatRuntimeSessionCount includes active count only when different", () => {
  assert.equal(formatRuntimeSessionCount(2), "2 个会话");
  assert.equal(formatRuntimeSessionCount(2, 2), "2 个会话");
  assert.equal(formatRuntimeSessionCount(2, 1), "2 个会话 · 1 活跃");
});

test("formatAcpConnectionStatus maps known statuses", () => {
  assert.equal(formatAcpConnectionStatus("ready"), "已连接");
  assert.equal(formatAcpConnectionStatus("opening"), "连接中");
  assert.equal(formatAcpConnectionStatus("error"), "连接异常");
  assert.equal(formatAcpConnectionStatus("closed"), "已关闭");
  assert.equal(formatAcpConnectionStatus("custom"), "custom");
  assert.equal(formatAcpConnectionStatus(""), "未知");
});

test("worktree path helpers normalize and detect managed paths", () => {
  assert.equal(normalizeWorktreePath("D:\\Repo\\.worktrees\\task\\"), "d:/repo/.worktrees/task");
  assert.equal(isManagedWorktreeWorktree({ path: "D:/Repo/.tiller/worktrees/task" }), true);
  assert.equal(isManagedWorktreeWorktree({ path: "D:/Repo/main" }), false);
});
