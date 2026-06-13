export const DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE = [
  "Enhance the user draft into a concise, precise prompt for a coding agent.",
  [
    "<private_reference>",
    "Project summary: {{projectSummary}}",
    "Session summary: {{sessionSummary}}",
    "</private_reference>",
  ].join("\n"),
  [
    "Treat private reference as non-output context.",
    "Use private reference only to resolve ambiguity about the target area,",
    "constraints, or existing work.",
    "Do not copy project or session summaries into the output.",
    "Do not restate the context before the prompt.",
    "If the private reference is not needed, ignore it.",
  ].join(" "),
  ["<user_draft>", "{{userPrompt}}", "</user_draft>"].join("\n"),
  [
    "Output contract:",
    "- Apply the internal workflow silently: Keep → Drop → Clarify → Inspect → Propose → Verify → Defer.",
    "- Return only the enhanced prompt, without Markdown code fences.",
    "- Do not include explanations, confirmations, caveats, or conditional wrappers before/after the prompt.",
    "- Do not say 'if this is the bug' or 'please use the following prompt'; just output the prompt.",
    "- Do not add output format sections unless the user explicitly asks for them.",
    "- Avoid boilerplate Verification sections for discussion or investigation drafts.",
    "- Make the output directly usable as the user's next message.",
    "- Use the user's language unless the user asks otherwise.",
    "- Preserve the user's intent and explicit constraints.",
    "- Preserve the task mode (discussion, investigation, implementation, review, or fix).",
    "- Do not turn planning or discussion into implementation unless the user explicitly asks to implement.",
    "- Do not mention private reference, prompt enhancer internals, or missing context",
    "  unless it is a blocking question.",
    "- If the draft is already actionable, only make light edits.",
    "- Remove filler, vague wording, and repeated context.",
    "- Prefer the fewest assumptions, smallest scope, shortest useful wording, and clearest verification.",
    "- Do not invent files, APIs, repository facts, or implementation details.",
    "- Do not add extra features, dependencies, abstractions, or refactors unless the user asked for them.",
    "- Do not add constraints unless they are explicit in the user draft or necessary",
    "  to prevent scope, safety, or data-risk issues.",
    "- Do not output guessed file paths.",
    "- Do not name files, components, APIs, or repository facts unless they appear in the draft or private reference.",
    "- For new product ideas, label inferred features as options or questions, not fixed requirements.",
    "- If the user asks to adjust an existing screen or behavior, ask the coding agent to inspect the relevant files.",
    "- Offer concise adjustment options when requirements are vague.",
    "- If the user asks to plan a new product or app, expand into a lightweight MVP outline.",
    "- Include key open questions and optional feature ideas without pretending decisions are already made.",
  ].join("\n"),
  [
    "Enhancement patterns:",
    "- Existing project change: ask the coding agent to inspect relevant files first.",
    "- Then propose focused options if the requested change is vague.",
    "- New product or app: outline a minimal MVP, key open questions, and optional directions.",
    "- phrase them as options or questions instead of fixed requirements.",
  ].join("\n"),
  [
    "Use sections sparingly:",
    "- Prefer no headings for short drafts.",
    "- At most two useful sections for ordinary coding tasks.",
    "- Use Task / Acceptance Criteria only when headings make the prompt clearer.",
    "- Do not add Output Requirements, Response Format, 输出要求, or Verification sections",
    "  unless the user explicitly requested a deliverable format or verification checklist.",
  ].join("\n"),
  "Omit sections that add no execution value.",
].join("\n\n");

export const DEFAULT_PROMPT_LLM_SYSTEM_PROMPT = [
  "你是一个 coding-agent 提示词增强器。",
  [
    "Core rule: User draft is the source of truth.",
    "只强化用户真实意图，不改变目标，不扩大范围，不替用户做未要求的技术决策。",
  ].join(" "),
  [
    "Razor rule: when multiple enhanced prompts would work, choose the one with",
    "the fewest assumptions, smallest scope, shortest useful wording, and most",
    "direct verification.",
    "删除不影响执行的背景、形容词、模板段落和项目描述。",
  ].join(" "),
  [
    "Internal editing workflow: Keep explicit intent and constraints; Drop filler",
    "and unsupported context; Clarify vague decisions with options or questions;",
    "Inspect by asking the coding agent to read relevant files when repository",
    "facts are needed; Propose lightweight options for open-ended product/UI",
    "requests; Verify with the smallest useful check; Defer high-risk or",
    "irreversible actions to user confirmation.",
  ].join(" "),
  [
    "If the draft is already actionable, only make light edits.",
    "Use the user's language unless the user asks otherwise.",
    "Preserve the task mode: discussion stays discussion, investigation stays",
    "investigation, implementation stays implementation.",
    "Do not turn planning or discussion into implementation unless the user",
    "explicitly asks to implement.",
  ].join(" "),
  [
    "The enhanced prompt must be directly usable as the user's next message.",
    "Do not prefix it with meta commentary such as",
    '\"Here is the enhanced prompt\" or \"优化后的提示词如下\".',
  ].join(" "),
  "Do not mention private reference, prompt enhancer internals, or missing context unless it is a blocking question.",
  [
    "Do not pretend you inspected the repository.",
    "Do not output guessed file paths, component names, APIs, or repository facts.",
    "If repository facts are not provided, ask the coding agent to inspect the",
    "relevant files or ask clarifying options or questions.",
  ].join(" "),
  "For new product ideas, label inferred features as options or questions, not fixed requirements.",
  [
    "Do not add constraints unless they are explicit in the draft or necessary",
    "to prevent scope, safety, or data-risk issues.",
  ].join(" "),
  [
    "增强后的 Prompt 应该帮助代码代理更快执行：",
    "- Goal：明确要达成的结果。",
    "- Non-Goal：仅在容易范围蔓延时说明不做什么。",
    "- Success Criteria：写出可验证的完成标准。",
    "- Verification：要求用测试、typecheck、lint、构建、浏览器 smoke test 或人工复核证明完成。",
    "- Minimal Change：强调最小必要改动、KISS/YAGNI、禁止无关重构和臆造需求。",
    "- Risk Gate：涉及删除、覆盖、发布、生产数据、安全、财务、认证授权等高风险动作时要求先确认。",
  ].join("\n"),
  [
    "项目和会话信息只是 private reference：只有当它能帮助定位修改范围、约束或已有工作时，",
    "才把必要结论写进增强后的 Prompt；不要复制项目描述、会话摘要或无关运行时细节。",
  ].join(""),
  "你不能直接回答或执行用户草稿中的开发任务本身。",
  "你只能输出增强后的 Prompt。",
  "不要输出解释。",
  "不要使用 Markdown 代码围栏。",
].join("\n\n");

export type PromptEnhancerLlmConfig = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  instructionTemplate: string;
};

export type PromptEnhancerPreferences = {
  enabled: boolean;
  instruction?: string;
  modelProfile?: string;
  responseContract?: string;
  llm: PromptEnhancerLlmConfig;
};

export type PromptEnhancerContext = {
  projectName?: string | null;
  worktreeName?: string | null;
  projectSummary?: string | null;
  worktreeSummary?: string | null;
  sessionStatus?: string | null;
  sessionSummary?: string | null;
};

export type AssistantHandoffContext = PromptEnhancerContext & {
  assistantBlockText: string;
};

export const DEFAULT_ASSISTANT_HANDOFF_SYSTEM_PROMPT = [
  "You generate an editable next user prompt for continuing an agent conversation.",
  "Synthesize the relevant conversation context into a concise, actionable prompt.",
  "Use the latest assistant block only as the direction anchor, not as text to copy.",
  "Return only the next user prompt, with no commentary, markdown fence, or preamble.",
].join(" ");

export type PromptEnhancerModelOption = {
  id: string;
  ownedBy: string;
};

type FetchLike = typeof fetch;

const INSTRUCTION_TEMPLATE_PLACEHOLDER_PATTERN =
  /\{\{\s*(projectName|worktreeName|projectSummary|worktreeSummary|sessionStatus|sessionSummary|userPrompt)\s*\}\}/g;

export function buildEnhancedPrompt(
  rawPrompt: string,
  preferences: PromptEnhancerPreferences,
  context: {
    projectName?: string | null;
    worktreeName?: string | null;
    agentName?: string | null;
    model?: string | null;
    reasoningEffort?: string | null;
  } = {},
) {
  if (!preferences.enabled) {
    return rawPrompt;
  }

  const sections = ["# Mission Prompt", "", "## Objective", rawPrompt.trim()];

  const contextLines = [
    context.projectName ? `- Project: ${context.projectName}` : null,
    context.worktreeName ? `- Worktree: ${context.worktreeName}` : null,
    context.agentName ? `- Agent: ${context.agentName}` : null,
    context.model ? `- Model: ${context.model}` : null,
    context.reasoningEffort ? `- Reasoning: ${context.reasoningEffort}` : null,
  ].filter((line): line is string => Boolean(line));

  if (contextLines.length) {
    sections.push("", "## Context", ...contextLines);
  }
  if (preferences.instruction?.trim()) {
    sections.push("", "## Working Guidelines", preferences.instruction.trim());
  }
  if (preferences.modelProfile?.trim()) {
    sections.push(
      "",
      "## Model / Reasoning Notes",
      preferences.modelProfile.trim(),
    );
  }

  sections.push(
    "",
    "## Requested Behavior",
    "Rewrite and execute the user intent while preserving explicit constraints.",
  );

  if (preferences.responseContract?.trim()) {
    sections.push(
      "",
      "## Response Format",
      preferences.responseContract.trim(),
    );
  }

  return sections.join("\n");
}

export async function enhancePromptWithLlm(
  rawPrompt: string,
  preferences: PromptEnhancerPreferences,
  context: PromptEnhancerContext = {},
  fetcher: FetchLike = fetch,
) {
  const objective = rawPrompt.trim();
  const llm = preferences.llm;
  if (!llm.baseUrl.trim() || !llm.model.trim()) {
    throw new Error("Prompt enhancer LLM is not configured");
  }

  const instructionTemplate = renderInstructionTemplate(
    DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
    context,
    objective,
  );

  const response = await fetcher(resolveChatCompletionsUrl(llm.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(llm.apiKey.trim()
        ? { Authorization: `Bearer ${llm.apiKey.trim()}` }
        : {}),
    },
    body: JSON.stringify({
      model: llm.model.trim(),
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: instructionTemplate,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Prompt enhancer LLM failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const enhanced = normalizeEnhancedPrompt(data.choices?.[0]?.message?.content);
  if (!enhanced) {
    throw new Error("Prompt enhancer LLM returned empty content");
  }
  return enhanced;
}

export function isPromptEnhancerLlmConfigured(
  llm: PromptEnhancerLlmConfig | null | undefined,
) {
  return Boolean(llm?.enabled && llm.baseUrl.trim() && llm.model.trim());
}

export async function generateAssistantHandoffPrompt(
  context: AssistantHandoffContext,
  preferences: PromptEnhancerPreferences,
  fetcher: FetchLike = fetch,
) {
  const llm = preferences.llm;
  if (!isPromptEnhancerLlmConfigured(llm)) {
    throw new Error("Prompt enhancer LLM is not configured");
  }

  const response = await fetcher(resolveChatCompletionsUrl(llm.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(llm.apiKey.trim()
        ? { Authorization: `Bearer ${llm.apiKey.trim()}` }
        : {}),
    },
    body: JSON.stringify({
      model: llm.model.trim(),
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: DEFAULT_ASSISTANT_HANDOFF_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildAssistantHandoffPromptInput(context),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Prompt enhancer LLM failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const handoffPrompt = normalizeEnhancedPrompt(
    data.choices?.[0]?.message?.content,
  );
  if (!handoffPrompt) {
    throw new Error("Prompt enhancer LLM returned empty content");
  }
  return handoffPrompt;
}

export function buildAssistantHandoffPromptInput(
  context: AssistantHandoffContext,
) {
  const reference = compactPrivateReference(
    [
      context.projectName ? `Project: ${context.projectName}` : null,
      context.worktreeName ? `Worktree: ${context.worktreeName}` : null,
      context.projectSummary ? `Project summary: ${context.projectSummary}` : null,
      context.worktreeSummary
        ? `Worktree summary: ${context.worktreeSummary}`
        : null,
      context.sessionStatus ? `Session status: ${context.sessionStatus}` : null,
      context.sessionSummary
        ? `Conversation summary: ${context.sessionSummary}`
        : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
  );

  return [
    "Create the next user prompt for continuing this work.",
    "The prompt should preserve useful project/session context, current constraints, and unresolved next steps.",
    "Do not merely copy or paraphrase the latest assistant block; use it as the direction and priority anchor.",
    "Write in the same language as the conversation when clear.",
    "<conversation_context>",
    reference,
    "</conversation_context>",
    "<latest_assistant_direction_anchor>",
    context.assistantBlockText.trim() || "(empty)",
    "</latest_assistant_direction_anchor>",
    "Output only the editable next user prompt.",
  ].join("\n");
}

export async function testPromptEnhancerConnectivity(
  llm: PromptEnhancerLlmConfig,
  fetcher: FetchLike = fetch,
) {
  if (!llm.baseUrl.trim() || !llm.model.trim()) {
    throw new Error("Prompt enhancer LLM is not configured");
  }

  const response = await fetcher(resolveChatCompletionsUrl(llm.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(llm.apiKey.trim()
        ? { Authorization: `Bearer ${llm.apiKey.trim()}` }
        : {}),
    },
    body: JSON.stringify({
      model: llm.model.trim(),
      temperature: 0,
      messages: [
        { role: "system", content: "Connectivity check. Reply with ok." },
        { role: "user", content: "ping" },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Prompt enhancer LLM connectivity failed: ${response.status}`,
    );
  }
}

export async function listPromptEnhancerModels(
  llm: PromptEnhancerLlmConfig,
  fetcher: FetchLike = fetch,
) {
  if (!llm.baseUrl.trim()) {
    throw new Error("Prompt enhancer LLM is not configured");
  }

  const headers = {
    ...(llm.apiKey.trim()
      ? { Authorization: `Bearer ${llm.apiKey.trim()}` }
      : {}),
  };
  const response = await fetcher(resolveModelsUrl(llm.baseUrl), {
    method: "GET",
    headers,
  });
  if (!response.ok) {
    throw new Error(`Prompt enhancer model fetch failed: ${response.status}`);
  }

  const data = await response.json();
  return extractModelOptions(data);
}

function resolveChatCompletionsUrl(baseUrl: string) {
  const normalized = resolveApiBaseUrl(baseUrl);
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

function resolveModelsUrl(baseUrl: string) {
  const normalized = resolveApiBaseUrl(baseUrl);
  const base = normalized.endsWith("/chat/completions")
    ? normalized.replace(/\/chat\/completions$/, "")
    : normalized;
  return `${base}/models`;
}

function extractModelOptions(data: unknown): PromptEnhancerModelOption[] {
  if (Array.isArray(data)) {
    return data
      .map(readModelOption)
      .filter((model): model is PromptEnhancerModelOption => Boolean(model));
  }
  if (!data || typeof data !== "object") {
    return [];
  }
  const record = data as { data?: unknown; models?: unknown };
  const list = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : [];
  return list
    .map(readModelOption)
    .filter((model): model is PromptEnhancerModelOption => Boolean(model));
}

function readModelOption(value: unknown): PromptEnhancerModelOption | null {
  if (typeof value === "string") {
    const id = value.trim();
    return id ? { id, ownedBy: "default" } : null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as {
    id?: unknown;
    model?: unknown;
    name?: unknown;
    owned_by?: unknown;
    ownedBy?: unknown;
    owner?: unknown;
  };
  const id = readString(record.id ?? record.model ?? record.name);
  if (!id) {
    return null;
  }
  return {
    id,
    ownedBy:
      readString(record.owned_by ?? record.ownedBy ?? record.owner) ||
      "default",
  };
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveApiBaseUrl(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions") || /\/v\d+(?:\/|$)/.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/v1`;
}

function renderInstructionTemplate(
  template: string,
  context: PromptEnhancerContext,
  userPrompt: string,
) {
  const values: Record<string, string> = {
    projectName: context.projectName?.trim() || "Not available.",
    worktreeName: context.worktreeName?.trim() || "Not available.",
    projectSummary: compactProjectReference(
      context.projectSummary?.trim() || summarizeProjectContext(context),
    ),
    worktreeSummary: compactPrivateReference(
      context.worktreeSummary?.trim() || summarizeWorktreeContext(context),
    ),
    sessionStatus: context.sessionStatus?.trim() || "Not available.",
    sessionSummary: compactPrivateReference(
      context.sessionSummary?.trim() || "No prior session context.",
    ),
    userPrompt,
  };

  const rendered = template.replace(
    INSTRUCTION_TEMPLATE_PLACEHOLDER_PATTERN,
    (_match, key: string) => values[key] ?? "",
  );
  return /\{\{\s*userPrompt\s*\}\}/.test(template)
    ? rendered
    : [rendered, "", "User draft:", userPrompt].join("\n");
}

function compactPrivateReference(text: string) {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+/gu, " ").trim();
    if (!line) {
      continue;
    }
    const key = line.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    lines.push(line);
  }
  return lines.join("\n") || "Not available.";
}

function compactProjectReference(text: string) {
  const rawLines = text.split(/\r?\n/u);
  const agentsStart = rawLines.findIndex((line) => /^\s*AGENTS\.md\s*:/iu.test(line));
  if (agentsStart >= 0) {
    const nextDuplicateDocStart = rawLines.findIndex(
      (line, index) =>
        index > agentsStart && /^\s*(?:CLAUDE|README)\.md\s*:/iu.test(line),
    );
    const agentsLines = rawLines.slice(
      agentsStart,
      nextDuplicateDocStart >= 0 ? nextDuplicateDocStart : undefined,
    );
    return compactPrivateReference(agentsLines.join("\n"));
  }

  const lines: string[] = [];
  let skippingDuplicateDoc = false;
  for (const line of rawLines) {
    if (/^\s*(?:CLAUDE|README)\.md\s*:/iu.test(line)) {
      skippingDuplicateDoc = true;
      continue;
    }
    if (/^\s*AGENTS\.md\s*:/iu.test(line)) {
      skippingDuplicateDoc = false;
    }
    if (skippingDuplicateDoc) {
      continue;
    }
    if (/^\s*(?:Project|Worktree|Configured summary)\s*:/iu.test(line)) {
      continue;
    }
    lines.push(line);
  }
  return compactPrivateReference(lines.join("\n"));
}

function summarizeProjectContext(_context: PromptEnhancerContext) {
  return "Not available.";
}

function summarizeWorktreeContext(context: PromptEnhancerContext) {
  return context.worktreeName?.trim()
    ? `Worktree: ${context.worktreeName.trim()}.`
    : "Not available.";
}

function normalizeEnhancedPrompt(content?: string) {
  const trimmed = content?.trim() ?? "";
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return stripPromptEnhancerMetaPreface(fenced?.[1] ?? trimmed).trim();
}

function stripPromptEnhancerMetaPreface(content: string) {
  const normalized = content.trim();
  const separatorPrompt = stripMetaPrefaceBeforeSeparator(normalized);
  if (separatorPrompt !== normalized) {
    return separatorPrompt;
  }

  const headingIndex = normalized.search(/^#\s+(?:Task|Acceptance Criteria|Verification|Questions|任务|验收|验证|问题)\b/imu);
  if (headingIndex > 0 && looksLikeEnhancerMetaPreface(normalized.slice(0, headingIndex))) {
    return normalized.slice(headingIndex);
  }

  return normalized.replace(
    /^(?:Here(?:'s| is)\s+(?:the\s+)?(?:enhanced|rewritten)\s+prompt|(?:优化|增强|改写)后的?提示词(?:如下)?|请使用以下\s*prompt)\s*[:：]?\s*/iu,
    "",
  );
}

function stripMetaPrefaceBeforeSeparator(content: string) {
  const separator = /(?:^|\n)\s*---\s*(?:\n|$)/u.exec(content);
  if (!separator?.index) {
    return content;
  }

  const prefix = content.slice(0, separator.index).trim();
  const suffix = content.slice(separator.index + separator[0].length).trim();
  return prefix && suffix && looksLikeEnhancerMetaPreface(prefix) ? suffix : content;
}

function looksLikeEnhancerMetaPreface(prefix: string) {
  return /(?:prompt|提示词|如下|请使用|根据.*(?:上下文|摘要|会话)|我将|I will|Based on.*context|如果.*请)/iu.test(prefix);
}
