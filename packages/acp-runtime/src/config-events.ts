import type { AcpModelOption, AcpModelState, SessionReasoningEffort } from "@tiller/shared";
import type { AcpSessionConfigOption, AcpSessionConfigState } from "./runtime-types";

export function extractSessionConfigOptions(payload: any): AcpSessionConfigOption[] {
  const rawOptions = Array.isArray(payload?.configOptions)
    ? payload.configOptions
    : Array.isArray(payload?.sessionConfig?.configOptions)
      ? payload.sessionConfig.configOptions
      : Array.isArray(payload?.update?.configOptions)
        ? payload.update.configOptions
        : [];

  return rawOptions
    .filter((option: any) => option && typeof option.id === "string")
    .map((option: any) => ({
      id: String(option.id),
      name: typeof option.name === "string" ? option.name : undefined,
      category: typeof option.category === "string" ? option.category : undefined,
      currentValue: option.currentValue,
      selectedValue: option.selectedValue,
      value: option.value,
      options: Array.isArray(option.options)
        ? flattenSessionConfigOptions(option.options)
        : undefined,
    }));
}

function flattenSessionConfigOptions(
  options: any[],
): NonNullable<AcpSessionConfigOption["options"]> {
  return options.flatMap((item: any): NonNullable<AcpSessionConfigOption["options"]> => {
    if (Array.isArray(item?.options)) {
      return flattenSessionConfigOptions(item.options);
    }
    return [{
      value: item?.value,
      label: typeof item?.label === "string" ? item.label : typeof item?.name === "string" ? item.name : undefined,
      name: typeof item?.name === "string" ? item.name : undefined,
    }];
  });
}

export function extractAcpModelState(configOptions: AcpSessionConfigOption[]): AcpModelState | undefined {
  const modelOption = configOptions.find((option) => option.category?.toLowerCase() === "model");
  if (!modelOption) {
    return undefined;
  }

  const options = (modelOption.options ?? [])
    .map((option) => normalizeAcpModelOption(option))
    .filter((model): model is AcpModelOption => Boolean(model));
  if (!options.length) {
    return undefined;
  }

  const currentModelId = modelOption.currentValue ?? modelOption.selectedValue ?? modelOption.value;

  return {
    currentModelId: typeof currentModelId === "string" ? currentModelId : undefined,
    options,
  };
}

function normalizeAcpModelOption(option: NonNullable<AcpSessionConfigOption["options"]>[number]): AcpModelOption | null {
  const modelId = option?.value;
  if (typeof modelId !== "string" || !modelId.trim()) {
    return null;
  }

  const label = option.label ?? option.name;
  return {
    id: modelId,
    name: typeof label === "string" && label.trim() ? label : modelId,
  };
}

export function resolveCombinedSessionConfigState(configOptions: AcpSessionConfigOption[], modelState?: AcpModelState): AcpSessionConfigState {
  const state = resolveSessionConfigState(configOptions);
  return {
    ...state,
    ...(!state.model && modelState?.currentModelId ? { model: modelState.currentModelId } : {}),
  };
}

export function hasSessionConfigOptionValue(configOptions: AcpSessionConfigOption[], category: string, value: string) {
  const option = configOptions.find((item) => item.category?.toLowerCase() === category);
  if (!option) {
    return false;
  }

  const candidates = [option.currentValue, option.selectedValue, option.value, ...(option.options ?? []).map((item) => item.value)];
  return candidates.some((candidate) => candidate === value);
}

export function hasSessionConfigOptionIdValue(
  configOptions: AcpSessionConfigOption[],
  configId: string,
  value: AcpSessionConfigOption["value"],
) {
  const option = configOptions.find((item) => item.id === configId);
  if (!option) {
    return false;
  }
  const knownValues = [option.currentValue, option.selectedValue, option.value];
  const knownPrimitiveTypes = new Set(
    knownValues
      .filter((candidate): candidate is string | boolean => typeof candidate === "string" || typeof candidate === "boolean")
      .map((candidate) => typeof candidate),
  );
  if (knownPrimitiveTypes.size && !knownPrimitiveTypes.has(typeof value)) {
    return false;
  }
  if (typeof value === "string") {
    return true;
  }
  if (typeof value === "boolean") {
    return true;
  }
  return typeof option.currentValue === typeof value || typeof option.value === typeof value;
}

export function resolveSessionConfigState(configOptions: AcpSessionConfigOption[]): AcpSessionConfigState {
  const state: AcpSessionConfigState = {};
  const agentModeValue = readSessionConfigValue(configOptions, "mode");
  if (typeof agentModeValue === "string" && agentModeValue) {
    state.agentMode = agentModeValue;
  }

  const modelValue = readSessionConfigValue(configOptions, "model");
  if (typeof modelValue === "string" && modelValue) {
    state.model = modelValue;
  }

  const reasoningValue = readSessionConfigValue(configOptions, "thought_level");
  if (typeof reasoningValue === "string" && reasoningValue) {
    state.reasoningEffort = reasoningValue as SessionReasoningEffort;
  }

  return state;
}

function readSessionConfigValue(configOptions: AcpSessionConfigOption[], category: string) {
  const option = configOptions.find((item) => item.category?.toLowerCase() === category);
  return option?.currentValue ?? option?.selectedValue ?? option?.value;
}

export function findSessionConfigOptionId(configOptions: AcpSessionConfigOption[], category: string) {
  return configOptions.find((item) => item.category?.toLowerCase() === category)?.id;
}
