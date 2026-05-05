// @ts-nocheck
import { useEffect } from "react";
import { readTrustedDeviceCache } from "../features/auth/beacon-cache";
import { useReconnectEffects } from "../features/helm-connection/hooks/use-reconnect-effects";
import { nextRequestId } from "../features/helm-connection/request-dispatch";
import { usePromptAutosize } from "../features/mission/hooks/use-prompt-autosize";
import { useSnapshotCache } from "../features/mission/hooks/use-snapshot-cache";
import { agentModelOptionsKey } from "../features/agents/utils/agent-model-options-cache";
import { resolveModelOptions, resolvePreferredModel, defaultAgentId } from "../features/mission/utils/composer-options";
import { projectFilesKey } from "../features/mission/utils/project-files-key";
import { resolveDraftSelectionId, resolveProjectFilesScope, resolveSessionProjectId } from "../features/mission/utils/session-derivations";
import { DEFAULT_ACTIVITY_PAGE_LIMIT, DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT, DEFAULT_MESSAGE_PAGE_LIMIT, IS_EMBEDDED_HELM_DECK } from "./app-constants";

export function useMissionEffects(ctx: any) {
  const source = { ...ctx.runtimeState, ...ctx.deckData, ...ctx.missionView, ...ctx.helmConnection, ...ctx.controllers, ...ctx.history, ...ctx };
  const {
    worktreePickerOpen,
    agentPickerOpen,
    worktreePickerRef,
    agentPickerRef,
    setWorktreePickerOpen,
    setAgentPickerOpen,
    selectedMissionHelmId,
    activeSession,
    draftProject,
    projects,
    helms,
    setSelectedMissionHelmId,
    selectedProjectId,
    missionProjects,
    setSelectedProjectId,
    requestChatScrollToBottom,
    setActiveSessionId,
    effectiveMissionHelmId,
    setExpandedMissionHelmIds,
    selectedWorkspaceId,
    filteredWorkspaces,
    setSelectedWorkspaceId,
    pairingState,
    socketRef,
    setWorktreeGitByProject,
    dispatch,
    requestCounter,
    lastFilesScopeKeyRef,
    setProjectFilesByScope,
    selectedAgentId,
    filteredAgents,
    setSelectedAgentId,
    agentModelOptions,
    selectedModel,
    setSelectedModel,
    setSelectedAgentMode,
    setSelectedReasoningEffort,
    activeView,
    chatMainRef,
    preserveChatScrollRef,
    activeSessionId,
    stickChatToBottomRef,
    pendingSessionScrollToBottomRef,
    lastAutoScrollSessionIdRef,
    activeSessionMessages,
    activeConversationUpdateKey,
    messageHistoryState,
    sessionOpenScrollTick,
    setMessageHistoryState,
    setActivityHistoryState,
    missionPromptRef,
    imagePasteNotice,
    prompt,
    promptImages,
    fleetAddHelmModalOpen,
    fleetAddHelmStage,
    connection,
    setFleetAddHelmStage,
    fleetProjectSaveMessage,
    setFleetProjectSaveMessage,
    setTrustedDevice,
    setTrustedDevices,
    daemonHost,
    daemonPort,
    activeProfileId,
    missionVisualMode,
    sessions,
    workspaces,
    agents,
    setProjects,
    setSessions,
    setWorkspaces,
    setAgents,
    setStatuses,
    trustedDevice,
    autoConnectAttemptRef,
    manualDisconnectRef,
    connectToDaemon,
  } = source;
useEffect(() => {
  if (!worktreePickerOpen && !agentPickerOpen) {
    return;
  }
  function closeDraftPickersFromPointer(event: MouseEvent) {
    const target = event.target as Node | null;
    if (
      target &&
      (worktreePickerRef.current?.contains(target) ||
        agentPickerRef.current?.contains(target))
    ) {
      return;
    }
    setWorktreePickerOpen(false);
    setAgentPickerOpen(false);
  }
  function closeDraftPickersFromKeyboard(event: KeyboardEvent) {
    if (event.key !== "Escape") {
      return;
    }
    setWorktreePickerOpen(false);
    setAgentPickerOpen(false);
  }
  document.addEventListener("mousedown", closeDraftPickersFromPointer);
  document.addEventListener("keydown", closeDraftPickersFromKeyboard);
  return () => {
    document.removeEventListener("mousedown", closeDraftPickersFromPointer);
    document.removeEventListener("keydown", closeDraftPickersFromKeyboard);
  };
}, [agentPickerOpen, worktreePickerOpen]);
useEffect(() => {
  if (
    !selectedMissionHelmId &&
    (activeSession?.helmId ||
      draftProject?.helmId ||
      projects[0]?.helmId ||
      helms[0]?.id)
  ) {
    setSelectedMissionHelmId(
      activeSession?.helmId ??
        draftProject?.helmId ??
        projects[0]?.helmId ??
        helms[0]?.id ??
        null,
    );
  }
}, [
  activeSession?.helmId,
  draftProject?.helmId,
  helms,
  projects,
  selectedMissionHelmId,
]);
useEffect(() => {
  if (!selectedProjectId && missionProjects.length) {
    const nextProject = missionProjects[0];
    if (!nextProject) {
      return;
    }
    setSelectedProjectId(nextProject.id);
    requestChatScrollToBottom(null);
    setActiveSessionId(null);
  }
}, [missionProjects, selectedProjectId]);
useEffect(() => {
  if (effectiveMissionHelmId) {
    setExpandedMissionHelmIds((current) =>
      current.has(effectiveMissionHelmId)
        ? current
        : new Set([...current, effectiveMissionHelmId]),
    );
  }
}, [effectiveMissionHelmId]);
useEffect(() => {
  if (!draftProject) {
    return;
  }
  const defaultWorkspaceId = draftProject.defaultWorkspaceId;
  const nextWorkspaceId = resolveDraftSelectionId(
    selectedWorkspaceId,
    filteredWorkspaces,
    defaultWorkspaceId,
  );
  if (nextWorkspaceId && nextWorkspaceId !== selectedWorkspaceId) {
    setSelectedWorkspaceId(nextWorkspaceId);
  }
}, [draftProject, filteredWorkspaces, selectedWorkspaceId]);
useEffect(() => {
  if (
    !selectedProjectId ||
    pairingState !== "paired" ||
    !socketRef.current ||
    socketRef.current.readyState !== WebSocket.OPEN
  ) {
    return;
  }
  setWorktreeGitByProject((current) => ({
    ...current,
    [selectedProjectId]: {
      ...(current[selectedProjectId] ?? { branches: [] }),
      loading: true,
      message: "正在加载 worktree...",
    },
  }));
  dispatch(socketRef.current, {
    type: "workspace.git.list",
    requestId: nextRequestId(requestCounter),
    projectId: selectedProjectId,
  });
}, [pairingState, selectedProjectId]);
useEffect(() => {
  const scope = resolveProjectFilesScope({
    activeSession,
    activeSessionProjectId: activeSession
      ? resolveSessionProjectId(activeSession, projects)
      : null,
  });
  if (
    !scope.projectId ||
    !scope.workspaceId ||
    pairingState !== "paired" ||
    !socketRef.current ||
    socketRef.current.readyState !== WebSocket.OPEN
  ) {
    return;
  }
  const key = projectFilesKey(scope.projectId, scope.workspaceId);
  if (lastFilesScopeKeyRef.current === key) {
    // 同一 project+workspace,只是切换会话 — 复用现有文件列表,避免 loading 闪烁与重复请求。
    return;
  }
  lastFilesScopeKeyRef.current = key;
  setProjectFilesByScope((current) => ({
    ...current,
    [key]: {
      loading: true,
      files: current[key]?.files ?? [],
      message: "正在加载项目文件...",
    },
  }));
  dispatch(socketRef.current, {
    type: "project.files.list",
    requestId: nextRequestId(requestCounter),
    projectId: scope.projectId,
    workspaceId: scope.workspaceId,
  });
}, [
  activeSession?.id,
  activeSession?.projectId,
  activeSession?.workspaceId,
  pairingState,
  projects,
]);
useEffect(() => {
  if (!draftProject) {
    return;
  }
  const defaultProjectAgentId = draftProject.defaultAgentId;
  const fallbackAgentId = resolveDraftSelectionId(
    selectedAgentId,
    filteredAgents,
    defaultProjectAgentId ?? defaultAgentId(filteredAgents),
  );
  if (fallbackAgentId && fallbackAgentId !== selectedAgentId) {
    setSelectedAgentId(fallbackAgentId);
  }
}, [draftProject, filteredAgents, selectedAgentId]);
useEffect(() => {
  if (
    activeSession ||
    pairingState !== "paired" ||
    !selectedAgentId ||
    !selectedWorkspaceId ||
    !socketRef.current ||
    socketRef.current.readyState !== WebSocket.OPEN
  ) {
    return;
  }
  const key = agentModelOptionsKey(selectedAgentId, selectedWorkspaceId);
  const cached = agentModelOptions[key];
  if (cached && !cached.loading) {
    const realOptions = resolveModelOptions(
      cached.state.model,
      cached.configOptions,
      cached.modelOptions,
    );
    const allOptions = Array.from(
      new Set([
        ...realOptions,
        ...cached.modelOptions.map((option) => option.id),
      ]),
    );
    const nextModel = resolvePreferredModel(cached.state.model, allOptions);
    if (
      nextModel &&
      (!selectedModel ||
        selectedModel === "provider-default" ||
        !allOptions.includes(selectedModel))
    ) {
      setSelectedModel(nextModel);
    }
    if (cached.state.agentMode) {
      setSelectedAgentMode(cached.state.agentMode);
    }
    if (cached.state.reasoningEffort) {
      setSelectedReasoningEffort(cached.state.reasoningEffort);
    }
    return;
  }
  if (cached?.loading) {
    return;
  }
  setAgentModelOptions((current) => ({
    ...current,
    [key]: {
      loading: true,
      modelOptions: [],
      configOptions: [],
      state: {},
      message: "正在加载模型列表...",
    },
  }));
  dispatch(socketRef.current, {
    type: "agent.model.options.get",
    requestId: nextRequestId(requestCounter),
    providerId: selectedAgentId,
    workspaceId: selectedWorkspaceId,
    projectId: selectedProjectId ?? undefined,
  });
}, [
  agentModelOptions,
  pairingState,
  selectedAgentId,
  selectedModel,
  selectedProjectId,
  selectedWorkspaceId,
]);
useEffect(() => {
  if (activeView !== "sessions") {
    return;
  }
  const chatMain = chatMainRef.current;
  if (!chatMain) {
    return;
  }
  requestAnimationFrame(() => {
    const preserve = preserveChatScrollRef.current;
    if (preserve) {
      chatMain.scrollTop =
        chatMain.scrollHeight - preserve.scrollHeight + preserve.scrollTop;
      preserveChatScrollRef.current = null;
      return;
    }
    const sessionChanged =
      lastAutoScrollSessionIdRef.current !== activeSessionId;
    const shouldForceSessionBottom = Boolean(
      activeSessionId &&
        pendingSessionScrollToBottomRef.current === activeSessionId,
    );
    lastAutoScrollSessionIdRef.current = activeSessionId;
    if (
      !sessionChanged &&
      !shouldForceSessionBottom &&
      !stickChatToBottomRef.current
    ) {
      return;
    }
    chatMain.scrollTop = chatMain.scrollHeight;
    requestAnimationFrame(() => {
      chatMain.scrollTop = chatMain.scrollHeight;
    });
    if (
      shouldForceSessionBottom &&
      activeSessionId &&
      activeSessionMessages.length > 0 &&
      !messageHistoryState[activeSessionId]?.loading
    ) {
      pendingSessionScrollToBottomRef.current = null;
    }
  });
}, [
  activeConversationUpdateKey,
  activeView,
  activeSessionId,
  activeSessionMessages.length,
  messageHistoryState,
  sessionOpenScrollTick,
]);
useEffect(() => {
  if (
    !activeSessionId ||
    pairingState !== "paired" ||
    !socketRef.current ||
    socketRef.current.readyState !== WebSocket.OPEN
  ) {
    return;
  }
  setMessageHistoryState((current) => ({
    ...current,
    [activeSessionId]: { hasMore: false, loading: true },
  }));
  setActivityHistoryState((current) => ({
    ...current,
    [activeSessionId]: { hasMore: false, loading: true },
  }));
  dispatch(socketRef.current, {
    type: "session.messages.list",
    requestId: nextRequestId(requestCounter),
    sessionId: activeSessionId,
    limit: DEFAULT_MESSAGE_PAGE_LIMIT,
  });
  dispatch(socketRef.current, {
    type: "session.artifacts.get",
    requestId: nextRequestId(requestCounter),
    sessionId: activeSessionId,
    limit: DEFAULT_ACTIVITY_PAGE_LIMIT,
  });
  dispatch(socketRef.current, {
    type: "session.resume.check",
    requestId: nextRequestId(requestCounter),
    sessionId: activeSessionId,
  });
}, [activeSessionId, pairingState]);
usePromptAutosize({
  activeView,
  activeSessionId,
  imagePasteNotice,
  prompt,
  promptImageCount: promptImages.length,
  promptRef: missionPromptRef,
});
useEffect(() => {
  if (
    fleetAddHelmModalOpen &&
    fleetAddHelmStage === "connecting" &&
    connection === "connected"
  ) {
    setFleetAddHelmStage("pair");
  }
}, [connection, fleetAddHelmModalOpen, fleetAddHelmStage]);
useEffect(() => {
  if (
    !fleetProjectSaveMessage ||
    fleetProjectSaveMessage.startsWith("正在")
  ) {
    return;
  }
  const timer = window.setTimeout(() => setFleetProjectSaveMessage(""), 3600);
  return () => window.clearTimeout(timer);
}, [fleetProjectSaveMessage]);
useEffect(() => {
  setTrustedDevice(
    readTrustedDeviceCache(
      window.localStorage,
      daemonHost.trim() || DEFAULT_DAEMON_HOST,
      daemonPort.trim() || DEFAULT_DAEMON_PORT,
    ),
  );
  setTrustedDevices([]);
}, [daemonHost, daemonPort]);
useSnapshotCache({
  activeProfileId,
  missionVisualMode,
  pairingState,
  projects,
  sessions,
  workspaces,
  agents,
  setProjects,
  setSessions,
  setWorkspaces,
  setAgents,
  setStatuses,
  setSelectedProjectId,
});
useReconnectEffects({
  activeProfileId,
  activeView,
  connection,
  daemonHost,
  daemonPort,
  embedded: IS_EMBEDDED_HELM_DECK,
  missionVisualMode,
  tokenPresent: Boolean(trustedDevice?.token),
  autoConnectAttemptRef,
  manualDisconnectRef,
  connectToDaemon,
});
}
