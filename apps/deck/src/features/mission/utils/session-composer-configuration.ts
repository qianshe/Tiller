import type {
  AcpAgentProvider,
  AcpModelOption,
  SessionConfigOption,
  SessionReasoningEffort,
  SessionSummary,
} from "@tiller/shared";
import {
  MODEL_OPTIONS,
  resolveAgentModeOptions,
  resolveBaseModelOptions,
  resolveCurrentAgentMode,
  resolveDraftConfigOptions,
  resolveModelInputPlaceholder,
  resolveModelOptions,
  resolveReasoningOptionsForModel,
  resolveSessionConfigHint,
  splitModelReasoning,
} from "./composer-options";
import {
  resolvePromptPlaceholder,
  resolveSessionTitlePlaceholder,
} from "./session-derivations";

export type SessionComposerConfiguration = {
  draftAgent: AcpAgentProvider | null;
  draftAgentMode: string;
  draftModel: string;
  draftReasoningEffort: SessionReasoningEffort;
  draftPromptPlaceholder: string;
  draftSessionTitlePlaceholder: string;
  draftConfigHint: string;
  draftModelPlaceholder: string;
  draftAgentModelOptionsKey: null;
  draftAgentModelOptions: undefined;
  draftConfigOptions: SessionConfigOption[];
  cachedModelSession: null;
  draftNativeModelOptions: AcpModelOption[];
  draftAgentModeOptions: Array<{ value: string; label: string }>;
  effectiveDraftAgentMode: string | undefined;
  showDraftAgentModeSelect: boolean;
  draftAgentModePickerLabel: string;
  draftModelOptions: string[];
  draftAllModelOptions: string[];
  draftModelParts: ReturnType<typeof splitModelReasoning>;
  draftModelBase: string;
  draftModelBaseOptions: string[];
  draftModelBaseValid: boolean;
  effectiveDraftModelBase: string;
  draftModelPickerLabel: string;
  draftModelLoading: false;
  draftModelConfigReady: boolean;
  draftModelPickerDisabled: boolean;
  draftReasoningOptions: SessionReasoningEffort[];
  effectiveDraftReasoningEffort: SessionReasoningEffort;
  showDraftReasoningSelect: boolean;
};

export function resolveSessionComposerConfiguration({
  session,
  sessions,
  sessionConfigOptions,
  agents = [],
}: {
  session: SessionSummary;
  sessions: SessionSummary[];
  sessionConfigOptions: Record<string, SessionConfigOption[]>;
  agents?: AcpAgentProvider[];
}): SessionComposerConfiguration {
  const draftAgent = agents.find((agent) => agent.id === session.agentId) ?? null;
  const draftAgentMode = session.agentMode ?? "";
  const draftModel = session.model ?? MODEL_OPTIONS[0];
  const draftReasoningEffort = session.reasoningEffort ?? "medium";
  const draftConfigOptions = resolveDraftConfigOptions(
    session,
    sessions,
    sessionConfigOptions,
    session.agentId,
  );
  const draftNativeModelOptions = session.modelOptions ?? [];
  const draftAgentModeOptions = resolveAgentModeOptions(draftConfigOptions);
  const effectiveDraftAgentMode = resolveCurrentAgentMode(
    draftAgentMode,
    draftConfigOptions,
  );
  const showDraftAgentModeSelect = draftAgentModeOptions.length > 0;
  const draftModelOptions = resolveModelOptions(
    draftModel,
    draftConfigOptions,
    draftNativeModelOptions,
  );
  const draftAllModelOptions = Array.from(new Set([
    ...draftModelOptions,
    ...draftNativeModelOptions.map((option) => option.id),
  ]));
  const draftModelParts = splitModelReasoning(draftModel);
  const draftModelBase = draftModelParts.model || draftModel;
  const draftModelBaseOptions = resolveBaseModelOptions(draftModelOptions);
  const draftModelBaseValid = draftModelBaseOptions.includes(draftModelBase);
  const effectiveDraftModelBase = draftModelBaseValid
    ? draftModelBase
    : (draftModelBaseOptions[0] ?? draftModelBase);
  const draftReasoningOptions = resolveReasoningOptionsForModel(
    effectiveDraftModelBase,
    draftAllModelOptions,
    draftConfigOptions,
  );
  const effectiveDraftReasoningEffort =
    draftModelParts.reasoning ?? draftReasoningEffort;

  return {
    draftAgent,
    draftAgentMode,
    draftModel,
    draftReasoningEffort,
    draftPromptPlaceholder: resolvePromptPlaceholder(draftAgent),
    draftSessionTitlePlaceholder: resolveSessionTitlePlaceholder(draftAgent),
    draftConfigHint: resolveSessionConfigHint(session, agents, session.agentId),
    draftModelPlaceholder: resolveModelInputPlaceholder(session, agents, session.agentId),
    draftAgentModelOptionsKey: null,
    draftAgentModelOptions: undefined,
    draftConfigOptions,
    cachedModelSession: null,
    draftNativeModelOptions,
    draftAgentModeOptions,
    effectiveDraftAgentMode,
    showDraftAgentModeSelect,
    draftAgentModePickerLabel: showDraftAgentModeSelect
      ? (draftAgentModeOptions.find(
          (option) => option.value === effectiveDraftAgentMode,
        )?.label ?? effectiveDraftAgentMode ?? "选择 Agent")
      : "暂无 Agent 列表",
    draftModelOptions,
    draftAllModelOptions,
    draftModelParts,
    draftModelBase,
    draftModelBaseOptions,
    draftModelBaseValid,
    effectiveDraftModelBase,
    draftModelPickerLabel: draftModelBaseOptions.length
      ? effectiveDraftModelBase
      : "暂无模型列表",
    draftModelLoading: false,
    draftModelConfigReady:
      (sessionConfigOptions[session.id]?.length ?? 0) > 0 ||
      (session.configOptions?.length ?? 0) > 0 ||
      (session.modelOptions?.length ?? 0) > 0,
    draftModelPickerDisabled: draftModelBaseOptions.length === 0,
    draftReasoningOptions,
    effectiveDraftReasoningEffort,
    showDraftReasoningSelect: draftReasoningOptions.length > 0,
  };
}
