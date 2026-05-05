import { resolveSessionConfigSupport } from "@tiller/shared";
import type {
  AcpAgentProvider,
  AcpModelOption,
  AgentMessage,
  SessionConfigOption,
  SessionReasoningEffort,
  SessionSummary,
} from "@tiller/shared";
import { resolveModelOptionsFromConfig } from "./session-derivations";

export const MODEL_OPTIONS = [
  "provider-default",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.2",
  "openai/gpt-5.4",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.2",
  "anthropic/claude-sonnet-4",
] as const;

export const REASONING_OPTIONS: Array<{
  value: SessionReasoningEffort;
  label: string;
}> = [
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
];

const STARTUP_MODEL_WITH_INLINE_REASONING_HINT = [
  " 该 provider 会在下次 runtime 启动/恢复时应用模型覆盖；",
  "若当前 provider/model 支持 reasoningEffort，",
  "Tiller 也会通过 inline config 尝试带入，",
  "否则仍只保存在 session 配置中。",
  "模型请使用 provider/model 形式，例如 openai/gpt-5.4。",
].join("");

const NEW_SESSION_MODEL_WITH_INLINE_REASONING_HINT = [
  " 该 provider 的新会话支持写入模型；",
  "若当前 provider/model 支持 reasoningEffort，",
  "Tiller 也会通过 inline config 尝试带入，",
  "否则仅保存在 session 配置中。",
  "模型请使用 provider/model 形式，例如 openai/gpt-5.4。",
].join("");

export function resolvePreferredModel(
  currentModel: string | undefined,
  modelOptions: string[],
) {
  if (currentModel && modelOptions.includes(currentModel)) {
    return currentModel;
  }

  if (currentModel) {
    const currentBase = splitModelReasoning(currentModel).model;
    const matchingBase = modelOptions.find(
      (option) => splitModelReasoning(option).model === currentBase,
    );
    if (matchingBase) {
      return matchingBase;
    }
  }

  return modelOptions[0];
}

export function resolveAgentModeOptions(
  configOptions: SessionConfigOption[] = [],
) {
  const option = configOptions.find(
    (item) => item.category?.toLowerCase() === "mode",
  );
  return (option?.options ?? [])
    .map((item) => ({
      value: typeof item.value === "string" ? item.value : "",
      label: item.label ?? item.name ?? String(item.value ?? ""),
    }))
    .filter((item) => item.value.trim().length > 0);
}

export function resolveCurrentAgentMode(
  currentAgentMode: string | undefined,
  configOptions: SessionConfigOption[] = [],
  probedAgentMode?: string,
) {
  const option = configOptions.find(
    (item) => item.category?.toLowerCase() === "mode",
  );
  const modeOptions = resolveAgentModeOptions(configOptions);
  const validModes = new Set(modeOptions.map((item) => item.value));
  const currentValue =
    typeof option?.currentValue === "string" ? option.currentValue : undefined;
  const selectedValue =
    typeof option?.selectedValue === "string"
      ? option.selectedValue
      : undefined;
  const value = typeof option?.value === "string" ? option.value : undefined;
  const candidates = [
    currentAgentMode,
    currentValue,
    selectedValue,
    value,
    probedAgentMode,
  ]
    .map((candidate) => candidate?.trim())
    .filter((candidate): candidate is string => Boolean(candidate));

  if (validModes.size) {
    return candidates.find((candidate) => validModes.has(candidate));
  }

  return currentValue || selectedValue || value || undefined;
}

export function resolveModelOptions(
  currentModel?: string,
  configOptions: SessionConfigOption[] = [],
  nativeOptions: AcpModelOption[] = [],
) {
  return resolveModelOptionsFromConfig(
    currentModel,
    configOptions,
    nativeOptions,
  );
}

export function resolveReasoningOptions(
  configOptions: SessionConfigOption[] = [],
) {
  const option = configOptions.find((item) =>
    ["thought_level", "reasoning", "reasoning_effort"].includes(
      item.category?.toLowerCase() ?? "",
    ),
  );
  const values = (option?.options ?? [])
    .map((item) => item.value)
    .filter(
      (value): value is SessionReasoningEffort =>
        typeof value === "string" &&
        REASONING_OPTIONS.some((candidate) => candidate.value === value),
    );
  return Array.from(new Set(values));
}

export function resolveReasoningLabel(value: SessionReasoningEffort) {
  return (
    REASONING_OPTIONS.find((option) => option.value === value)?.label ?? value
  );
}

export function splitModelReasoning(value: string | undefined) {
  const raw = value?.trim() ?? "";
  const index = raw.lastIndexOf("/");
  if (index <= 0) {
    return {
      model: raw,
      reasoning: undefined as SessionReasoningEffort | undefined,
    };
  }
  const suffix = raw.slice(index + 1).toLowerCase();
  const reasoning = REASONING_OPTIONS.find(
    (option) => option.value === suffix,
  )?.value;
  return reasoning
    ? { model: raw.slice(0, index), reasoning }
    : {
        model: raw,
        reasoning: undefined as SessionReasoningEffort | undefined,
      };
}

export function resolveBaseModelOptions(modelOptions: string[]) {
  return Array.from(
    new Set(
      modelOptions
        .map((model) => splitModelReasoning(model).model)
        .filter(Boolean),
    ),
  );
}

export function resolveReasoningOptionsForModel(
  model: string,
  modelOptions: string[],
  configOptions: SessionConfigOption[] = [],
) {
  const fromModel = modelOptions
    .map((option) => splitModelReasoning(option))
    .filter((option) => option.model === model && option.reasoning)
    .map((option) => option.reasoning as SessionReasoningEffort);
  if (fromModel.length) {
    return Array.from(new Set(fromModel));
  }

  const fromConfig = resolveReasoningOptions(configOptions);
  return fromConfig.length
    ? fromConfig
    : model.trim()
      ? REASONING_OPTIONS.map((option) => option.value)
      : [];
}

export function resolveCombinedModelValue(
  model: string,
  reasoning: SessionReasoningEffort | undefined,
  modelOptions: string[],
) {
  if (reasoning) {
    const combined = modelOptions.find((option) => {
      const parsed = splitModelReasoning(option);
      return parsed.model === model && parsed.reasoning === reasoning;
    });
    if (combined) {
      return combined;
    }
  }

  return (
    modelOptions.find(
      (option) => splitModelReasoning(option).model === model,
    ) ?? model
  );
}

export function resolveDraftConfigOptions(
  activeSession: SessionSummary | null,
  sessions: SessionSummary[],
  sessionConfigOptions: Record<string, SessionConfigOption[]>,
  selectedAgentId?: string | null,
) {
  if (activeSession) {
    return sessionConfigOptions[activeSession.id] ?? [];
  }

  const cachedSession = sessions.find(
    (session) =>
      session.agentId === selectedAgentId &&
      (sessionConfigOptions[session.id]?.length ?? 0) > 0,
  );
  return cachedSession ? (sessionConfigOptions[cachedSession.id] ?? []) : [];
}

export function normalizeModelSelection(model: string | undefined) {
  return model && model !== "provider-default" ? model : undefined;
}

export function defaultAgentId(agents: AcpAgentProvider[]) {
  return (
    agents.find((agent) => agent.id === "codex")?.id ?? agents[0]?.id ?? null
  );
}

export function resolveSessionConfigHint(
  activeSession: SessionSummary | null,
  agents: AcpAgentProvider[],
  draftAgentId?: string | null,
) {
  const provider = agents.find(
    (agent) => agent.id === (activeSession?.agentId ?? draftAgentId),
  );
  const support = resolveSessionConfigSupport(provider);

  if (support.model === "startup" && support.reasoningEffort === "startup") {
    return activeSession
      ? " 该 provider 会在下次 runtime 启动/恢复时应用模型与推理 覆盖。"
      : " 该 provider 的新会话会直接写入 模型 / 推理。";
  }

  if (support.model === "startup" && support.reasoningEffort === "none") {
    return activeSession
      ? STARTUP_MODEL_WITH_INLINE_REASONING_HINT
      : NEW_SESSION_MODEL_WITH_INLINE_REASONING_HINT;
  }

  return activeSession
    ? " 当前 provider 暂未暴露通用的运行时 模型/推理热切换接口，Tiller 会先保存为 session 配置。"
    : " 新会话会尽量把这些配置带入 provider。";
}

export function resolveModelInputPlaceholder(
  activeSession: SessionSummary | null,
  agents: AcpAgentProvider[],
  draftAgentId?: string | null,
) {
  const provider = agents.find(
    (agent) => agent.id === (activeSession?.agentId ?? draftAgentId),
  );
  const support = resolveSessionConfigSupport(provider);
  return support.modelFormat === "provider/model"
    ? "provider-default 或 openai/gpt-5.4"
    : "provider-default 或 gpt-5.4";
}

export function summarizeSessionContext(
  session: SessionSummary | null,
  sessionMessages: AgentMessage[],
) {
  if (!session) {
    return "暂无活跃任务；请先增强新任务草稿。";
  }
  const recentMessages = sessionMessages
    .slice(-4)
    .map(
      (message) =>
        `${message.role}: ${message.text.replace(/\s+/g, " ").trim().slice(0, 180)}`,
    );
  return [
    `Session ${session.id} is ${session.status}; messages: ${session.messageCount}.`,
    session.lastMessagePreview
      ? `最近意图/结果：${session.lastMessagePreview}`
      : "",
    recentMessages.length
      ? ["最近消息：", ...recentMessages.map((message) => `- ${message}`)].join(
          "\n",
        )
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
