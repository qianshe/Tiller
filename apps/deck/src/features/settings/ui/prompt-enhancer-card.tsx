import type { RefObject } from "react";
import type { PromptEnhancerModelOption } from "../../prompt-enhancer";
import {
  DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
  DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
  type DeckPreferences,
} from "../../preferences";

type PromptEnhancerCardProps = {
  deckPreferences: DeckPreferences;
  pickerRef: RefObject<HTMLDivElement | null>;
  busy: boolean;
  modelPickerOpen: boolean;
  modelFilter: string;
  models: PromptEnhancerModelOption[];
  status: string;
  updateLlmPreference: <
    K extends keyof DeckPreferences["promptEnhancer"]["llm"],
  >(
    key: K,
    value: DeckPreferences["promptEnhancer"]["llm"][K],
  ) => void;
  updateModelInput: (value: string) => void;
  setModelPickerOpen: (open: boolean) => void;
  refreshModels: () => void;
  setModelFilter: (value: string) => void;
  selectModel: (model: PromptEnhancerModelOption) => void;
  resetDefaults: () => void;
  testSelectedModel: () => void;
};

export function PromptEnhancerCard({
  deckPreferences,
  pickerRef,
  busy,
  modelPickerOpen,
  modelFilter,
  models,
  status,
  updateLlmPreference,
  updateModelInput,
  setModelPickerOpen,
  refreshModels,
  setModelFilter,
  selectModel,
  resetDefaults,
  testSelectedModel,
}: PromptEnhancerCardProps) {
  return (
    <section className="note-box settings-card settings-card-full prompt-enhancer-card">
      <div className="settings-card-head">
        <div>
          <p className="eyebrow">提示词增强</p>
          <h3>LLM 增强器</h3>
        </div>
      </div>
      <div className="prompt-enhancer-grid prompt-llm-grid">
        <label>
          <span>OpenAI-compatible Base URL</span>
          <input
            value={deckPreferences.promptEnhancer.llm.baseUrl}
            onChange={(event) =>
              updateLlmPreference("baseUrl", event.target.value)
            }
            placeholder="http://localhost:8317"
          />
        </label>
        <label>
          <span>增强模型</span>
          <PromptModelPicker
            busy={busy}
            currentModel={deckPreferences.promptEnhancer.llm.model}
            filter={modelFilter}
            models={models}
            open={modelPickerOpen}
            pickerRef={pickerRef}
            refreshModels={refreshModels}
            selectModel={selectModel}
            setFilter={setModelFilter}
            setOpen={setModelPickerOpen}
            updateModelInput={updateModelInput}
          />
        </label>
        <label className="settings-card-full">
          <span>API Key</span>
          <input
            type="password"
            value={deckPreferences.promptEnhancer.llm.apiKey}
            onChange={(event) =>
              updateLlmPreference("apiKey", event.target.value)
            }
            placeholder="sk-..."
            autoComplete="off"
          />
        </label>
        <label className="settings-card-full">
          <span>增强器 System Prompt</span>
          <textarea
            value={deckPreferences.promptEnhancer.llm.systemPrompt}
            onChange={(event) =>
              updateLlmPreference("systemPrompt", event.target.value)
            }
            placeholder={DEFAULT_PROMPT_LLM_SYSTEM_PROMPT}
          />
        </label>
        <label className="settings-card-full">
          <span>增强器指令模板</span>
          <textarea
            value={deckPreferences.promptEnhancer.llm.instructionTemplate}
            onChange={(event) =>
              updateLlmPreference("instructionTemplate", event.target.value)
            }
            placeholder={DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE}
          />
        </label>
        <div className="section-actions settings-card-full">
          <button className="secondary" type="button" onClick={resetDefaults}>
            恢复默认模板
          </button>
          <button
            className="secondary"
            type="button"
            onClick={testSelectedModel}
            disabled={busy}
          >
            测试连通性
          </button>
          {status ? <span className="settings-status">{status}</span> : null}
        </div>
      </div>
    </section>
  );
}

type PromptModelPickerProps = {
  busy: boolean;
  currentModel: string;
  filter: string;
  models: PromptEnhancerModelOption[];
  open: boolean;
  pickerRef: RefObject<HTMLDivElement | null>;
  refreshModels: () => void;
  selectModel: (model: PromptEnhancerModelOption) => void;
  setFilter: (value: string) => void;
  setOpen: (open: boolean) => void;
  updateModelInput: (value: string) => void;
};

function PromptModelPicker({
  busy,
  currentModel,
  filter,
  models,
  open,
  pickerRef,
  refreshModels,
  selectModel,
  setFilter,
  setOpen,
  updateModelInput,
}: PromptModelPickerProps) {
  const groups = groupPromptEnhancerModels(models, filter);

  return (
    <div className="prompt-model-combobox" ref={pickerRef}>
      <div className="prompt-model-input-row">
        <input
          value={currentModel}
          onChange={(event) => updateModelInput(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="gpt-4.1-mini"
          autoComplete="off"
        />
        <button
          className="secondary"
          type="button"
          onClick={refreshModels}
          disabled={busy}
        >
          {busy ? "加载" : "刷新"}
        </button>
      </div>
      {open ? (
        <div
          className="prompt-model-picker"
          role="listbox"
          aria-label="增强模型列表"
        >
          <input
            className="prompt-model-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="搜索模型或 owner"
            aria-label="搜索增强模型"
          />
          {busy ? (
            <p className="prompt-model-empty">正在从 /v1/models 获取模型...</p>
          ) : null}
          {!busy && models.length === 0 ? (
            <p className="prompt-model-empty">
              点击刷新，从 /v1/models 加载可用模型。
            </p>
          ) : null}
          {!busy && models.length > 0 && groups.length === 0 ? (
            <p className="prompt-model-empty">没有匹配的模型。</p>
          ) : null}
          {!busy
            ? groups.map((group) => (
                <div className="prompt-model-group" key={group.owner}>
                  <p className="prompt-model-owner">
                    {group.owner}
                    <span>{group.models.length}</span>
                  </p>
                  <div className="prompt-model-option-list">
                    {group.models.map((model) => (
                      <button
                        className={`prompt-model-option ${model.id === currentModel ? "active" : ""}`}
                        key={`${model.ownedBy}:${model.id}`}
                        type="button"
                        role="option"
                        aria-selected={model.id === currentModel}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectModel(model)}
                      >
                        {model.id}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

function groupPromptEnhancerModels(
  models: PromptEnhancerModelOption[],
  filter: string,
) {
  const needle = filter.trim().toLowerCase();
  const groups = new Map<string, PromptEnhancerModelOption[]>();
  for (const model of models) {
    if (
      needle &&
      !model.id.toLowerCase().includes(needle) &&
      !model.ownedBy.toLowerCase().includes(needle)
    ) {
      continue;
    }
    const owner = model.ownedBy || "default";
    groups.set(owner, [...(groups.get(owner) ?? []), model]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([owner, ownerModels]) => ({
      owner,
      models: ownerModels.sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    }));
}
