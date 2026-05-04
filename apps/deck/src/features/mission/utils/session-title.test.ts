import assert from "node:assert/strict";
import test from "node:test";
import {
  createFallbackSessionTitle,
  normalizeGeneratedSessionTitle,
  resolveSessionTitleChatCompletionsUrl,
} from "./session-title.js";

test("fallback session titles strip punctuation and cap to five chars", () => {
  assert.equal(createFallbackSessionTitle("  修复：Deck Stage 5!!!"), "修复Dec");
});

test("fallback session titles use a default when prompt has no words", () => {
  assert.equal(createFallbackSessionTitle("!!!"), "新任务");
});

test("generated session titles normalize markdown and whitespace", () => {
  assert.equal(normalizeGeneratedSessionTitle("# `类型化 收尾！`"), "类型化收尾");
});

test("session title URL resolver accepts base, v1, and final endpoint forms", () => {
  assert.equal(
    resolveSessionTitleChatCompletionsUrl("https://api.example.com"),
    "https://api.example.com/v1/chat/completions",
  );
  assert.equal(
    resolveSessionTitleChatCompletionsUrl("https://api.example.com/v1"),
    "https://api.example.com/v1/chat/completions",
  );
  assert.equal(
    resolveSessionTitleChatCompletionsUrl(
      "https://api.example.com/v1/chat/completions",
    ),
    "https://api.example.com/v1/chat/completions",
  );
});
