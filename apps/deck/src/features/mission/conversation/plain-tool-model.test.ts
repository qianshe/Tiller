import assert from "node:assert/strict";
import test from "node:test";
import {
  formatToolInputPreview,
  isActiveToolStatus,
  resolveToolCallIconName,
  resolveToolStatusLabel,
} from "./plain-tool-model";

test("resolveToolCallIconName maps known labels", () => {
  assert.equal(resolveToolCallIconName("Read"), "fileText");
  assert.equal(resolveToolCallIconName("Search"), "search");
  assert.equal(resolveToolCallIconName("Shell"), "terminal");
  assert.equal(resolveToolCallIconName("MCP"), "server");
  assert.equal(resolveToolCallIconName("Unknown"), "inspect");
});

test("resolveToolStatusLabel maps runtime statuses", () => {
  assert.equal(resolveToolStatusLabel("completed" as any), "完成");
  assert.equal(resolveToolStatusLabel("failed" as any), "失败");
  assert.equal(resolveToolStatusLabel("waiting_for_permission" as any), "等待授权");
  assert.equal(resolveToolStatusLabel("running" as any), "运行中");
});

test("isActiveToolStatus detects pending statuses", () => {
  assert.equal(isActiveToolStatus("pending" as any), true);
  assert.equal(isActiveToolStatus("running" as any), true);
  assert.equal(isActiveToolStatus("waiting_for_permission" as any), true);
  assert.equal(isActiveToolStatus("completed" as any), false);
});

test("formatToolInputPreview pretty prints JSON and trims text", () => {
  assert.equal(formatToolInputPreview(""), "");
  assert.equal(formatToolInputPreview("  text  "), "text");
  assert.equal(formatToolInputPreview('{"a":1}'), '{\n  "a": 1\n}');
});
