// @ts-nocheck
import { useMemo } from "react";
import { agentModelOptionsKey } from "../../agents/facade";
import { useActiveConversationUpdateKey } from "../hooks/active-conversation-key";
import { useConfiguredHelms } from "../../helm-connection/utils/configured-helms";
import { resolveTechnicalPanelPreferences } from "../../preferences/utils/helpers";
import { formatResumeLabel } from "../utils/session-state";
import { usePromptImages } from "../hooks/prompt-images";
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
} from "../utils/composer-options";
import { resolveMissionHelms, resolveMissionSelectedProjectId, resolvePromptPlaceholder, resolveSessionProjectId } from "../utils/session-derivations";
import { DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT, IS_EMBEDDED_HELM_DECK } from "../../../shared/config/deck-runtime";

export function useMissionViewModel(ctx: any) {
  const source = { ...ctx.runtimeState, ...ctx.deckData, ...ctx.helmConnection, ...ctx };
  const {
    sessions,
    activeSessionId,
    activeSessionMessages,
    projects,
    selectedProjectId,
    selectedMissionHelmId,
    daemonHost,
    daemonPort,
    daemonProfiles,
    helms,
    worktrees,
    selectedCwd,
    agents,
    statuses,
    copy,
    locale,
    permissionRequests,
    approvalItemsById,
    pendingApprovalIdsBySession,
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
  addPromptImageFiles,
  removePromptImage,
} = usePromptImages({ activeSession });
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
const filteredWorktrees = useMemo(() => {
  if (!draftProject) {
    return [];
  }
  const projectWorktrees = draftProject.worktrees ?? [];
  if (projectWorktrees.length) {
    return projectWorktrees;
  }
  return worktrees.filter((worktree) =>
    normalizeWorktreePath(worktree.path) === normalizeWorktreePath(draftProject.path) ||
    Boolean(draftProject.path && normalizeWorktreePath(worktree.path)?.startsWith(`${normalizeWorktreePath(draftProject.path)}/`)),
  );
}, [draftProject, worktrees]);
const selectedWorktree =
  filteredWorktrees.find(
    (worktree) => normalizeWorktreePath(worktree.path) === normalizeWorktreePath(selectedCwd),
  ) ??
  filteredWorktrees[0] ??
  null;
const draftWorktreeOptions = filteredWorktrees;
const selectedWorktreeName = selectedWorktree?.name ?? "";

function normalizeWorktreePath(path: string | undefined) {
  return path?.replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
}
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
const pendingApprovals = useMemo(() => {
  if (!activeSession) return [];
  const ids = pendingApprovalIdsBySession[activeSession.id] ?? [];
  return ids
    .map((id) => approvalItemsById[id])
    .filter((item) => Boolean(item))
    .map((item) => ({ request: item.request, resolving: item.resolving }));
}, [activeSession, approvalItemsById, pendingApprovalIdsBySession]);
const selectedDraftAgent =
  filteredAgents.find((agent) => agent.id === selectedAgentId) ?? null;
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
  !activeSession && selectedAgentId && selectedCwd
    ? agentModelOptionsKey(selectedAgentId, selectedCwd, selectedProjectId)
    : null;
const draftAgentModelOptionsPrefix =
  selectedAgentId && selectedCwd
    ? `${selectedAgentId}::${selectedCwd}`
    : null;
const draftLoadingAgentModelOptions = draftAgentModelOptionsPrefix
  ? Object.entries(agentModelOptions).find(
      ([key, entry]) =>
        Boolean(entry?.loading) &&
        (key === draftAgentModelOptionsPrefix ||
          key.startsWith(`${draftAgentModelOptionsPrefix}::`)),
    )?.[1]
  : undefined;
const draftAgentModelOptions = draftAgentModelOptionsKey
  ? (agentModelOptions[draftAgentModelOptionsKey] ?? draftLoadingAgentModelOptions)
  : draftLoadingAgentModelOptions;
const draftConfigOptions = activeSession
  ? resolveDraftConfigOptions(
      activeSession,
      sessions,
      sessionConfigOptions,
      selectedAgentId,
    )
  : ((draftAgentModelOptions?.configOptions.length ?? 0) > 0
    ? draftAgentModelOptions?.configOptions
    : resolveDraftConfigOptions(
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
  ((draftAgentModelOptions?.modelOptions.length ?? 0) > 0
    ? draftAgentModelOptions?.modelOptions
    : cachedModelSession?.modelOptions) ??
  [];
const draftAgentModeOptions = resolveAgentModeOptions(draftConfigOptions);
const effectiveDraftAgentMode = resolveCurrentAgentMode(
  draftAgentMode,
  draftConfigOptions,
  draftAgentModelOptions?.state.agentMode,
);
const visibleDraftAgentModeOptions = draftAgentModeOptions;
const showDraftAgentModeSelect = visibleDraftAgentModeOptions.length > 0;
const draftAgentModePickerLabel = showDraftAgentModeSelect
  ? (visibleDraftAgentModeOptions.find(
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
const draftHasLoadedModelOptions =
  (draftAgentModelOptions?.modelOptions.length ?? 0) > 0 ||
  (draftAgentModelOptions?.configOptions.length ?? 0) > 0;
const awaitingDraftAgentModelOptions =
  !activeSession &&
  Boolean(selectedAgentId && selectedCwd) &&
  !draftAgentModelOptions &&
  !draftHasLoadedModelOptions;
const draftModelPickerLabel = draftModelBaseOptions.length
  ? effectiveDraftModelBase
  : draftAgentModelOptions?.loading || awaitingDraftAgentModelOptions
    ? "加载模型..."
    : "暂无模型列表";
const draftModelLoading = Boolean(
  draftAgentModelOptions?.loading || awaitingDraftAgentModelOptions,
);
const draftModelPickerDisabled =
  draftModelBaseOptions.length === 0 && !draftAgentModelOptions?.loading;
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
    addPromptImageFiles,
    removePromptImage,
    activeSessionMessages,
    activeConversationUpdateKey,
    draftProject,
    configuredHelms,
    activeHelm,
    effectiveMissionHelmId,
    missionHelms,
    missionProjects,
    filteredWorktrees,
    selectedWorktree,
    draftWorktreeOptions,
    selectedWorktreeName,
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
    pendingApprovals,
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
    draftAgentModeOptions: visibleDraftAgentModeOptions,
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
    draftModelLoading,
    draftModelPickerDisabled,
    draftReasoningOptions,
    effectiveDraftReasoningEffort,
    showDraftReasoningSelect,
  };
}
