export const DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE = "Rewrite the user's draft into a direct, repo-aware Markdown prompt for an autonomous coding agent.\n\nUse the project/session context only to clarify the task. Preserve the user's intent exactly. Do not answer or implement the task yourself.\n\nInputs:\n- Project summary: {{projectSummary}}\n- Session summary: {{sessionSummary}}\n- User draft: {{userPrompt}}\n\nOutput only the enhanced prompt, without Markdown code fences.\n\nThe enhanced prompt should:\n- Be written as instructions to a coding agent working in the current repository.\n- Make the task concrete, scoped, and verifiable.\n- Encourage the agent to inspect the codebase before editing.\n- Encourage the agent to follow existing conventions, naming, architecture, tests, and style.\n- Prefer minimal, targeted changes over broad rewrites.\n- Separate facts from assumptions.\n- Include goals, constraints, acceptance criteria, and verification steps when useful.\n- Ask clarifying questions only when the task cannot be safely executed without them.\n- Avoid invented details, fake file paths, fake APIs, or unsupported assumptions.\n- Avoid irrelevant runtime/tool/session details.\n- Avoid explaining that the prompt was enhanced.\n\nUse this structure when applicable:\n\n# Objective\n\nState the user’s intended outcome clearly.\n\n# Relevant Context\n\nInclude only context that helps the coding agent complete the task.\n\n# Goals\n\nList the expected outcomes.\n\n# Scope\n\nDefine what is included and what is out of scope.\n\n# Constraints\n\nList important limits, compatibility requirements, user preferences, or things the agent must avoid.\n\n# Instructions\n\nGive direct execution guidance:\n1. Inspect the relevant parts of the repository before making changes.\n2. Identify existing patterns, APIs, tests, and conventions related to the task.\n3. Make the smallest safe change that satisfies the objective.\n4. Avoid unrelated refactors, formatting churn, dependency changes, or behavior changes.\n5. Update or add tests only where they directly verify the requested behavior.\n6. Keep user-facing behavior, compatibility, and existing contracts intact unless the user explicitly requested otherwise.\n\n# Acceptance Criteria\n\nList measurable conditions that indicate the task is complete.\n\n# Verification\n\nList concrete checks the agent should run or explain if unavailable.\n\n# Questions / Assumptions\n\nInclude this section only if the draft is ambiguous or missing critical information.\nState assumptions explicitly and keep them minimal.\n\nReturn only the final enhanced Markdown prompt.";

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
  workspaceName?: string | null;
  projectSummary?: string | null;
  workspaceSummary?: string | null;
  sessionStatus?: string | null;
  sessionSummary?: string | null;
};

export type PromptEnhancerModelOption = {
  id: string;
  ownedBy: string;
};

type FetchLike = typeof fetch;


export function buildEnhancedPrompt(rawPrompt: string, preferences: PromptEnhancerPreferences, context: { projectName?: string | null; workspaceName?: string | null; agentName?: string | null; model?: string | null; reasoningEffort?: string | null } = {}) {
  if (!preferences.enabled) {
    return rawPrompt;
  }

  const sections = [
    "# Mission Prompt",
    "",
    "## Objective",
    rawPrompt.trim(),
  ];

  const contextLines = [
    context.projectName ? `- Project: ${context.projectName}` : null,
    context.workspaceName ? `- Workspace: ${context.workspaceName}` : null,
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
    sections.push("", "## Model / Reasoning Notes", preferences.modelProfile.trim());
  }

  sections.push("", "## Requested Behavior", "Rewrite and execute the user intent while preserving explicit constraints.");

  if (preferences.responseContract?.trim()) {
    sections.push("", "## Response Format", preferences.responseContract.trim());
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

  const instructionTemplate = renderInstructionTemplate(llm.instructionTemplate.trim() || DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE, context, objective);

  const response = await fetcher(resolveChatCompletionsUrl(llm.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(llm.apiKey.trim() ? { Authorization: `Bearer ${llm.apiKey.trim()}` } : {}),
    },
    body: JSON.stringify({
      model: llm.model.trim(),
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: llm.systemPrompt.trim() || "Rewrite the user's draft into a clear, actionable coding-agent prompt. Return only the rewritten prompt.",
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

  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const enhanced = normalizeEnhancedPrompt(data.choices?.[0]?.message?.content);
  if (!enhanced) {
    throw new Error("Prompt enhancer LLM returned empty content");
  }
  return enhanced;
}


export async function testPromptEnhancerConnectivity(llm: PromptEnhancerLlmConfig, fetcher: FetchLike = fetch) {
  if (!llm.baseUrl.trim() || !llm.model.trim()) {
    throw new Error("Prompt enhancer LLM is not configured");
  }

  const response = await fetcher(resolveChatCompletionsUrl(llm.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(llm.apiKey.trim() ? { Authorization: `Bearer ${llm.apiKey.trim()}` } : {}),
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
    throw new Error(`Prompt enhancer LLM connectivity failed: ${response.status}`);
  }
}


export async function listPromptEnhancerModels(llm: PromptEnhancerLlmConfig, fetcher: FetchLike = fetch) {
  if (!llm.baseUrl.trim()) {
    throw new Error("Prompt enhancer LLM is not configured");
  }

  const headers = {
    ...(llm.apiKey.trim() ? { Authorization: `Bearer ${llm.apiKey.trim()}` } : {}),
  };
  const response = await fetcher(resolveModelsUrl(llm.baseUrl), { method: "GET", headers });
  if (!response.ok) {
    throw new Error(`Prompt enhancer model fetch failed: ${response.status}`);
  }

  const data = await response.json();
  return extractModelOptions(data);
}

function resolveChatCompletionsUrl(baseUrl: string) {
  const normalized = resolveApiBaseUrl(baseUrl);
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
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
    return data.map(readModelOption).filter((model): model is PromptEnhancerModelOption => Boolean(model));
  }
  if (!data || typeof data !== "object") {
    return [];
  }
  const record = data as { data?: unknown; models?: unknown };
  const list = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : [];
  return list.map(readModelOption).filter((model): model is PromptEnhancerModelOption => Boolean(model));
}

function readModelOption(value: unknown): PromptEnhancerModelOption | null {
  if (typeof value === "string") {
    const id = value.trim();
    return id ? { id, ownedBy: "default" } : null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { id?: unknown; model?: unknown; name?: unknown; owned_by?: unknown; ownedBy?: unknown; owner?: unknown };
  const id = readString(record.id ?? record.model ?? record.name);
  if (!id) {
    return null;
  }
  return {
    id,
    ownedBy: readString(record.owned_by ?? record.ownedBy ?? record.owner) || "default",
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

function renderInstructionTemplate(template: string, context: PromptEnhancerContext, userPrompt: string) {
  const values: Record<string, string> = {
    projectName: context.projectName?.trim() || "Not available.",
    workspaceName: context.workspaceName?.trim() || "Not available.",
    projectSummary: context.projectSummary?.trim() || summarizeProjectContext(context),
    workspaceSummary: context.workspaceSummary?.trim() || summarizeWorkspaceContext(context),
    sessionStatus: context.sessionStatus?.trim() || "Not available.",
    sessionSummary: context.sessionSummary?.trim() || "No prior session context.",
    userPrompt,
  };

  const rendered = template.replace(/\{\{\s*(projectName|workspaceName|projectSummary|workspaceSummary|sessionStatus|sessionSummary|userPrompt)\s*\}\}/g, (_match, key: string) => values[key] ?? "");
  return /\{\{\s*userPrompt\s*\}\}/.test(template) ? rendered : [rendered, "", "User draft:", userPrompt].join("\n");
}

function summarizeProjectContext(context: PromptEnhancerContext) {
  const parts = [
    context.projectName?.trim() ? `Project: ${context.projectName.trim()}.` : "",
    context.workspaceName?.trim() ? `Workspace: ${context.workspaceName.trim()}.` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "Not available.";
}

function summarizeWorkspaceContext(context: PromptEnhancerContext) {
  return context.workspaceName?.trim() ? `Workspace: ${context.workspaceName.trim()}.` : "Not available.";
}

function normalizeEnhancedPrompt(content?: string) {
  const trimmed = content?.trim() ?? "";
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}
