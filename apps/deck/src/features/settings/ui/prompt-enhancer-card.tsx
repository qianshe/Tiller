import type { RefObject } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from "@/shared/ui";
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
    <Card className="prompt-enhancer-card grid content-start gap-4 p-4 shadow-card lg:col-span-3">
      <CardHeader className="p-0">
        <p className="eyebrow">提示词增强</p>
        <CardTitle>LLM 增强器</CardTitle>
      </CardHeader>
      <CardContent className="prompt-enhancer-grid prompt-llm-grid p-0">
        <Label className="grid gap-2">
          <span>OpenAI-compatible Base URL</span>
          <Input
            value={deckPreferences.promptEnhancer.llm.baseUrl}
            onChange={(event) =>
              updateLlmPreference("baseUrl", event.target.value)
            }
            placeholder="http://localhost:8317"
          />
        </Label>
        <Label className="grid gap-2">
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
        </Label>
        <Label className="grid gap-2 md:col-span-2">
          <span>API Key</span>
          <Input
            type="password"
            value={deckPreferences.promptEnhancer.llm.apiKey}
            onChange={(event) =>
              updateLlmPreference("apiKey", event.target.value)
            }
            placeholder="sk-..."
            autoComplete="off"
          />
        </Label>
        <Label className="grid gap-2 md:col-span-2">
          <span>增强器 System Prompt</span>
          <Textarea
            className="min-h-32"
            value={deckPreferences.promptEnhancer.llm.systemPrompt}
            onChange={(event) =>
              updateLlmPreference("systemPrompt", event.target.value)
            }
            placeholder={DEFAULT_PROMPT_LLM_SYSTEM_PROMPT}
          />
        </Label>
        <Label className="grid gap-2 md:col-span-2">
          <span>增强器指令模板</span>
          <Textarea
            className="min-h-32"
            value={deckPreferences.promptEnhancer.llm.instructionTemplate}
            onChange={(event) =>
              updateLlmPreference("instructionTemplate", event.target.value)
            }
            placeholder={DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE}
          />
        </Label>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <Button variant="secondary" type="button" onClick={resetDefaults}>
            恢复默认模板
          </Button>
          <Button
            variant="secondary"
            type="button"
            onClick={testSelectedModel}
            disabled={busy}
          >
            测试连通性
          </Button>
          {status ? (
            <span className="text-sm font-medium text-success">{status}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
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
        <Input
          value={currentModel}
          onChange={(event) => updateModelInput(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="gpt-4.1-mini"
          autoComplete="off"
        />
        <Button
          variant="secondary"
          type="button"
          onClick={refreshModels}
          disabled={busy}
        >
          {busy ? "加载" : "刷新"}
        </Button>
      </div>
      {open ? (
        <div
          className="prompt-model-picker"
          role="listbox"
          aria-label="增强模型列表"
        >
          <Input
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
