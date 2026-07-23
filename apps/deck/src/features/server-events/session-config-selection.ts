import type {
  CanonicalSessionConfigState,
  SessionConfigOption,
  SessionSummary,
} from "@tiller/shared";

export type SessionConfigSelection = Pick<SessionSummary, "agentMode" | "model" | "reasoningEffort">;

export function hasInitializedSessionConfig(
  config: CanonicalSessionConfigState | undefined,
) {
  return Boolean(
    config && (
      config.agentMode !== undefined ||
      config.model !== undefined ||
      config.reasoningEffort !== undefined ||
      config.configOptions.length > 0 ||
      config.modelOptions.length > 0
    ),
  );
}

export function deriveConfigOptionMapsFromSessions(sessions: SessionSummary[]) {
  return Object.fromEntries(
    sessions
      .filter((session) => (session.configOptions?.length ?? 0) > 0)
      .map((session) => [
        session.id,
        applySessionConfigSelection(session.configOptions ?? [], session),
      ] as const),
  );
}

function configOptionCategory(option: SessionConfigOption) {
  return option.category?.toLowerCase() ?? option.id.toLowerCase();
}

function isReasoningConfigOption(option: SessionConfigOption) {
  const category = configOptionCategory(option);
  return category === "reasoning" ||
    category === "reasoning_effort" ||
    category === "thought_level";
}

function hasReasoningConfigOption(options: SessionConfigOption[]) {
  return options.some((option) => isReasoningConfigOption(option));
}

function readConfigSelectionFromOptions(options: SessionConfigOption[]) {
  return options.reduce<SessionConfigSelection>((selection, option) => {
    const category = configOptionCategory(option);
    const currentValue = option.currentValue ?? option.selectedValue ?? option.value;
    if (category === "mode" && typeof currentValue === "string") {
      selection.agentMode = currentValue;
    } else if (category === "model" && typeof currentValue === "string") {
      selection.model = currentValue;
    } else if (isReasoningConfigOption(option) && typeof currentValue === "string") {
      selection.reasoningEffort = currentValue as SessionConfigSelection["reasoningEffort"];
    }
    return selection;
  }, {});
}

export function resolveSessionConfigSelection(
  current: SessionConfigSelection | undefined,
  state: Partial<SessionConfigSelection> | undefined,
  options?: SessionConfigOption[],
): SessionConfigSelection {
  const selection: SessionConfigSelection = {
    ...(current ?? {}),
    ...(options ? readConfigSelectionFromOptions(options) : {}),
    ...(state ?? {}),
  };
  if (options && !hasReasoningConfigOption(options)) {
    const { reasoningEffort: _reasoningEffort, ...withoutReasoning } = selection;
    return withoutReasoning as SessionConfigSelection;
  }
  return selection;
}

export function applySessionConfigSelection(
  options: SessionConfigOption[],
  selection: SessionConfigSelection,
) {
  return options.map((option) => {
    const category = configOptionCategory(option);
    let selectedValue: SessionConfigOption["currentValue"] | undefined;
    if (category === "model") {
      selectedValue = selection.model;
    } else if (category === "mode") {
      selectedValue = selection.agentMode;
    } else if (isReasoningConfigOption(option)) {
      selectedValue = selection.reasoningEffort;
    }
    return selectedValue === undefined
      ? option
      : { ...option, currentValue: selectedValue };
  });
}
