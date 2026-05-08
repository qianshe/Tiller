import type { Dispatch, SetStateAction } from "react";
import type { SessionConfigOption, SessionReasoningEffort } from "@tiller/shared";
import { cn } from "../../../shared/utils/cn";

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
  modelLoading: boolean;
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
  modelLoading,
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
    <div className="mission-composer-config grid min-w-0 gap-2" aria-label="当前任务模型配置">
      {showAgentModeSelect ? (
        <div
          className={`mission-config-picker mission-config-picker-agent ${picker === "agentMode" ? "open" : ""} relative`}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setPicker(null);
            }
          }}
        >
          <button
            type="button"
            className="mission-config-trigger inline-flex w-full max-w-full items-center justify-between gap-2 rounded-md border border-border-ghost bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-emphasis disabled:cursor-not-allowed disabled:opacity-60"
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
              className="mission-config-menu absolute bottom-full left-0 z-[60] mb-2 grid max-h-48 w-full gap-1 overflow-auto rounded-md border border-border-ghost bg-surface p-1 shadow-ambient"
              role="listbox"
              aria-label="Agent 列表"
            >
              {agentModeOptions.map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  role="option"
                  aria-selected={option.value === effectiveAgentMode}
                  className={cn("rounded-sm px-3 py-2 text-left text-sm text-foreground transition hover:bg-primary-soft hover:text-primary", option.value === effectiveAgentMode && "active bg-primary-soft text-primary")}
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
        className={`mission-config-picker mission-config-picker-model ${picker === "model" ? "open" : ""} min-w-0 relative`}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setPicker(null);
          }
        }}
      >
        <button
          type="button"
          className="mission-config-trigger inline-flex w-full max-w-full items-center justify-between gap-2 rounded-md border border-border-ghost bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-emphasis disabled:cursor-not-allowed disabled:opacity-60"
          title={modelPlaceholder}
          aria-haspopup="listbox"
          aria-expanded={picker === "model"}
          disabled={modelDisabled}
          onClick={() =>
            setPicker((current) => (current === "model" ? null : "model"))
          }
        >
          <span>{modelLabel}</span>
          {modelLoading ? (
            <small className="mission-config-loading-badge rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">加载中</small>
          ) : null}
        </button>
        {picker === "model" ? (
          <div
            className="mission-config-menu absolute bottom-full left-0 z-[60] mb-2 grid max-h-48 w-full gap-1 overflow-auto rounded-md border border-border-ghost bg-surface p-1 shadow-ambient"
            role="listbox"
            aria-label="模型列表"
          >
            {modelLoading ? (
              <button type="button" role="option" aria-selected="false" disabled>
                正在加载模型列表...
              </button>
            ) : null}
            {modelBaseOptions.length === 0 ? (
              <button type="button" role="option" aria-selected="false" disabled>
                {modelLabel || modelPlaceholder}
              </button>
            ) : null}
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
                  className={cn("rounded-sm px-3 py-2 text-left text-sm text-foreground transition hover:bg-primary-soft hover:text-primary", selected && "active bg-primary-soft text-primary")}
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
          className={`mission-config-picker mission-config-picker-reasoning ${picker === "reasoning" ? "open" : ""} relative`}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setPicker(null);
            }
          }}
        >
          <button
            type="button"
            className="mission-config-trigger inline-flex w-full max-w-full items-center justify-between gap-2 rounded-md border border-border-ghost bg-surface px-3 py-2 text-sm font-medium text-foreground transition hover:bg-surface-emphasis"
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
              className="mission-config-menu absolute bottom-full left-0 z-[60] mb-2 grid max-h-48 w-full gap-1 overflow-auto rounded-md border border-border-ghost bg-surface p-1 shadow-ambient"
              role="listbox"
              aria-label="推理级别"
            >
              {reasoningOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={option === effectiveReasoningEffort}
                  className={cn("rounded-sm px-3 py-2 text-left text-sm text-foreground transition hover:bg-primary-soft hover:text-primary", option === effectiveReasoningEffort && "active bg-primary-soft text-primary")}
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
