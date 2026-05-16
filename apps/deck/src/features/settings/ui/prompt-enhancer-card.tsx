import type { RefObject } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@/shared/ui";
import { cn } from "@/shared/utils/cn";
import type { PromptEnhancerModelOption } from "../../prompt-enhancer";
import type { DeckPreferences } from "../../preferences";

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
  testSelectedModel,
}: PromptEnhancerCardProps) {
  return (
    <Card className="grid content-start gap-[18px] overflow-visible p-4 shadow-card lg:col-span-3">
      <CardHeader className="p-0">
        <p className="eyebrow">提示词增强</p>
        <CardTitle>LLM 增强器</CardTitle>
      </CardHeader>
      <CardContent className="grid items-start gap-4 p-0 min-[980px]:grid-cols-2">
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
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
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
    <div className="relative z-[3] grid gap-2" ref={pickerRef}>
      <div className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-2.5 max-[980px]:grid-cols-[minmax(0,1fr)_84px]">
        <Input
          value={currentModel}
          onChange={(event) => updateModelInput(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="gpt-4.1-mini"
          autoComplete="off"
        />
        <Button
          className="h-[46px] min-w-24 rounded-[14px] px-3 max-[980px]:min-w-[84px]"
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
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 grid max-h-56 gap-1.5 overflow-auto rounded-2xl border border-border-ghost bg-surface-elevated/90 p-2 text-foreground shadow-ambient backdrop-blur-lg"
          role="listbox"
          aria-label="增强模型列表"
        >
          <Input
            className="min-h-[34px] rounded-[10px] px-2.5 py-[7px] text-[0.86rem]"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="搜索模型或 owner"
            aria-label="搜索增强模型"
          />
          {busy ? (
            <p className="m-0 rounded-xl bg-surface-sunken px-3 py-2.5 text-[0.86rem] leading-relaxed text-muted-foreground">正在从 /v1/models 获取模型...</p>
          ) : null}
          {!busy && models.length === 0 ? (
            <p className="m-0 rounded-xl bg-surface-sunken px-3 py-2.5 text-[0.86rem] leading-relaxed text-muted-foreground">
              点击刷新，从 /v1/models 加载可用模型。
            </p>
          ) : null}
          {!busy && models.length > 0 && groups.length === 0 ? (
            <p className="m-0 rounded-xl bg-surface-sunken px-3 py-2.5 text-[0.86rem] leading-relaxed text-muted-foreground">没有匹配的模型。</p>
          ) : null}
          {!busy
            ? groups.map((group) => (
                <div className="grid gap-1.5" key={group.owner}>
                  <p className="m-0 flex items-center justify-between px-0.5 pt-1 text-[0.72rem] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
                    {group.owner}
                    <span className="min-w-[22px] rounded-full bg-primary-soft px-1.5 py-0.5 text-center tracking-normal text-primary">{group.models.length}</span>
                  </p>
                  <div className="grid gap-1.5">
                    {group.models.map((model) => (
                      <button
                        className={cn(
                          "min-h-[34px] w-full rounded-[10px] bg-transparent px-2.5 py-[7px] text-left text-[0.86rem] leading-tight text-foreground shadow-none transition-colors hover:bg-primary-soft hover:text-primary focus-visible:bg-primary-soft focus-visible:text-primary focus-visible:outline-none",
                          model.id === currentModel &&
                            "bg-primary-soft text-primary shadow-[inset_3px_0_0_var(--primary)]",
                        )}
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
