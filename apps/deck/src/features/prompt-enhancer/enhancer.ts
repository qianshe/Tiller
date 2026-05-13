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
    "If the private reference is not needed, ignore it.",
  ].join(" "),
  ["<user_draft>", "{{userPrompt}}", "</user_draft>"].join("\n"),
  [
    "Output contract:",
    "- Apply the internal workflow silently: Keep → Drop → Clarify → Inspect → Propose → Verify → Defer.",
    "- Return only the enhanced prompt, without Markdown code fences.",
    "- Make the output directly usable as the user's next message.",
    "- Do not prefix it with meta commentary such as",
    '  "Here is the enhanced prompt" or "优化后的提示词如下".',
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
    "Use sections only when they make the prompt clearer:",
    "# Task",
    "# Acceptance Criteria",
    "# Verification",
    "# Questions",
  ].join("\n"),
  "Omit sections that add no execution value.",
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
    llm.instructionTemplate.trim() ||
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
          content:
            llm.systemPrompt.trim() ||
            "Rewrite the user's draft into a clear, actionable coding-agent prompt. Return only the rewritten prompt.",
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
    projectSummary:
      context.projectSummary?.trim() || summarizeProjectContext(context),
    worktreeSummary:
      context.worktreeSummary?.trim() || summarizeWorktreeContext(context),
    sessionStatus: context.sessionStatus?.trim() || "Not available.",
    sessionSummary:
      context.sessionSummary?.trim() || "No prior session context.",
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

function summarizeProjectContext(context: PromptEnhancerContext) {
  const parts = [
    context.projectName?.trim()
      ? `Project: ${context.projectName.trim()}.`
      : "",
    context.worktreeName?.trim()
      ? `Worktree: ${context.worktreeName.trim()}.`
      : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "Not available.";
}

function summarizeWorktreeContext(context: PromptEnhancerContext) {
  return context.worktreeName?.trim()
    ? `Worktree: ${context.worktreeName.trim()}.`
    : "Not available.";
}

function normalizeEnhancedPrompt(content?: string) {
  const trimmed = content?.trim() ?? "";
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}
