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

你可以根据上下文补充必要结构，例如目标、背景、约束、验收标准和验证方式，但只在有帮助时添加。避免通用废话，避免过度模板化，避免为了完整而变长。

你应该让增强后的提示词具备以下特征：
- 面向 coding agent，而不是普通聊天助手
- 任务边界清楚
- 描述精准但尽量短
- 优先使用项目内已有代码、约定和上下文
- 鼓励先阅读相关文件再修改
- 鼓励小步修改，避免无关重构
- 遵循 KISS / YAGNI，除非任务需要，不增加抽象、依赖、功能或重构
- 从第一性原理理解目标和约束，但明确区分事实、上下文和假设
- 给出可验证的完成标准
- 对阻塞性不确定信息提出问题，而不是臆造
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
export const DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE = `Rewrite the user's draft into a concise, precise Markdown prompt for a coding agent.

Use context only when it directly helps execution.
Preserve the user's intent exactly.
Do not solve the task.
Do not invent files, APIs, requirements, or project facts.
Do not include generic boilerplate.
Do not mention irrelevant runtime, tool, or session details.

Inputs:
- Project summary: {{projectSummary}}
- Session summary: {{sessionSummary}}
- User draft: {{userPrompt}}

Output only the enhanced prompt, without Markdown code fences.

Optimize for:
- concise wording
- clear task boundary
- actionable instructions
- minimal assumptions
- verifiable completion
- existing project conventions, architecture, tests, naming, and style
- KISS/YAGNI: no extra abstraction, dependencies, features, or refactors unless required
- fact-based execution: inspect relevant files before changing code and separate facts from assumptions
- first-principles reasoning when requirements are unclear

Use this compact structure only when useful:

# Task

State the requested change or investigation in 1-3 sentences.

# Context

Include only directly relevant project/session context. Omit this section if there is no useful context.

# Constraints

List only important constraints, such as compatibility, no unrelated refactors, no invented behavior, existing conventions, or user-specified preferences.

# Acceptance Criteria

List 2-5 concrete conditions that define completion.

# Verification

List the minimal checks the agent should run. Prefer existing tests, typecheck, lint, or a focused manual smoke test. If a relevant check cannot be run, say why.

# Questions

Include only blocking questions. Omit this section if the agent can proceed safely.

Keep the final prompt as short as possible while preserving precision.`;

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

