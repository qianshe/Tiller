import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssistantHandoffPromptInput,
  DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
  enhancePromptWithLlm,
  generateAssistantHandoffPrompt,
  isPromptEnhancerLlmConfigured,
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

test("isPromptEnhancerLlmConfigured requires enabled base URL and model", () => {
  assert.equal(isPromptEnhancerLlmConfigured(basePreferences.llm), true);
  assert.equal(
    isPromptEnhancerLlmConfigured({ ...basePreferences.llm, enabled: false }),
    false,
  );
  assert.equal(
    isPromptEnhancerLlmConfigured({ ...basePreferences.llm, baseUrl: " " }),
    false,
  );
  assert.equal(
    isPromptEnhancerLlmConfigured({ ...basePreferences.llm, model: " " }),
    false,
  );
});

test("buildAssistantHandoffPromptInput treats the final assistant block as a direction anchor", () => {
  const prompt = buildAssistantHandoffPromptInput({
    assistantBlockText: "结论：只做复制按钮和 Handoff 草稿。",
    projectName: "Tiller",
    sessionStatus: "running",
    sessionSummary: "用户要求不要把 Handoff 变成原文复制。",
  });

  assert.match(prompt, /<conversation_context>/);
  assert.match(prompt, /Project: Tiller/);
  assert.match(prompt, /用户要求不要把 Handoff 变成原文复制/);
  assert.match(prompt, /<latest_assistant_direction_anchor>/);
  assert.match(prompt, /结论：只做复制按钮和 Handoff 草稿/);
  assert.match(prompt, /Do not merely copy or paraphrase/);
});

test("generateAssistantHandoffPrompt calls the prompt enhancer LLM with context and anchor", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "请基于当前计划继续实现 Copy + Handoff。" } }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  const handoff = await generateAssistantHandoffPrompt(
    {
      assistantBlockText: "最后回复：Handoff 要整理会话上下文，不是原文复制。",
      projectName: "Tiller",
      worktreeName: "Deck",
      projectSummary: "Tiller is a local-first command deck.",
      sessionStatus: "running",
      sessionSummary: "用户希望最后 assistant 块下方显示 Copy 和 Handoff。",
    },
    basePreferences,
    fetcher,
  );

  assert.equal(handoff, "请基于当前计划继续实现 Copy + Handoff。");
  assert.equal(calls[0]?.url, "https://example.test/v1/chat/completions");
  const body = String(calls[0]?.init.body);
  assert.match(body, /prompt-model/);
  assert.match(body, /latest assistant block only as the direction anchor/);
  assert.match(body, /Do not merely copy or paraphrase/);
  assert.match(body, /Tiller is a local-first command deck/);
  assert.match(body, /Handoff 要整理会话上下文，不是原文复制/);
});

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
  assert.match(body, /Do not include explanations, confirmations, caveats/);
  assert.match(body, /Do not say 'if this is the bug'/);
  assert.match(body, /Do not add output format sections unless the user explicitly asks for them/);
  assert.match(body, /Avoid boilerplate Verification sections for discussion or investigation drafts/);
  assert.match(body, /Prefer no headings for short drafts/);
  assert.match(body, /At most two useful sections/);
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

test("enhancePromptWithLlm strips meta preface before the usable prompt", async () => {
  const fetcher = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                "根据会话上下文，如果你指的是这个 bug，请使用以下 prompt:\n\n# Task\n检查重复消息。\n\n# Verification\n说明结果。",
            },
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;

  const enhanced = await enhancePromptWithLlm(
    "查一下重复消息",
    basePreferences,
    {},
    fetcher,
  );

  assert.equal(enhanced, "# Task\n检查重复消息。\n\n# Verification\n说明结果。");
});

test("enhancePromptWithLlm strips single-line enhanced prompt labels", async () => {
  const fetcher = (async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: "优化后的提示词如下：检查设置页。" } }] }),
      { status: 200 },
    )) as typeof fetch;

  const enhanced = await enhancePromptWithLlm(
    "检查设置页",
    basePreferences,
    {},
    fetcher,
  );

  assert.equal(enhanced, "检查设置页。");
});

test("enhancePromptWithLlm strips explanatory preface before separator prompts", async () => {
  const fetcher = (async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: [
                "根据会话摘要，问题是数据层缺少过滤导致重复 user 消息。",
                "我将把‘怎么解决’转化为一个可执行的修复规划 prompt。",
                "",
                "---",
                "",
                "Bug 4 的根因已确认：OpenCode wrapper echo 会写入本地历史。",
                "请先给出修复方案，不要直接改代码。",
              ].join("\n"),
            },
          },
        ],
      }),
      { status: 200 },
    )) as typeof fetch;

  const enhanced = await enhancePromptWithLlm(
    "怎么解决",
    basePreferences,
    {},
    fetcher,
  );

  assert.equal(
    enhanced,
    "Bug 4 的根因已确认：OpenCode wrapper echo 会写入本地历史。\n请先给出修复方案，不要直接改代码。",
  );
});

test("enhancePromptWithLlm compacts duplicate private reference context", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200 },
    );
  }) as typeof fetch;

  await enhancePromptWithLlm(
    "优化提示词",
    basePreferences,
    {
      projectSummary: [
        "Project: Tiller",
        "Project: Tiller",
        "AGENTS.md: 遵守项目规则",
        "AGENTS.md: 遵守项目规则",
      ].join("\n"),
      sessionSummary: [
        "最近问答与结论：",
        "- 助手结论：Bug 4 在当前代码base 中仍处于未修复状态。",
        "- 助手结论：Bug 4 在当前代码base 中仍处于未修复状态。",
      ].join("\n"),
    },
    fetcher,
  );

  const body = String(calls[0]?.init.body);
  assert.equal((body.match(/Project: Tiller/g) ?? []).length, 0);
  assert.equal((body.match(/AGENTS\.md: 遵守项目规则/g) ?? []).length, 1);
  assert.equal((body.match(/Bug 4 在当前代码base 中仍处于未修复状态/g) ?? []).length, 1);
});

test("enhancePromptWithLlm keeps AGENTS project context and drops CLAUDE README blocks", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200 },
    );
  }) as typeof fetch;

  await enhancePromptWithLlm(
    "优化提示词",
    basePreferences,
    {
      projectSummary: [
        "Project: Tiller",
        "Configured summary: Project: Tiller Worktree: codex/session-prompt-queue Path: D:/repo",
        "AGENTS.md:",
        "# Tiller - AI Agent 开发指南",
        "## 项目简介",
        "Tiller 是 local-first command deck。",
        "CLAUDE.md:",
        "本项目的 AI Agent 开发指南以 AGENTS.md 为唯一维护入口。",
        "README.md:",
        "Session summary: 最近问答与结论：",
      ].join("\n"),
    },
    fetcher,
  );

  const body = String(calls[0]?.init.body);
  assert.doesNotMatch(body, /Project: Tiller/);
  assert.doesNotMatch(body, /Worktree: codex\/session-prompt-queue/);
  assert.match(body, /AGENTS\.md:/);
  assert.match(body, /Tiller 是 local-first command deck/);
  assert.doesNotMatch(body, /CLAUDE\.md:/);
  assert.doesNotMatch(body, /README\.md:/);
  assert.doesNotMatch(body, /唯一维护入口/);
  assert.doesNotMatch(body, /Session summary: 最近问答与结论/);
});

test("enhancePromptWithLlm ignores hidden custom system prompt and instruction template", async () => {
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
        systemPrompt: "CUSTOM SYSTEM PROMPT",
        instructionTemplate: "CUSTOM AUGMENT TEMPLATE",
      },
    },
    {},
    fetcher,
  );

  const body = String(calls[0]?.init.body);
  assert.doesNotMatch(body, /CUSTOM AUGMENT TEMPLATE/);
  assert.doesNotMatch(body, /CUSTOM SYSTEM PROMPT/);
  assert.match(body, /Enhance the user draft into a concise, precise prompt/);
  assert.match(body, /你是一个 coding-agent 提示词增强器/);
});

test("enhancePromptWithLlm renders built-in instruction template tags", async () => {
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
  assert.match(body, /Project summary: Deck\/Helm project summary/);
  assert.match(body, /Session summary: User is tuning Settings/);
  assert.match(body, /<user_draft>\\n检查设置页\\n<\/user_draft>/);
  assert.doesNotMatch(body, /项目=Deck\/Helm project summary/);
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
