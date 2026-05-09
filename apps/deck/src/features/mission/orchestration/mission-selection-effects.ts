// @ts-nocheck
import { useEffect } from "react";
import { agentModelOptionsKey } from "../../agents/facade";
import { resolveModelOptions, resolvePreferredModel } from "../utils/composer-options";
import { resolveDraftSelectionId } from "../utils/session-derivations";

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
    selectedAgentId,
    filteredAgents,
    setSelectedAgentId,
    agentModelOptions,
    setAgentModelOptions,
    selectedModel,
    setSelectedModel,
    setSelectedAgentMode,
    setSelectedReasoningEffort,
    effectiveDraftAgentMode,
    selectedReasoningEffort,
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
    if (!draftProject || !selectedAgentId) {
      return;
    }
    const selectedAgentAvailable = filteredAgents.some(
      (agent) => agent.id === selectedAgentId,
    );
    if (!selectedAgentAvailable) {
      setSelectedAgentId(null);
    }
  }, [draftProject, filteredAgents, selectedAgentId]);
  useEffect(() => {
    if (
      activeSession ||
      pairingState !== "paired" ||
      !selectedProjectId ||
      !selectedAgentId ||
      !selectedWorkspaceId ||
      !rpcClientRef.current ||
      rpcClientRef.current.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const key = agentModelOptionsKey(selectedAgentId, selectedWorkspaceId, selectedProjectId);
    const cached = agentModelOptions[key];
    if (cached && !cached.loading && cached.warmed) {
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
        warmed: false,
        projectId: selectedProjectId,
        modelOptions: cached?.modelOptions ?? [],
        configOptions: cached?.configOptions ?? [],
        state: cached?.state ?? {},
        message: "正在预热 ACP...",
      },
    }));
    void dispatch(rpcClientRef.current, "session/prewarm", {
      projectId: selectedProjectId,
      workspaceId: selectedWorkspaceId,
      agentId: selectedAgentId,
      agentMode: effectiveDraftAgentMode,
      model: selectedModel === "provider-default" ? undefined : selectedModel,
      reasoningEffort: selectedReasoningEffort,
    });
  }, [
    agentModelOptions,
    pairingState,
    selectedAgentId,
    selectedModel,
    selectedProjectId,
    selectedWorkspaceId,
    effectiveDraftAgentMode,
    selectedReasoningEffort,
  ]);
}
