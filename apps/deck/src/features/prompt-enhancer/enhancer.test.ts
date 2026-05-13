import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
  enhancePromptWithLlm,
  listPromptEnhancerModels,
  testPromptEnhancerConnectivity,
  type PromptEnhancerPreferences,
} from "./enhancer.js";

const basePreferences: PromptEnhancerPreferences = {
  enabled: true,
  llm: {
    enabled: true,
    baseUrl: "https://example.test/v1",
    apiKey: "secret",
    model: "prompt-model",
    systemPrompt: "只返回增强后的提示词。",
    instructionTemplate: DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
  },
};

test("enhancePromptWithLlm calls an OpenAI-compatible endpoint when configured", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "LLM enhanced prompt" } }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const enhanced = await enhancePromptWithLlm(
    "修设置页面",
    basePreferences,
    {
      projectName: "Tiller",
      worktreeName: "apps/deck",
      projectSummary: "Tiller is a Deck + Helm ACP command app.",
      worktreeSummary: "Deck frontend worktree.",
      sessionStatus: "running",
      sessionSummary: "正在打磨 Settings 页面",
    },
    fetcher,
  );

  assert.equal(enhanced, "LLM enhanced prompt");
  assert.equal(calls[0]?.url, "https://example.test/v1/chat/completions");
  assert.equal(
    (calls[0]?.init.headers as Record<string, string>).Authorization,
    "Bearer secret",
  );
  assert.match(String(calls[0]?.init.body), /prompt-model/);
  assert.match(String(calls[0]?.init.body), /修设置页面/);
  const body = String(calls[0]?.init.body);
  assert.match(body, /Project summary/);
  assert.match(body, /Tiller is a Deck \+ Helm ACP command app/);
  assert.match(body, /Session summary/);
  assert.doesNotMatch(body, /Current model/);
  assert.doesNotMatch(body, /Codex/);
});

test("default prompt enhancer treats project and session context as private reference", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200 },
    );
  }) as typeof fetch;

  await enhancePromptWithLlm(
    "帮我修一下任务页项目栏",
    basePreferences,
    {
      projectSummary: "Tiller has a Deck frontend and Helm runtime.",
      sessionSummary: "User is debugging mission Helm visibility.",
    },
    fetcher,
  );

  const body = String(calls[0]?.init.body);
  assert.match(body, /<private_reference>/);
  assert.match(body, /Treat private reference as non-output context/);
  assert.match(body, /<user_draft>/);
  assert.match(body, /Output contract/);
  assert.match(body, /Use the user's language/);
  assert.match(body, /If the draft is already actionable/);
  assert.match(body, /Preserve the task mode/);
  assert.match(body, /Do not mention private reference/);
  assert.match(body, /If the user asks to plan a new product or app/);
  assert.match(body, /If the user asks to adjust an existing screen/);
  assert.match(body, /ask the coding agent to inspect the relevant files/);
  assert.match(
    body,
    /Do not name files, components, APIs, or repository facts unless/,
  );
  assert.match(
    body,
    /For new product ideas, label inferred features as options/,
  );
  assert.match(body, /not fixed requirements/);
  assert.match(body, /Do not add constraints unless/);
  assert.match(body, /Do not turn planning or discussion into implementation/);
  assert.match(body, /Apply the internal workflow silently/);
  assert.match(
    body,
    /Keep → Drop → Clarify → Inspect → Propose → Verify → Defer/,
  );
  assert.match(body, /Enhancement patterns/);
  assert.match(body, /Existing project change/);
  assert.match(body, /New product or app/);
  assert.match(body, /phrase them as options or questions/);
  assert.match(body, /directly usable as the user's next message/);
  assert.match(body, /Do not prefix it with meta commentary/);
  assert.match(body, /Do not output guessed file paths/);
  assert.doesNotMatch(body, /AGENTS/);
  assert.doesNotMatch(body, /# Context/);
  assert.doesNotMatch(body, /# Constraints/);
});

test("enhancePromptWithLlm rejects when LLM config is missing", async () => {
  await assert.rejects(
    () =>
      enhancePromptWithLlm("修设置页面", {
        enabled: true,
        llm: { ...basePreferences.llm, baseUrl: "" },
      }),
    /LLM is not configured/,
  );
});

test("enhancePromptWithLlm rejects empty LLM output", async () => {
  const fetcher = (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), {
      status: 200,
    })) as typeof fetch;
  await assert.rejects(
    () => enhancePromptWithLlm("修设置页面", basePreferences, {}, fetcher),
    /empty content/,
  );
});

test("enhancePromptWithLlm strips markdown fences from LLM output", async () => {
  const fetcher = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          { message: { content: "```markdown\n## 目标\n检查设置页。\n```" } },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;

  const enhanced = await enhancePromptWithLlm(
    "检查设置页",
    basePreferences,
    {},
    fetcher,
  );

  assert.equal(enhanced, "## 目标\n检查设置页。");
});

test("enhancePromptWithLlm uses the configured instruction template", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200 },
    );
  }) as typeof fetch;

  await enhancePromptWithLlm(
    "检查设置页",
    {
      ...basePreferences,
      llm: {
        ...basePreferences.llm,
        instructionTemplate: "CUSTOM AUGMENT TEMPLATE",
      },
    },
    {},
    fetcher,
  );

  assert.match(String(calls[0]?.init.body), /CUSTOM AUGMENT TEMPLATE/);
});

test("enhancePromptWithLlm replaces instruction template tags", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200 },
    );
  }) as typeof fetch;

  await enhancePromptWithLlm(
    "检查设置页",
    {
      ...basePreferences,
      llm: {
        ...basePreferences.llm,
        instructionTemplate:
          "\u9879\u76ee={{projectSummary}}\\n\u4f1a\u8bdd={{sessionSummary}}\\n\u8349\u7a3f={{userPrompt}}",
      },
    },
    {
      projectSummary: "Deck/Helm project summary",
      sessionSummary: "User is tuning Settings",
    },
    fetcher,
  );

  const body = String(calls[0]?.init.body);
  assert.match(body, /项目=Deck\/Helm project summary/);
  assert.match(body, /会话=User is tuning Settings/);
  assert.match(body, /草稿=检查设置页/);
});

test("testPromptEnhancerConnectivity only sends a minimal ping", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200 },
    );
  }) as typeof fetch;

  await testPromptEnhancerConnectivity(basePreferences.llm, fetcher);

  const body = String(calls[0]?.init.body);
  assert.match(body, /ping/);
  assert.doesNotMatch(body, /Project summary/);
  assert.doesNotMatch(body, /User draft/);
});

test("listPromptEnhancerModels calls the OpenAI-compatible models endpoint", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        data: [
          { id: "gpt-a", owned_by: "openai" },
          { id: "gpt-b", owned_by: "local" },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const models = await listPromptEnhancerModels(basePreferences.llm, fetcher);

  assert.deepEqual(models, [
    { id: "gpt-a", ownedBy: "openai" },
    { id: "gpt-b", ownedBy: "local" },
  ]);
  assert.equal(calls[0]?.url, "https://example.test/v1/models");
  assert.equal(
    (calls[0]?.init.headers as Record<string, string>).Authorization,
    "Bearer secret",
  );
});

test("listPromptEnhancerModels appends v1 when base URL omits it", async () => {
  const calls: string[] = [];
  const fetcher = (async (url: RequestInfo | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as typeof fetch;

  await listPromptEnhancerModels(
    { ...basePreferences.llm, baseUrl: "http://localhost:8317" },
    fetcher,
  );

  assert.equal(calls[0], "http://localhost:8317/v1/models");
});

test("enhancePromptWithLlm appends v1 when base URL omits it", async () => {
  const calls: string[] = [];
  const fetcher = (async (url: RequestInfo | URL) => {
    calls.push(String(url));
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200 },
    );
  }) as typeof fetch;

  await enhancePromptWithLlm(
    "修设置页面",
    {
      ...basePreferences,
      llm: { ...basePreferences.llm, baseUrl: "http://localhost:8317" },
    },
    {},
    fetcher,
  );

  assert.equal(calls[0], "http://localhost:8317/v1/chat/completions");
});

test("listPromptEnhancerModels reads non-OpenAI model payload shapes", async () => {
  const fetcher = (async () =>
    new Response(
      JSON.stringify({ models: [{ name: "local-model" }, "raw-model"] }),
      { status: 200 },
    )) as typeof fetch;

  const models = await listPromptEnhancerModels(basePreferences.llm, fetcher);

  assert.deepEqual(models, [
    { id: "local-model", ownedBy: "default" },
    { id: "raw-model", ownedBy: "default" },
  ]);
});
