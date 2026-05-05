import { useEffect, useState, type RefObject } from "react";
import {
  DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
  DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
  type DeckPreferences,
} from "../../preferences";
import {
  listPromptEnhancerModels,
  testPromptEnhancerConnectivity,
  type PromptEnhancerModelOption,
  type PromptEnhancerPreferences,
} from "../enhancer";

type UseSettingsOptions = {
  preferences: DeckPreferences;
  pickerRef: RefObject<HTMLDivElement | null>;
  updatePreferences: (patch: Partial<DeckPreferences>) => void;
};

/**
 * Owns prompt enhancer settings state and LLM model picker interactions.
 */
export function usePromptEnhancerSettings({
  preferences,
  pickerRef,
  updatePreferences,
}: UseSettingsOptions) {
  const [status, setStatus] = useState("");
  const [models, setModels] = useState<PromptEnhancerModelOption[]>([]);
  const [modelFilter, setModelFilter] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!modelPickerOpen) {
      return;
    }
    function closePromptModelPicker(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && pickerRef.current?.contains(target)) {
        return;
      }
      setModelPickerOpen(false);
    }
    function closePromptModelPickerWithKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setModelPickerOpen(false);
      }
    }
    document.addEventListener("pointerdown", closePromptModelPicker);
    document.addEventListener("keydown", closePromptModelPickerWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closePromptModelPicker);
      document.removeEventListener(
        "keydown",
        closePromptModelPickerWithKeyboard,
      );
    };
  }, [modelPickerOpen, pickerRef]);

  function updatePreference<K extends keyof PromptEnhancerPreferences>(
    key: K,
    value: PromptEnhancerPreferences[K],
  ) {
    updatePreferences({
      promptEnhancer: { ...preferences.promptEnhancer, [key]: value },
    });
  }

  function updateLlmPreference<
    K extends keyof PromptEnhancerPreferences["llm"],
  >(key: K, value: PromptEnhancerPreferences["llm"][K]) {
    updatePreferences({
      promptEnhancer: {
        ...preferences.promptEnhancer,
        llm: { ...preferences.promptEnhancer.llm, [key]: value },
      },
    });
  }

  function resetDefaults() {
    updatePreferences({
      promptEnhancer: {
        ...preferences.promptEnhancer,
        llm: {
          ...preferences.promptEnhancer.llm,
          systemPrompt: DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
          instructionTemplate: DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
        },
      },
    });
    setStatus("已恢复默认增强器 System Prompt 与指令模板。");
  }

  async function testSelectedModel() {
    setBusy(true);
    setStatus("正在测试 LLM 连通性...");
    try {
      await testPromptEnhancerConnectivity(preferences.promptEnhancer.llm);
      setStatus("LLM 连通性正常。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "LLM 连通性测试失败");
    } finally {
      setBusy(false);
    }
  }

  async function refreshModels() {
    setBusy(true);
    setModelPickerOpen(true);
    setStatus("正在获取模型列表...");
    try {
      const nextModels = await listPromptEnhancerModels(
        preferences.promptEnhancer.llm,
      );
      setModels(nextModels);
      const ownerCount = new Set(nextModels.map((model) => model.ownedBy)).size;
      setStatus(
        nextModels.length
          ? `已获取 ${nextModels.length} 个模型，来自 ${ownerCount} 个 owner。`
          : "模型接口可用，但没有返回模型。",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "获取模型失败");
    } finally {
      setBusy(false);
    }
  }

  function updateModelInput(value: string) {
    updateLlmPreference("model", value);
    setModelFilter(value);
    setModelPickerOpen(true);
  }

  function selectModel(model: PromptEnhancerModelOption) {
    updateLlmPreference("model", model.id);
    setModelFilter("");
    setModelPickerOpen(false);
    setStatus(`已选择 ${model.id}（${model.ownedBy}）。`);
  }

  return {
    busy,
    setBusy,
    status,
    setStatus,
    models,
    modelFilter,
    setModelFilter,
    modelPickerOpen,
    setModelPickerOpen,
    updatePreference,
    updateLlmPreference,
    resetDefaults,
    testSelectedModel,
    refreshModels,
    updateModelInput,
    selectModel,
  };
}
