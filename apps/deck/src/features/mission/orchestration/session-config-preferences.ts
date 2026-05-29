import type { SessionConfigOption, SessionConfigOptionValue } from "@tiller/shared";
import type { SessionConfigPreferencePatch } from "../types";
import { normalizeModelSelection } from "../utils/composer-options";

export function applyConfigOptionValue(
  options: SessionConfigOption[] = [],
  configId: string,
  value: SessionConfigOptionValue | undefined,
) {
  return options.map((option) =>
    option.id === configId ? { ...option, currentValue: value } : option,
  );
}

export function readConfigSelectionState(options: SessionConfigOption[]) {
  return options.reduce<Pick<SessionConfigPreferencePatch, "agentMode" | "model" | "reasoningEffort">>(
    (state, option) => {
      const category = option.category?.toLowerCase() ?? option.id.toLowerCase();
      const currentValue = option.currentValue ?? option.selectedValue ?? option.value;
      if (category === "mode" && typeof currentValue === "string") {
        state.agentMode = currentValue;
      } else if (category === "model" && typeof currentValue === "string") {
        state.model = currentValue;
      } else if (
        (category === "reasoning" ||
          category === "reasoning_effort" ||
          category === "thought_level") &&
        typeof currentValue === "string"
      ) {
        state.reasoningEffort = currentValue as SessionConfigPreferencePatch["reasoningEffort"];
      }
      return state;
    },
    {},
  );
}

export function toConfigPatchState(next: SessionConfigPreferencePatch) {
  return {
    ...(next.agentMode ? { agentMode: next.agentMode } : {}),
    ...(next.model ? { model: normalizeModelSelection(next.model) } : {}),
    ...(next.reasoningEffort ? { reasoningEffort: next.reasoningEffort } : {}),
  } satisfies Pick<SessionConfigPreferencePatch, "agentMode" | "model" | "reasoningEffort">;
}
