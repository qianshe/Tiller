import type { Dispatch, SetStateAction } from "react";
import type { SessionConfigOption, SessionReasoningEffort } from "@tiller/shared";

export type MissionConfigPicker = "agentMode" | "model" | "reasoning" | null;
export type AgentModeOption = { value: string; label: string };

type MissionConfigControlsProps = {
  showAgentModeSelect: boolean;
  picker: MissionConfigPicker;
  setPicker: Dispatch<SetStateAction<MissionConfigPicker>>;
  agentModeLabel: string;
  agentModeOptions: AgentModeOption[];
  effectiveAgentMode?: string;
  updatePreferences: (next: {
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  }) => void;
  modelPlaceholder: string;
  modelDisabled: boolean;
  modelLabel: string;
  modelBaseOptions: string[];
  resolveReasoningOptionsForModel: (
    model: string,
    modelOptions: string[],
    configOptions: SessionConfigOption[],
  ) => SessionReasoningEffort[];
  allModelOptions: string[];
  configOptions: SessionConfigOption[];
  effectiveReasoningEffort: SessionReasoningEffort;
  effectiveModelBase: string;
  resolveCombinedModelValue: (
    model: string,
    reasoning: SessionReasoningEffort | undefined,
    modelOptions: string[],
  ) => string;
  showReasoningSelect: boolean;
  resolveReasoningLabel: (value: SessionReasoningEffort) => string;
  reasoningOptions: SessionReasoningEffort[];
};

export function MissionConfigControls({
  showAgentModeSelect,
  picker,
  setPicker,
  agentModeLabel,
  agentModeOptions,
  effectiveAgentMode,
  updatePreferences,
  modelPlaceholder,
  modelDisabled,
  modelLabel,
  modelBaseOptions,
  resolveReasoningOptionsForModel,
  allModelOptions,
  configOptions,
  effectiveReasoningEffort,
  effectiveModelBase,
  resolveCombinedModelValue,
  showReasoningSelect,
  resolveReasoningLabel,
  reasoningOptions,
}: MissionConfigControlsProps) {
  return (
    <div className="mission-composer-config" aria-label="当前任务模型配置">
      {showAgentModeSelect ? (
        <div
          className={`mission-config-picker mission-config-picker-agent ${picker === "agentMode" ? "open" : ""}`}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setPicker(null);
            }
          }}
        >
          <button
            type="button"
            className="mission-config-trigger"
            aria-haspopup="listbox"
            aria-expanded={picker === "agentMode"}
            onClick={() =>
              setPicker((current) =>
                current === "agentMode" ? null : "agentMode",
              )
            }
          >
            <span>{agentModeLabel}</span>
          </button>
          {picker === "agentMode" ? (
            <div
              className="mission-config-menu"
              role="listbox"
              aria-label="Agent 列表"
            >
              {agentModeOptions.map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  role="option"
                  aria-selected={option.value === effectiveAgentMode}
                  className={option.value === effectiveAgentMode ? "active" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    updatePreferences({ agentMode: option.value });
                    setPicker(null);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        className={`mission-config-picker mission-config-picker-model ${picker === "model" ? "open" : ""}`}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setPicker(null);
          }
        }}
      >
        <button
          type="button"
          className="mission-config-trigger"
          title={modelPlaceholder}
          aria-haspopup="listbox"
          aria-expanded={picker === "model"}
          disabled={modelDisabled}
          onClick={() =>
            setPicker((current) => (current === "model" ? null : "model"))
          }
        >
          <span>{modelLabel}</span>
        </button>
        {picker === "model" ? (
          <div
            className="mission-config-menu"
            role="listbox"
            aria-label="模型列表"
          >
            {modelBaseOptions.map((model) => {
              const modelReasoningOptions = resolveReasoningOptionsForModel(
                model,
                allModelOptions,
                configOptions,
              );
              const nextReasoning = modelReasoningOptions.includes(
                effectiveReasoningEffort,
              )
                ? effectiveReasoningEffort
                : modelReasoningOptions[0];
              const selected = model === effectiveModelBase;
              return (
                <button
                  key={model}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={selected ? "active" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    updatePreferences({
                      model: resolveCombinedModelValue(
                        model,
                        nextReasoning,
                        allModelOptions,
                      ),
                      ...(nextReasoning
                        ? { reasoningEffort: nextReasoning }
                        : {}),
                    });
                    setPicker(null);
                  }}
                >
                  {model}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {showReasoningSelect ? (
        <div
          className={`mission-config-picker mission-config-picker-reasoning ${picker === "reasoning" ? "open" : ""}`}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setPicker(null);
            }
          }}
        >
          <button
            type="button"
            className="mission-config-trigger"
            aria-haspopup="listbox"
            aria-expanded={picker === "reasoning"}
            onClick={() =>
              setPicker((current) =>
                current === "reasoning" ? null : "reasoning",
              )
            }
          >
            <span>{resolveReasoningLabel(effectiveReasoningEffort)}</span>
          </button>
          {picker === "reasoning" ? (
            <div
              className="mission-config-menu"
              role="listbox"
              aria-label="推理级别"
            >
              {reasoningOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={option === effectiveReasoningEffort}
                  className={option === effectiveReasoningEffort ? "active" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    updatePreferences({
                      model: resolveCombinedModelValue(
                        effectiveModelBase,
                        option,
                        allModelOptions,
                      ),
                      reasoningEffort: option,
                    });
                    setPicker(null);
                  }}
                >
                  {resolveReasoningLabel(option)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
