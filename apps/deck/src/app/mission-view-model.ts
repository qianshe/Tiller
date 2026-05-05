// @ts-nocheck
import { useMemo } from "react";
import { agentModelOptionsKey } from "../features/agents/utils/agent-model-options-cache";
import { useActiveConversationUpdateKey } from "./active-conversation-key";
import { useConfiguredHelms } from "./configured-helms";
import { resolveTechnicalPanelPreferences } from "../features/preferences/utils/helpers";
import { formatResumeLabel } from "../features/mission/utils/session-state";
import { usePromptImages } from "../features/mission/hooks/prompt-images";
import {
  MODEL_OPTIONS,
  defaultAgentId,
  resolveAgentModeOptions,
  resolveBaseModelOptions,
  resolveCurrentAgentMode,
  resolveDraftConfigOptions,
  resolveModelInputPlaceholder,
  resolveModelOptions,
  resolveReasoningOptionsForModel,
  resolveSessionConfigHint,
  splitModelReasoning,
} from "../features/mission/utils/composer-options";
import { resolveMissionHelms, resolveMissionSelectedProjectId, resolvePromptPlaceholder, resolveSessionProjectId } from "../features/mission/utils/session-derivations";
import { DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT, IS_EMBEDDED_HELM_DECK } from "./constants";

export function useMissionViewModel(ctx: any) {
  const source = { ...ctx.runtimeState, ...ctx.deckData, ...ctx.helmConnection, ...ctx };
  const {
    sessions,
    activeSessionId,
    messages,
    projects,
    selectedProjectId,
    selectedMissionHelmId,
    daemonHost,
    daemonPort,
    daemonProfiles,
    helms,
    workspaces,
    selectedWorkspaceId,
    agents,
    statuses,
    copy,
    locale,
    permissionRequests,
    selectedAgentId,
    selectedAgentMode,
    selectedModel,
    selectedReasoningEffort,
    agentModelOptions,
    sessionConfigOptions,
    deckPreferences,
  } = source;
const activeSession = useMemo(
  () => sessions.find((session) => session.id === activeSessionId) ?? null,
  [activeSessionId, sessions],
);
const {
  promptImages,
  setPromptImages,
  imagePasteNotice,
  setImagePasteNotice,
  handlePromptPaste: handleMissionPromptPaste,
  removePromptImage,
} = usePromptImages({ activeSession });
const activeSessionMessages = activeSession
  ? (messages[activeSession.id] ?? [])
  : [];
const activeConversationUpdateKey = useActiveConversationUpdateKey(
  activeSessionId,
  activeSessionMessages,
);
const draftProject = useMemo(
  () => projects.find((project) => project.id === selectedProjectId) ?? null,
  [projects, selectedProjectId],
);
const configuredHelms = useConfiguredHelms({
  daemonHost,
  daemonPort,
  defaultDaemonHost: DEFAULT_DAEMON_HOST,
  defaultDaemonPort: DEFAULT_DAEMON_PORT,
  daemonProfiles,
  helms,
  embedded: IS_EMBEDDED_HELM_DECK,
});
const activeHelm = useMemo(() => {
  const helmId = activeSession?.helmId ?? draftProject?.helmId;
  return configuredHelms.find((helm) => helm.id === helmId) ?? null;
}, [activeSession?.helmId, configuredHelms, draftProject?.helmId]);
const effectiveMissionHelmId =
  selectedMissionHelmId ??
  activeSession?.helmId ??
  draftProject?.helmId ??
  projects[0]?.helmId ??
  configuredHelms[0]?.id ??
  null;
const missionHelms = useMemo(
  () =>
    resolveMissionHelms(configuredHelms, effectiveMissionHelmId, activeHelm),
  [activeHelm, configuredHelms, effectiveMissionHelmId],
);
const missionProjects = useMemo(
  () =>
    projects.filter(
      (project) =>
        !effectiveMissionHelmId || project.helmId === effectiveMissionHelmId,
    ),
  [effectiveMissionHelmId, projects],
);
const filteredWorkspaces = useMemo(() => {
  const workspaceIds = draftProject?.workspaceIds;
  if (!workspaceIds?.length) {
    return workspaces;
  }
  return workspaces.filter((workspace) =>
    workspaceIds.includes(workspace.id),
  );
}, [draftProject?.workspaceIds, workspaces]);
const selectedWorkspace =
  filteredWorkspaces.find(
    (workspace) => workspace.id === selectedWorkspaceId,
  ) ??
  filteredWorkspaces[0] ??
  null;
const draftWorkspaceOptions = filteredWorkspaces;
const selectedWorkspaceName = selectedWorkspace?.name ?? "";
const filteredAgents = agents;
const projectSessions = useMemo(
  () =>
    sessions.filter(
      (session) =>
        !selectedProjectId ||
        resolveSessionProjectId(session, projects) === selectedProjectId,
    ),
  [projects, selectedProjectId, sessions],
);
const sessionCountsByProject = useMemo(
  () =>
    sessions.reduce<Record<string, number>>((counts, session) => {
      const projectId = resolveSessionProjectId(session, projects);
      return { ...counts, [projectId]: (counts[projectId] ?? 0) + 1 };
    }, {}),
  [projects, sessions],
);
const activeSessionProjectId = activeSession
  ? resolveSessionProjectId(activeSession, projects)
  : null;
const missionSelectedProjectId = resolveMissionSelectedProjectId({
  activeSessionProjectId,
  selectedProjectId,
});
const activeSessionProject = activeSessionProjectId
  ? (projects.find((project) => project.id === activeSessionProjectId) ??
    null)
  : null;
const activeStatus = activeSession
  ? copy.status[statuses[activeSession.id] ?? activeSession.status]
  : copy.status.idle;
const activeResumeLabel = formatResumeLabel(activeSession?.resume, locale);
const technicalPanels = resolveTechnicalPanelPreferences(deckPreferences);
const pendingPermission = activeSession
  ? (permissionRequests[activeSession.id] ?? null)
  : null;
const selectedDraftAgent =
  filteredAgents.find((agent) => agent.id === selectedAgentId) ??
  filteredAgents[0] ??
  null;
const draftAgent =
  agents.find(
    (agent) => agent.id === (activeSession?.agentId ?? selectedAgentId),
  ) ?? null;
const draftAgentMode = activeSession
  ? (activeSession.agentMode ?? "")
  : selectedAgentMode;
const draftModel = activeSession
  ? (activeSession.model ?? MODEL_OPTIONS[0])
  : selectedModel;
const draftReasoningEffort = activeSession
  ? (activeSession.reasoningEffort ?? "medium")
  : selectedReasoningEffort;
const draftPromptPlaceholder = resolvePromptPlaceholder(draftAgent);
const draftConfigHint = resolveSessionConfigHint(
  activeSession,
  agents,
  activeSession?.agentId ?? selectedAgentId,
);
const draftModelPlaceholder = resolveModelInputPlaceholder(
  activeSession,
  agents,
  activeSession?.agentId ?? selectedAgentId,
);
const draftAgentModelOptionsKey =
  !activeSession && selectedAgentId && selectedWorkspaceId
    ? agentModelOptionsKey(selectedAgentId, selectedWorkspaceId)
    : null;
const draftAgentModelOptions = draftAgentModelOptionsKey
  ? agentModelOptions[draftAgentModelOptionsKey]
  : undefined;
const draftConfigOptions = activeSession
  ? resolveDraftConfigOptions(
      activeSession,
      sessions,
      sessionConfigOptions,
      selectedAgentId,
    )
  : (draftAgentModelOptions?.configOptions ??
    resolveDraftConfigOptions(
      activeSession,
      sessions,
      sessionConfigOptions,
      selectedAgentId,
    ));
const cachedModelSession = activeSession
  ? null
  : sessions.find(
      (session) =>
        session.agentId === selectedAgentId &&
        (session.modelOptions?.length ?? 0) > 0,
    );
const draftNativeModelOptions =
  activeSession?.modelOptions ??
  draftAgentModelOptions?.modelOptions ??
  cachedModelSession?.modelOptions ??
  [];
const draftAgentModeOptions = resolveAgentModeOptions(draftConfigOptions);
const effectiveDraftAgentMode = resolveCurrentAgentMode(
  draftAgentMode,
  draftConfigOptions,
  draftAgentModelOptions?.state.agentMode,
);
const showDraftAgentModeSelect = draftAgentModeOptions.length > 0;
const draftAgentModePickerLabel = showDraftAgentModeSelect
  ? (draftAgentModeOptions.find(
      (option) => option.value === effectiveDraftAgentMode,
    )?.label ??
    effectiveDraftAgentMode ??
    "选择 Agent")
  : draftAgentModelOptions?.loading
    ? "加载 Agents..."
    : "暂无 Agent 列表";
const draftModelOptions = resolveModelOptions(
  draftModel,
  draftConfigOptions,
  draftNativeModelOptions,
);
const draftAllModelOptions = Array.from(
  new Set([
    ...draftModelOptions,
    ...draftNativeModelOptions.map((option) => option.id),
  ]),
);
const draftModelParts = splitModelReasoning(draftModel);
const draftModelBase = draftModelParts.model || draftModel;
const draftModelBaseOptions = resolveBaseModelOptions(draftModelOptions);
const draftModelBaseValid = draftModelBaseOptions.includes(draftModelBase);
const effectiveDraftModelBase = draftModelBaseValid
  ? draftModelBase
  : (draftModelBaseOptions[0] ?? draftModelBase);
const draftModelPickerLabel = draftModelBaseOptions.length
  ? effectiveDraftModelBase
  : draftAgentModelOptions?.loading
    ? "加载模型..."
    : "暂无模型列表";
const draftModelPickerDisabled = draftModelBaseOptions.length === 0;
const draftReasoningOptions = resolveReasoningOptionsForModel(
  effectiveDraftModelBase,
  draftAllModelOptions,
  draftConfigOptions,
);
const effectiveDraftReasoningEffort =
  draftModelParts.reasoning ?? draftReasoningEffort;
const showDraftReasoningSelect = draftReasoningOptions.length > 0;
  return {
    activeSession,
    promptImages,
    setPromptImages,
    imagePasteNotice,
    setImagePasteNotice,
    handleMissionPromptPaste,
    removePromptImage,
    activeSessionMessages,
    activeConversationUpdateKey,
    draftProject,
    configuredHelms,
    activeHelm,
    effectiveMissionHelmId,
    missionHelms,
    missionProjects,
    filteredWorkspaces,
    selectedWorkspace,
    draftWorkspaceOptions,
    selectedWorkspaceName,
    filteredAgents,
    projectSessions,
    sessionCountsByProject,
    activeSessionProjectId,
    missionSelectedProjectId,
    activeSessionProject,
    activeStatus,
    activeResumeLabel,
    technicalPanels,
    pendingPermission,
    selectedDraftAgent,
    draftAgent,
    draftAgentMode,
    draftModel,
    draftReasoningEffort,
    draftPromptPlaceholder,
    draftConfigHint,
    draftModelPlaceholder,
    draftAgentModelOptionsKey,
    draftAgentModelOptions,
    draftConfigOptions,
    cachedModelSession,
    draftNativeModelOptions,
    draftAgentModeOptions,
    effectiveDraftAgentMode,
    showDraftAgentModeSelect,
    draftAgentModePickerLabel,
    draftModelOptions,
    draftAllModelOptions,
    draftModelParts,
    draftModelBase,
    draftModelBaseOptions,
    draftModelBaseValid,
    effectiveDraftModelBase,
    draftModelPickerLabel,
    draftModelPickerDisabled,
    draftReasoningOptions,
    effectiveDraftReasoningEffort,
    showDraftReasoningSelect,
  };
}
