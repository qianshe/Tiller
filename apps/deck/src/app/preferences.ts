import type { PromptEnhancerPreferences } from "../features/prompt-enhancer/enhancer";

export const DECK_PREFERENCES_STORAGE_KEY = "tiller.deck-preferences";

export type DeckLanguage = "zh-CN" | "en-US";
export type DeckTheme = "system" | "light" | "dark";

export type TechnicalPanelPreferences = {
  logbookDefaultOpen: boolean;
  diffDefaultOpen: boolean;
  showSessionRuntimeMeta: boolean;
  showPermissionWorkspace: boolean;
  showOrderHints: boolean;
  showConnectionDebug: boolean;
};

export type DeckPreferences = {
  language: DeckLanguage;
  theme: DeckTheme;
  reduceMotion: boolean;
  technicalPanels: TechnicalPanelPreferences;
  promptEnhancer: PromptEnhancerPreferences;
};

export const DEFAULT_PROMPT_ENHANCER_INSTRUCTION = "你是 Tiller Deck 的协作型 Coding Agent。先理解目标、约束和风险，再给出可执行方案；涉及代码时遵循最小改动、可验证、可回滚。";
export const DEFAULT_PROMPT_MODEL_PROFILE = "模型偏好：遵循当前任务的 模型 / 推理 配置；若上下文不足，先列出假设，不把模型选择写入 Helm 或后端配置。";
export const DEFAULT_PROMPT_RESPONSE_CONTRACT = "输出契约：先给结论，再给步骤；涉及代码改动时包含验证方式、影响面与风险；需要用户决策时给 2-3 个选项。";
export const OLD_PROMPT_LLM_SYSTEM_PROMPT = "你是提示词增强器。把用户草稿改写为清晰、可执行、可验证的 coding-agent 提示词；保留用户意图，不要直接回答任务。";
export const DEFAULT_PROMPT_LLM_SYSTEM_PROMPT = `你是一个 coding-agent 提示词增强器。

你的任务是把用户的原始草稿改写成清晰、可执行、可验证的 Markdown 提示词，用于驱动代码代理完成开发任务。

你必须保留用户的真实意图，不要改变任务目标，不要擅自扩大范围，不要替用户做技术决策，除非用户草稿中已经明确表达。

你可以根据上下文补充必要的结构，例如目标、背景、约束、执行步骤、验收标准、验证方式、注意事项和交付要求，但只在有帮助时添加。

你应该让增强后的提示词具备以下特征：
- 面向 coding agent，而不是面向普通聊天助手
- 任务边界清楚
- 优先使用项目内已有代码、约定和上下文
- 鼓励先阅读相关文件再修改
- 鼓励小步修改，避免无关重构
- 鼓励给出可验证的完成标准
- 鼓励运行测试、类型检查、lint 或最小可行验证
- 对不确定信息提出需要确认的问题，而不是臆造
- 不暴露或重复无关的运行时、工具、会话细节

你不能直接回答用户草稿中的开发任务本身。
你只能输出增强后的 Prompt。
不要输出解释。
不要使用 Markdown 代码围栏。`;
export const OLD_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE = [
  "You are improving a user's draft into a clear coding-agent prompt.",
  "Project summary:",
  "{{projectSummary}}",
  "Session summary:",
  "{{sessionSummary}}",
  "User draft:",
  "{{userPrompt}}",
].join("\n");
export const DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE = `Rewrite the user's draft into a direct, repo-aware Markdown prompt for an autonomous coding agent.

Use the project/session context only to clarify the task. Preserve the user's intent exactly. Do not answer or implement the task yourself.

Inputs:
- Project summary: {{projectSummary}}
- Session summary: {{sessionSummary}}
- User draft: {{userPrompt}}

Output only the enhanced prompt, without Markdown code fences.

The enhanced prompt should:
- Be written as instructions to a coding agent working in the current repository.
- Make the task concrete, scoped, and verifiable.
- Encourage the agent to inspect the codebase before editing.
- Encourage the agent to follow existing conventions, naming, architecture, tests, and style.
- Prefer minimal, targeted changes over broad rewrites.
- Separate facts from assumptions.
- Include goals, constraints, acceptance criteria, and verification steps when useful.
- Ask clarifying questions only when the task cannot be safely executed without them.
- Avoid invented details, fake file paths, fake APIs, or unsupported assumptions.
- Avoid irrelevant runtime/tool/session details.
- Avoid explaining that the prompt was enhanced.

Use this structure when applicable:

# Objective

State the user?s intended outcome clearly.

# Relevant Context

Include only context that helps the coding agent complete the task.

# Goals

List the expected outcomes.

# Scope

Define what is included and what is out of scope.

# Constraints

List important limits, compatibility requirements, user preferences, or things the agent must avoid.

# Instructions

Give direct execution guidance:
1. Inspect the relevant parts of the repository before making changes.
2. Identify existing patterns, APIs, tests, and conventions related to the task.
3. Make the smallest safe change that satisfies the objective.
4. Avoid unrelated refactors, formatting churn, dependency changes, or behavior changes.
5. Update or add tests only where they directly verify the requested behavior.
6. Keep user-facing behavior, compatibility, and existing contracts intact unless the user explicitly requested otherwise.

# Acceptance Criteria

List measurable conditions that indicate the task is complete.

# Verification

List concrete checks the agent should run or explain if unavailable.

# Questions / Assumptions

Include this section only if the draft is ambiguous or missing critical information.
State assumptions explicitly and keep them minimal.

Return only the final enhanced Markdown prompt.`;

export const DEFAULT_DECK_PREFERENCES: DeckPreferences = {
  language: "zh-CN",
  theme: "system",
  reduceMotion: false,
  technicalPanels: {
    logbookDefaultOpen: false,
    diffDefaultOpen: false,
    showSessionRuntimeMeta: true,
    showPermissionWorkspace: true,
    showOrderHints: true,
    showConnectionDebug: false,
  },
  promptEnhancer: {
    enabled: true,
    instruction: DEFAULT_PROMPT_ENHANCER_INSTRUCTION,
    modelProfile: DEFAULT_PROMPT_MODEL_PROFILE,
    responseContract: DEFAULT_PROMPT_RESPONSE_CONTRACT,
    llm: {
      enabled: true,
      baseUrl: "",
      apiKey: "",
      model: "",
      systemPrompt: DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
      instructionTemplate: DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
    },
  },
};

export function readDeckPreferences(): DeckPreferences {
  try {
    const raw = window.localStorage.getItem(DECK_PREFERENCES_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const technicalPanels = isRecord(parsed.technicalPanels) ? parsed.technicalPanels : {};
    const promptEnhancer = isRecord(parsed.promptEnhancer) ? parsed.promptEnhancer : {};
    const legacyTechnicalPanelsOpen = parsed.showTechnicalPanels === true;

    return {
      language: isDeckLanguage(parsed.language) ? parsed.language : DEFAULT_DECK_PREFERENCES.language,
      theme: isDeckTheme(parsed.theme) ? parsed.theme : DEFAULT_DECK_PREFERENCES.theme,
      reduceMotion: parsed.reduceMotion === true,
      technicalPanels: {
        logbookDefaultOpen: typeof technicalPanels.logbookDefaultOpen === "boolean" ? technicalPanels.logbookDefaultOpen : legacyTechnicalPanelsOpen,
        diffDefaultOpen: typeof technicalPanels.diffDefaultOpen === "boolean" ? technicalPanels.diffDefaultOpen : legacyTechnicalPanelsOpen,
        showSessionRuntimeMeta: typeof technicalPanels.showSessionRuntimeMeta === "boolean" ? technicalPanels.showSessionRuntimeMeta : DEFAULT_DECK_PREFERENCES.technicalPanels.showSessionRuntimeMeta,
        showPermissionWorkspace: typeof technicalPanels.showPermissionWorkspace === "boolean" ? technicalPanels.showPermissionWorkspace : DEFAULT_DECK_PREFERENCES.technicalPanels.showPermissionWorkspace,
        showOrderHints: typeof technicalPanels.showOrderHints === "boolean" ? technicalPanels.showOrderHints : DEFAULT_DECK_PREFERENCES.technicalPanels.showOrderHints,
        showConnectionDebug: typeof technicalPanels.showConnectionDebug === "boolean" ? technicalPanels.showConnectionDebug : DEFAULT_DECK_PREFERENCES.technicalPanels.showConnectionDebug,
      },
      promptEnhancer: {
        enabled: typeof promptEnhancer.enabled === "boolean" ? promptEnhancer.enabled : DEFAULT_DECK_PREFERENCES.promptEnhancer.enabled,
        instruction: readPreferenceText(promptEnhancer.instruction, DEFAULT_PROMPT_ENHANCER_INSTRUCTION),
        modelProfile: readPreferenceText(promptEnhancer.modelProfile, DEFAULT_PROMPT_MODEL_PROFILE),
        responseContract: readPreferenceText(promptEnhancer.responseContract, DEFAULT_PROMPT_RESPONSE_CONTRACT),
        llm: {
          enabled: isRecord(promptEnhancer.llm) && typeof promptEnhancer.llm.enabled === "boolean" ? promptEnhancer.llm.enabled : DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.enabled,
          baseUrl: isRecord(promptEnhancer.llm) && typeof promptEnhancer.llm.baseUrl === "string" ? promptEnhancer.llm.baseUrl : DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.baseUrl,
          apiKey: isRecord(promptEnhancer.llm) && typeof promptEnhancer.llm.apiKey === "string" ? promptEnhancer.llm.apiKey : DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.apiKey,
          model: isRecord(promptEnhancer.llm) && typeof promptEnhancer.llm.model === "string" ? promptEnhancer.llm.model : DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.model,
          systemPrompt: isRecord(promptEnhancer.llm) && typeof promptEnhancer.llm.systemPrompt === "string" && promptEnhancer.llm.systemPrompt !== OLD_PROMPT_LLM_SYSTEM_PROMPT ? promptEnhancer.llm.systemPrompt : DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.systemPrompt,
          instructionTemplate: isRecord(promptEnhancer.llm) && typeof promptEnhancer.llm.instructionTemplate === "string" && promptEnhancer.llm.instructionTemplate !== OLD_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE ? promptEnhancer.llm.instructionTemplate : DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.instructionTemplate,
        },
      },
    };
  } catch {
    return DEFAULT_DECK_PREFERENCES;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isDeckLanguage(value: unknown): value is DeckLanguage {
  return value === "zh-CN" || value === "en-US";
}

export function isDeckTheme(value: unknown): value is DeckTheme {
  return value === "system" || value === "light" || value === "dark";
}

export function readPreferenceText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

