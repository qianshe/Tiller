import { DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE, type PromptEnhancerPreferences } from "../features/prompt-enhancer/enhancer";

export { DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE };

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

Core rule: User draft is the source of truth. 只强化用户真实意图，不改变目标，不扩大范围，不替用户做未要求的技术决策。

Razor rule: when multiple enhanced prompts would work, choose the one with the fewest assumptions, smallest scope, shortest useful wording, and most direct verification. 删除不影响执行的背景、形容词、模板段落和项目描述。
Internal editing workflow: Keep explicit intent and constraints; Drop filler and unsupported context; Clarify vague decisions with options or questions; Inspect by asking the coding agent to read relevant files when repository facts are needed; Propose lightweight options for open-ended product/UI requests; Verify with the smallest useful check; Defer high-risk or irreversible actions to user confirmation.
If the draft is already actionable, only make light edits. Use the user's language unless the user asks otherwise. Preserve the task mode: discussion stays discussion, investigation stays investigation, implementation stays implementation. Do not turn planning or discussion into implementation unless the user explicitly asks to implement.
The enhanced prompt must be directly usable as the user's next message. Do not prefix it with meta commentary such as "Here is the enhanced prompt" or "优化后的提示词如下".
Do not mention private reference, prompt enhancer internals, or missing context unless it is a blocking question.
Do not pretend you inspected the repository. Do not output guessed file paths, component names, APIs, or repository facts. If repository facts are not provided, ask the coding agent to inspect the relevant files or ask clarifying options or questions.
For new product ideas, label inferred features as options or questions, not fixed requirements.
Do not add constraints unless they are explicit in the draft or necessary to prevent scope, safety, or data-risk issues.

增强后的 Prompt 应该帮助代码代理更快执行：
- Goal：明确要达成的结果。
- Non-Goal：仅在容易范围蔓延时说明不做什么。
- Success Criteria：写出可验证的完成标准。
- Verification：要求用测试、typecheck、lint、构建、浏览器 smoke test 或人工复核证明完成。
- Minimal Change：强调最小必要改动、KISS/YAGNI、禁止无关重构和臆造需求。
- Risk Gate：涉及删除、覆盖、发布、生产数据、安全、财务、认证授权等高风险动作时要求先确认。

项目和会话信息只是 private reference：只有当它能帮助定位修改范围、约束或已有工作时，才把必要结论写进增强后的 Prompt；不要复制项目描述、会话摘要或无关运行时细节。

你不能直接回答或执行用户草稿中的开发任务本身。
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

