import assert from "node:assert/strict";
import test from "node:test";
import {
  createFallbackSessionTitle,
  generateSessionTitleWithLlm,
  normalizeGeneratedSessionTitle,
  resolveRegeneratedSessionTitle,
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

test("generated session titles keep a readable short display segment", () => {
  assert.equal(
    normalizeGeneratedSessionTitle("修复会话重命名提示词过严的问题"),
    "修复会话重命名提示词过严的问题",
  );
});

test("generated session titles reject tool call payloads", () => {
  assert.equal(
    normalizeGeneratedSessionTitle(
      "<tool_call>\n<function=Task>\n<parameter=description>Find fleet page edit components</parameter>\n</function>\n</tool_call>",
    ),
    "",
  );
});

test("session title LLM prompt explicitly asks to reply with only the name", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: any;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "会话命名" } }] }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const title = await generateSessionTitleWithLlm("修复会话重命名", {
      enabled: true,
      baseUrl: "https://api.example.com",
      apiKey: "",
      model: "title-model",
      systemPrompt: "",
      instructionTemplate: "",
    });

    assert.equal(title, "会话命名");
    assert.match(requestBody.messages[0].content, /只回复名称/u);
    assert.match(requestBody.messages[1].content, /请为以下内容生成会话名称/u);
    assert.match(requestBody.messages[1].content, /只回复名称/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("regenerated session titles use the configured LLM when available", async () => {
  const title = await resolveRegeneratedSessionTitle(
    "  设计一个会话操作菜单  ",
    {
      enabled: true,
      baseUrl: "https://api.example.com",
      apiKey: "key",
      model: "title-model",
      systemPrompt: "",
      instructionTemplate: "",
    },
    async () => "会话菜单",
  );

  assert.equal(title, "会话菜单");
});

test("regenerated session titles fall back when LLM is not configured", async () => {
  const title = await resolveRegeneratedSessionTitle(
    "  设计：会话操作菜单  ",
    {
      enabled: true,
      baseUrl: "",
      apiKey: "",
      model: "",
      systemPrompt: "",
      instructionTemplate: "",
    },
    async () => {
      throw new Error("LLM should not be called");
    },
  );

  assert.equal(title, "设计会话操");
});

test("regenerated session titles keep fallback when LLM fails", async () => {
  const title = await resolveRegeneratedSessionTitle(
    "  修复：任务标题  ",
    {
      enabled: true,
      baseUrl: "https://api.example.com",
      apiKey: "",
      model: "title-model",
      systemPrompt: "",
      instructionTemplate: "",
    },
    async () => {
      throw new Error("offline");
    },
  );

  assert.equal(title, "修复任务标");
});
