import {
  isDeckLanguage,
  type DeckLanguage,
} from "../../shared/config/deck-language";
import {
  DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
  DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
  type PromptEnhancerPreferences,
} from "../prompt-enhancer/facade";

export {
  DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
  DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
};

export const DECK_PREFERENCES_STORAGE_KEY = "tiller.deck-preferences";

export type DeckTheme = "system" | "light" | "dark" | "harbor" | "voyage" | "chart";
export type DeckDensity = "compact" | "default" | "cozy";
export type DeckTimeFormat = "relative" | "absolute";

export type TechnicalPanelPreferences = {
  diffDefaultOpen: boolean;
  showSessionRuntimeMeta: boolean;
  showPermissionWorktree: boolean;
  showMissionThinking: boolean;
  showConnectionDebug: boolean;
};

export type DeckPreferences = {
  language: DeckLanguage;
  theme: DeckTheme;
  reduceMotion: boolean;
  density: DeckDensity;
  timeFormat: DeckTimeFormat;
  technicalPanels: TechnicalPanelPreferences;
  promptEnhancer: PromptEnhancerPreferences;
};

export const DEFAULT_PROMPT_ENHANCER_INSTRUCTION =
  "你是 Tiller Deck 的协作型 Coding Agent。先理解目标、约束和风险，再给出可执行方案；涉及代码时遵循最小改动、可验证、可回滚。";
export const DEFAULT_PROMPT_MODEL_PROFILE =
  "模型偏好：遵循当前任务的 模型 / 推理 配置；若上下文不足，先列出假设，不把模型选择写入 Helm 或后端配置。";
export const DEFAULT_PROMPT_RESPONSE_CONTRACT =
  "输出契约：先给结论，再给步骤；涉及代码改动时包含验证方式、影响面与风险；需要用户决策时给 2-3 个选项。";
export const DEFAULT_DECK_PREFERENCES: DeckPreferences = {
  language: "zh-CN",
  theme: "dark",
  reduceMotion: false,
  density: "default",
  timeFormat: "relative",
  technicalPanels: {
    diffDefaultOpen: false,
    showSessionRuntimeMeta: true,
    showPermissionWorktree: true,
    showMissionThinking: true,
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
    removeHiddenPromptEnhancerTemplateOverrides(parsed, raw);
    const technicalPanels = isRecord(parsed.technicalPanels)
      ? parsed.technicalPanels
      : {};
    const promptEnhancer = isRecord(parsed.promptEnhancer)
      ? parsed.promptEnhancer
      : {};
    const legacyTechnicalPanelsOpen = parsed.showTechnicalPanels === true;

    return {
      language: isDeckLanguage(parsed.language)
        ? parsed.language
        : DEFAULT_DECK_PREFERENCES.language,
      // 已下线的 tiller 主题迁移到最接近的 harbor（同为冷蓝调亮色）。
      theme: parsed.theme === "tiller"
        ? "harbor"
        : isDeckTheme(parsed.theme)
          ? parsed.theme
          : DEFAULT_DECK_PREFERENCES.theme,
      reduceMotion: parsed.reduceMotion === true,
      density: isDeckDensity(parsed.density)
        ? parsed.density
        : DEFAULT_DECK_PREFERENCES.density,
      timeFormat: isDeckTimeFormat(parsed.timeFormat)
        ? parsed.timeFormat
        : DEFAULT_DECK_PREFERENCES.timeFormat,
      technicalPanels: {
        diffDefaultOpen:
          typeof technicalPanels.diffDefaultOpen === "boolean"
            ? technicalPanels.diffDefaultOpen
            : legacyTechnicalPanelsOpen,
        showSessionRuntimeMeta:
          typeof technicalPanels.showSessionRuntimeMeta === "boolean"
            ? technicalPanels.showSessionRuntimeMeta
            : DEFAULT_DECK_PREFERENCES.technicalPanels.showSessionRuntimeMeta,
        showPermissionWorktree:
          typeof technicalPanels.showPermissionWorktree === "boolean"
            ? technicalPanels.showPermissionWorktree
            : DEFAULT_DECK_PREFERENCES.technicalPanels.showPermissionWorktree,
        showMissionThinking:
          typeof technicalPanels.showMissionThinking === "boolean"
            ? technicalPanels.showMissionThinking
            : DEFAULT_DECK_PREFERENCES.technicalPanels.showMissionThinking,
        showConnectionDebug:
          typeof technicalPanels.showConnectionDebug === "boolean"
            ? technicalPanels.showConnectionDebug
            : DEFAULT_DECK_PREFERENCES.technicalPanels.showConnectionDebug,
      },
      promptEnhancer: {
        enabled:
          typeof promptEnhancer.enabled === "boolean"
            ? promptEnhancer.enabled
            : DEFAULT_DECK_PREFERENCES.promptEnhancer.enabled,
        instruction: readPreferenceText(
          promptEnhancer.instruction,
          DEFAULT_PROMPT_ENHANCER_INSTRUCTION,
        ),
        modelProfile: readPreferenceText(
          promptEnhancer.modelProfile,
          DEFAULT_PROMPT_MODEL_PROFILE,
        ),
        responseContract: readPreferenceText(
          promptEnhancer.responseContract,
          DEFAULT_PROMPT_RESPONSE_CONTRACT,
        ),
        llm: {
          enabled:
            isRecord(promptEnhancer.llm) &&
            typeof promptEnhancer.llm.enabled === "boolean"
              ? promptEnhancer.llm.enabled
              : DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.enabled,
          baseUrl:
            isRecord(promptEnhancer.llm) &&
            typeof promptEnhancer.llm.baseUrl === "string"
              ? promptEnhancer.llm.baseUrl
              : DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.baseUrl,
          apiKey:
            isRecord(promptEnhancer.llm) &&
            typeof promptEnhancer.llm.apiKey === "string"
              ? promptEnhancer.llm.apiKey
              : DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.apiKey,
          model:
            isRecord(promptEnhancer.llm) &&
            typeof promptEnhancer.llm.model === "string"
              ? promptEnhancer.llm.model
              : DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.model,
          systemPrompt: DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.systemPrompt,
          instructionTemplate:
            DEFAULT_DECK_PREFERENCES.promptEnhancer.llm.instructionTemplate,
        },
      },
    };
  } catch {
    return DEFAULT_DECK_PREFERENCES;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isDeckTheme(value: unknown): value is DeckTheme {
  return (
    value === "system" || value === "light" || value === "dark" ||
    value === "harbor" || value === "voyage" || value === "chart"
  );
}

export function isDeckDensity(value: unknown): value is DeckDensity {
  return value === "compact" || value === "default" || value === "cozy";
}

export function isDeckTimeFormat(value: unknown): value is DeckTimeFormat {
  return value === "relative" || value === "absolute";
}

export function readPreferenceText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function removeHiddenPromptEnhancerTemplateOverrides(
  parsed: Record<string, unknown>,
  raw: string | null,
) {
  if (!raw || !isRecord(parsed.promptEnhancer)) {
    return;
  }
  const promptEnhancer = parsed.promptEnhancer;
  if (!isRecord(promptEnhancer.llm)) {
    return;
  }

  const llm = promptEnhancer.llm;
  let changed = false;
  if (Object.prototype.hasOwnProperty.call(llm, "systemPrompt")) {
    delete llm.systemPrompt;
    changed = true;
  }
  if (Object.prototype.hasOwnProperty.call(llm, "instructionTemplate")) {
    delete llm.instructionTemplate;
    changed = true;
  }
  if (!changed) {
    return;
  }

  try {
    window.localStorage.setItem(
      DECK_PREFERENCES_STORAGE_KEY,
      JSON.stringify(parsed),
    );
  } catch {
    // Ignore storage quota or privacy-mode failures; in-memory defaults still apply.
  }
}
