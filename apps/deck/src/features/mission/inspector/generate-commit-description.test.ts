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
      selectedChanges: [
        {
          path: "apps/deck/src/features/mission/display/panel.tsx",
          status: "modified",
          patch: "@@ -1,3 +1,4 @@\n-const oldValue = true;\n+const oldValue = false;",
        },
      ],
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
      selectedChanges: [
        {
          path: "apps/deck/src/features/mission/inspector/generate-commit-description.ts",
          status: "modified",
          patch: "@@ -1,3 +1,8 @@\n+const nextValue = true;",
        },
      ],
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

test("generateCommitDescription uses the required commit message system prompt", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "feat：优化提交描述生成" } }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  await generateCommitDescription(
    {
      selectedChanges: [
        {
          path: "apps/deck/src/features/mission/inspector/generate-commit-description.ts",
          status: "modified",
          patch: "@@ -1,3 +1,8 @@\n+const nextValue = true;",
        },
      ],
      llmConfig: baseConfig,
    },
    fetcher,
  );

  const body = JSON.parse(String(calls[0]?.init.body)) as {
    messages: Array<{ role: string; content: string }>;
  };
  const systemMessage = body.messages.find((message) => message.role === "system");
  const userMessage = body.messages.find((message) => message.role === "user");

  assert.equal(
    systemMessage?.content,
    `## Commit message

You are an expert at writing Git commits. Your job is to write a short clear commit message that summarizes the changes.

If you can accurately express the change in just the subject line, don't include anything in the message body. Only use the body when it is providing *useful* information.

Don't repeat information from the subject line in the message body.

Only return the commit message in your response. Do not include any additional meta-commentary about the task. Do not include the raw diff output in the commit message.

Follow good Git style:

- Separate the subject from the body with a blank line
- Try to limit the subject line to 50 characters
- Capitalize the subject line
- Do not end the subject line with any punctuation
- Use the imperative mood in the subject line
- Wrap the body at 72 characters
- Keep the body short and concise (omit it entirely if not useful)
- 使用中文
- 用标准格式，如：
feat：标题
内容`,
  );
  assert.match(userMessage?.content ?? "", /# Git 变更/u);
  assert.doesNotMatch(userMessage?.content ?? "", /会话|项目背景|任务背景/u);
});
