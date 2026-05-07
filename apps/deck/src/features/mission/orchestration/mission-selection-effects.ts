// @ts-nocheck
import { useEffect } from "react";
import { agentModelOptionsKey } from "../../agents/facade";
import { resolveModelOptions, resolvePreferredModel, defaultAgentId } from "../utils/composer-options";
import { projectFilesKey } from "../utils/project-files-key";
import { resolveDraftSelectionId, resolveProjectFilesScope, resolveSessionProjectId } from "../utils/session-derivations";

export function useMissionSelectionEffects(source: any) {
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
    rpcClientRef,
    setWorktreeGitByProject,
    dispatch,
    lastFilesScopeKeyRef,
    setProjectFilesByScope,
    selectedAgentId,
    filteredAgents,
    setSelectedAgentId,
    agentModelOptions,
    setAgentModelOptions,
    selectedModel,
    setSelectedModel,
    setSelectedAgentMode,
    setSelectedReasoningEffort,
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
      !rpcClientRef.current ||
      rpcClientRef.current.socket.readyState !== WebSocket.OPEN
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
    void dispatch(rpcClientRef.current, "workspace/git/list_branches", {
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
      !rpcClientRef.current ||
      rpcClientRef.current.socket.readyState !== WebSocket.OPEN
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
    void dispatch(rpcClientRef.current, "project/list_files", {
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
      !rpcClientRef.current ||
      rpcClientRef.current.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const key = agentModelOptionsKey(selectedAgentId, selectedWorkspaceId, selectedProjectId);
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
        projectId: selectedProjectId,
        modelOptions: cached?.modelOptions ?? [],
        configOptions: cached?.configOptions ?? [],
        state: cached?.state ?? {},
        message: "正在加载模型列表...",
      },
    }));
    void dispatch(rpcClientRef.current, "agent/get_model_options", {
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
}
