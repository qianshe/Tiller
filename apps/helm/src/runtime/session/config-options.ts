import type {
  SessionConfigOption,
  SessionConfigOptionValue,
  SessionReasoningEffort,
} from "@tiller/shared";

const REASONING_CONFIG_CATEGORIES = new Set([
  "reasoning",
  "reasoning_effort",
  "thought_level",
]);

function configOptionCategory(option: SessionConfigOption) {
  return option.category?.toLowerCase() ?? option.id.toLowerCase();
}

function readConfigOptionValue(option: SessionConfigOption) {
  return option.currentValue ?? option.selectedValue ?? option.value;
}

export function isReasoningConfigOption(option: SessionConfigOption) {
  return REASONING_CONFIG_CATEGORIES.has(configOptionCategory(option));
}

export function configOptionsIncludeReasoning(
  options: SessionConfigOption[] | undefined,
) {
  return Boolean(options?.some((option) => isReasoningConfigOption(option)));
}

export function readModelFromConfigOptions(
  options: SessionConfigOption[] | undefined,
) {
  const option = options?.find((item) => configOptionCategory(item) === "model");
  const value = option ? readConfigOptionValue(option) : undefined;
  return typeof value === "string" ? value : undefined;
}

export function configOptionsMatchSelectedModel(
  options: SessionConfigOption[] | undefined,
  selectedModel: string | undefined,
) {
  const optionsModel = readModelFromConfigOptions(options);
  return !selectedModel || !optionsModel || optionsModel === selectedModel;
}

function alignModelConfigOption(
  option: SessionConfigOption,
  selectedModel: string | undefined,
) {
  return selectedModel &&
    configOptionCategory(option) === "model" &&
    option.currentValue !== selectedModel
    ? { ...option, currentValue: selectedModel }
    : option;
}

export type ResolvedConfigOptions = {
  options: SessionConfigOption[] | undefined;
  authoritative: boolean;
};

export function applyStoredConfigSelection(
  options: SessionConfigOption[] | undefined,
  selection: {
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
    configId?: string;
    value?: SessionConfigOptionValue;
  },
): SessionConfigOption[] | undefined {
  return options?.map((option) => {
    const category = configOptionCategory(option);
    const directValue = option.id === selection.configId ? selection.value : undefined;
    const categoryValue = category === "mode"
      ? selection.agentMode
      : category === "model"
        ? selection.model
        : REASONING_CONFIG_CATEGORIES.has(category)
          ? selection.reasoningEffort
          : undefined;
    const selectedValue = directValue ?? categoryValue;
    return selectedValue === undefined
      ? option
      : {
          ...option,
          currentValue: selectedValue,
          selectedValue,
          value: selectedValue,
        };
  });
}

function alignConfigOptions(
  options: SessionConfigOption[] | undefined,
  selectedModel: string | undefined,
) {
  return options?.map((option) => alignModelConfigOption(option, selectedModel));
}

export function resolveConfigOptionsForSelection(params: {
  incomingOptions: SessionConfigOption[] | undefined;
  previousOptions?: SessionConfigOption[];
  selectedModel?: string;
}): ResolvedConfigOptions {
  const { incomingOptions, previousOptions, selectedModel } = params;
  if (incomingOptions && configOptionsMatchSelectedModel(incomingOptions, selectedModel)) {
    return {
      options: alignConfigOptions(incomingOptions, selectedModel),
      authoritative: true,
    };
  }

  if (previousOptions && configOptionsMatchSelectedModel(previousOptions, selectedModel)) {
    return {
      options: alignConfigOptions(previousOptions, selectedModel),
      authoritative: true,
    };
  }

  return {
    options: previousOptions,
    authoritative: false,
  };
}

export function resolveConfigReasoningEffortForOptions(
  reasoningEffort: SessionReasoningEffort | undefined,
  resolved: ResolvedConfigOptions,
) {
  if (resolved.authoritative && !configOptionsIncludeReasoning(resolved.options)) {
    return undefined;
  }
  return reasoningEffort;
}
