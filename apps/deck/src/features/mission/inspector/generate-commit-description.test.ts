import assert from "node:assert/strict";
import test from "node:test";
import { generateCommitDescription } from "./generate-commit-description.js";

const baseConfig = {
  enabled: true,
  baseUrl: "https://api.example.com",
  apiKey: "",
  model: "gpt-4.1-mini",
  systemPrompt: "",
  instructionTemplate: "",
};

test("generateCommitDescription reuses OpenAI-compatible URL normalization", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "fix：修复 Git 状态展示" } }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const message = await generateCommitDescription(
    {
      selectedPaths: ["apps/deck/src/features/mission/display/panel.tsx"],
      projectName: "Tiller",
      sessionTitle: "修复 Git 状态展示",
      llmConfig: baseConfig,
    },
    fetcher,
  );

  assert.equal(message, "fix：修复 Git 状态展示");
  assert.equal(calls[0]?.url, "https://api.example.com/v1/chat/completions");
  assert.equal(
    (calls[0]?.init.headers as Record<string, string>).Authorization,
    undefined,
  );
});

test("generateCommitDescription accepts a final chat completions endpoint and optional API key", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "feat：补充 commit 描述生成" } }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  await generateCommitDescription(
    {
      selectedPaths: ["apps/deck/src/features/mission/inspector/generate-commit-description.ts"],
      llmConfig: {
        ...baseConfig,
        baseUrl: "https://api.example.com/v1/chat/completions",
        apiKey: "secret",
      },
    },
    fetcher,
  );

  assert.equal(
    calls[0]?.url,
    "https://api.example.com/v1/chat/completions",
  );
  assert.equal(
    (calls[0]?.init.headers as Record<string, string>).Authorization,
    "Bearer secret",
  );
});
