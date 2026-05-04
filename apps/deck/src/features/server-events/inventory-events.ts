export function handleInventoryServerEvent(
  payload: { type: string; [key: string]: any },
  sourceHelmKey: string,
  sourceIsCurrentHelm: boolean,
  context: any,
) {
  const {
    setHelms,
    updateHelmInventory,
    setProjects,
    projectFilesKey,
    setProjectFilesByScope,
    setWorkspaces,
    setWorktreeGitByProject,
    setSelectedWorkspaceId,
    setWorktreePickerOpen,
    setAgents,
    setAgentTestResult,
    agentModelOptionsKey,
    setAgentModelOptions,
    writeAgentModelOptionsCache,
    selectedAgentId,
    selectedWorkspaceId,
    resolveModelOptions,
    resolvePreferredModel,
    selectedModel,
    setSelectedModel,
    setSelectedAgentMode,
    setSelectedReasoningEffort,
    setConfigSaveMessage,
    setFleetProjectSaveMessage,
    setSelectedProjectId,
    socketRef,
    helmSocketRefs,
    dispatch,
    nextRequestId,
    requestCounter,
  } = context;

  switch (payload.type) {
    case "helm.list.result":
      setHelms(payload.helms);
      return true;
    case "project.list.result":
      updateHelmInventory(sourceHelmKey, { projects: payload.projects });
      if (sourceIsCurrentHelm) {
        setProjects(payload.projects);
      }
      return true;
    case "project.files.result": {
      const key = projectFilesKey(payload.projectId, payload.workspaceId);
      setProjectFilesByScope((current: any) => ({
        ...current,
        [key]: {
          loading: false,
          files: payload.files,
          message: payload.message,
        },
      }));
      return true;
    }
    case "workspace.list.result":
      updateHelmInventory(sourceHelmKey, { workspaces: payload.workspaces });
      if (sourceIsCurrentHelm) {
        setWorkspaces(payload.workspaces);
      }
      return true;
    case "workspace.git.result":
      setWorktreeGitByProject((current: any) => ({
        ...current,
        [payload.projectId]: {
          branches: payload.branches,
          currentBranch: payload.currentBranch,
          message: payload.message,
          loading: false,
        },
      }));
      if (sourceIsCurrentHelm && payload.workspaces.length) {
        setWorkspaces((current: any[]) => {
          const nextById = new Map(
            current.map((workspace) => [workspace.id, workspace]),
          );
          payload.workspaces.forEach((workspace: any) =>
            nextById.set(workspace.id, workspace),
          );
          return Array.from(nextById.values());
        });
      }
      if (payload.selectedWorkspaceId) {
        setSelectedWorkspaceId(payload.selectedWorkspaceId);
        setWorktreePickerOpen(false);
      }
      return true;
    case "agent.list.result":
      updateHelmInventory(sourceHelmKey, { agents: payload.agents });
      if (sourceIsCurrentHelm) {
        setAgents(payload.agents);
      }
      return true;
    case "agent.test.result":
      setAgentTestResult(payload.message);
      return true;
    case "agent.model.options.result": {
      const key = agentModelOptionsKey(payload.providerId, payload.workspaceId);
      const nextEntry = {
        loading: false,
        message: payload.message,
        modelOptions: payload.modelOptions,
        configOptions: payload.configOptions,
        state: payload.state,
      };
      setAgentModelOptions((current: any) => {
        const next = { ...current, [key]: nextEntry };
        writeAgentModelOptionsCache(next);
        return next;
      });
      if (
        sourceIsCurrentHelm &&
        payload.providerId === selectedAgentId &&
        payload.workspaceId === selectedWorkspaceId
      ) {
        const realOptions = resolveModelOptions(
          payload.currentModelId ?? payload.state.model,
          payload.configOptions,
          payload.modelOptions,
        );
        const allOptions = Array.from(
          new Set([
            ...realOptions,
            ...payload.modelOptions.map((option: any) => option.id),
          ]),
        );
        const nextModel = resolvePreferredModel(
          payload.currentModelId ?? payload.state.model,
          allOptions,
        );
        if (
          nextModel &&
          (!selectedModel ||
            selectedModel === "provider-default" ||
            !allOptions.includes(selectedModel))
        ) {
          setSelectedModel(nextModel);
        }
        if (payload.state.agentMode) {
          setSelectedAgentMode(payload.state.agentMode);
        }
        if (payload.state.reasoningEffort) {
          setSelectedReasoningEffort(payload.state.reasoningEffort);
        }
      }
      return true;
    }
    case "project.save.result":
      setConfigSaveMessage(payload.message);
      setFleetProjectSaveMessage(payload.message);
      if (sourceIsCurrentHelm) {
        setSelectedProjectId(payload.projectId);
      }
      return true;
    case "agent.save.result": {
      setConfigSaveMessage(payload.message);
      const refreshSocket = sourceIsCurrentHelm
        ? socketRef.current
        : (helmSocketRefs.current.get(sourceHelmKey) ?? null);
      if (refreshSocket?.readyState === WebSocket.OPEN) {
        dispatch(refreshSocket, {
          type: "agent.list",
          requestId: nextRequestId(requestCounter),
        });
        dispatch(refreshSocket, {
          type: "project.list",
          requestId: nextRequestId(requestCounter),
        });
      }
      return true;
    }
    default:
      return false;
  }
}
