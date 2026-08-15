import type { RefObject } from "react";
import { Button, Input } from "@/shared/ui";
import { cn } from "@/shared/utils/cn";
import type { PromptEnhancerModelOption, PromptEnhancerPreferences } from "../../prompt-enhancer";
import type { DeckPreferences } from "../../preferences";
import { SettingsRow, SettingsSwitch } from "./settings-section-frame";

type PromptEnhancerCardProps = {
  deckPreferences: DeckPreferences;
  pickerRef: RefObject<HTMLDivElement | null>;
  busy: boolean;
  modelPickerOpen: boolean;
  modelFilter: string;
  models: PromptEnhancerModelOption[];
  status: string;
  updatePreference: <K extends keyof PromptEnhancerPreferences>(
    key: K,
    value: PromptEnhancerPreferences[K],
  ) => void;
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
  updatePreference,
  updateLlmPreference,
  updateModelInput,
  setModelPickerOpen,
  refreshModels,
  setModelFilter,
  selectModel,
  testSelectedModel,
}: PromptEnhancerCardProps) {
  const enhancer = deckPreferences.promptEnhancer;
  const llm = enhancer.llm;
  const baseUrlReady = Boolean(llm.baseUrl.trim());
  const modelReady = Boolean(llm.model.trim());
  const apiKeyReady = Boolean(llm.apiKey.trim());
  const readyForTest = baseUrlReady && modelReady;
  const statusTone = getPromptEnhancerStatusTone(status);

  return (
    <div className="grid w-full max-w-[720px] gap-0">
      <div className="border-b border-border-ghost px-4 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <span className="mb-0.5 block text-default text-foreground">Prompt 增强状态</span>
            <span className="text-xs text-muted-foreground">发送前改写草稿；配置保存在当前浏览器。</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
            <PromptEnhancerChip tone={enhancer.enabled ? "success" : "muted"}>
              {enhancer.enabled ? "已启用" : "已关闭"}
            </PromptEnhancerChip>
            <PromptEnhancerChip tone={readyForTest ? "success" : "warning"}>
              {readyForTest ? "可测试" : "缺少配置"}
            </PromptEnhancerChip>
            <PromptEnhancerChip tone={modelReady ? "muted" : "warning"}>
              {modelReady ? llm.model : "未选模型"}
            </PromptEnhancerChip>
          </div>
        </div>
        {status ? (
          <p className={cn("mt-2 text-xs font-medium", statusTone)}>
            {status}
          </p>
        ) : null}
      </div>

      <SettingsRow label="Prompt 增强" desc="控制会话输入框中的增强按钮是否可用">
        <SettingsSwitch
          label="Prompt 增强"
          checked={enhancer.enabled}
          onCheckedChange={(checked) => updatePreference("enabled", checked)}
        />
      </SettingsRow>
      <SettingsRow label="OpenAI-compatible Base URL" desc="兼容 /v1/chat/completions 的服务地址">
        <Input
          className="min-w-0 sm:w-[320px]"
          value={llm.baseUrl}
          onChange={(event) => updateLlmPreference("baseUrl", event.target.value)}
          placeholder="http://localhost:8317"
        />
      </SettingsRow>
      <SettingsRow label="增强模型" desc="从已知模型选择或手动输入">
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
      </SettingsRow>
      <SettingsRow label="API Key" desc={apiKeyReady ? "已保存到浏览器本地偏好" : "可选；本地服务可留空"}>
        <div className="flex w-full min-w-0 items-center gap-2 sm:w-[320px]">
          <Input
            className="min-w-0 flex-1"
            type="password"
            value={llm.apiKey}
            onChange={(event) => updateLlmPreference("apiKey", event.target.value)}
            placeholder="sk-..."
            autoComplete="off"
          />
          {apiKeyReady ? (
            <Button
              variant="outline"
              size="sm"
              type="button"
              className="h-7 px-2 text-action hover:bg-surface-sunken"
              onClick={() => updateLlmPreference("apiKey", "")}
            >
              清空
            </Button>
          ) : null}
        </div>
      </SettingsRow>
      <SettingsRow label="测试连接" desc="发送一次 ping 验证 Base URL、模型与密钥">
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button
            variant="secondary"
            type="button"
            className="h-7 px-3 text-action"
            onClick={testSelectedModel}
            disabled={busy || !readyForTest}
          >
            {busy ? "测试中" : "测试连通性"}
          </Button>
          {!readyForTest ? (
            <span className="text-2xs text-muted-foreground">先填写 Base URL 和模型</span>
          ) : null}
        </div>
      </SettingsRow>
    </div>
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
    <div className="relative z-[3] grid w-full gap-2 sm:w-[320px]" ref={pickerRef}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <Input
          value={currentModel}
          onChange={(event) => updateModelInput(event.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="gpt-4.1-mini"
          autoComplete="off"
        />
        <Button
          className="h-7 min-w-14 px-2 text-action"
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
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 grid max-h-56 gap-1.5 overflow-auto rounded-md border border-border-ghost bg-surface-elevated/90 p-2 text-foreground shadow-ambient backdrop-blur-lg"
          role="listbox"
          aria-label="增强模型列表"
        >
          <Input
            className="min-h-[34px] rounded px-2.5 py-[7px] text-[0.86rem]"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="搜索模型或 owner"
            aria-label="搜索增强模型"
          />
          {busy ? (
            <p className="m-0 rounded bg-surface-sunken px-3 py-2.5 text-[0.86rem] leading-relaxed text-muted-foreground">正在从 /v1/models 获取模型...</p>
          ) : null}
          {!busy && models.length === 0 ? (
            <p className="m-0 rounded bg-surface-sunken px-3 py-2.5 text-[0.86rem] leading-relaxed text-muted-foreground">
              点击刷新，从 /v1/models 加载可用模型。
            </p>
          ) : null}
          {!busy && models.length > 0 && groups.length === 0 ? (
            <p className="m-0 rounded bg-surface-sunken px-3 py-2.5 text-[0.86rem] leading-relaxed text-muted-foreground">没有匹配的模型。</p>
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
                          "min-h-[34px] w-full rounded bg-transparent px-2.5 py-[7px] text-left text-[0.86rem] leading-tight text-foreground shadow-none transition-colors hover:bg-primary-soft hover:text-primary focus-visible:bg-primary-soft focus-visible:text-primary focus-visible:outline-none",
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

function PromptEnhancerChip({
  children,
  tone,
}: {
  children: string;
  tone: "muted" | "success" | "warning";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-[220px] items-center rounded border px-2 font-mono text-2xs leading-none tabular",
        tone === "success" && "border-success/30 bg-success/10 text-success",
        tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
        tone === "muted" && "border-border-ghost bg-surface-sunken text-muted-foreground",
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

function getPromptEnhancerStatusTone(status: string) {
  if (/失败|failed|not configured|未配置|error/iu.test(status)) {
    return "text-warning";
  }
  if (/正常|已获取|已选择|已增强|ok/iu.test(status)) {
    return "text-success";
  }
  return "text-muted-foreground";
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
