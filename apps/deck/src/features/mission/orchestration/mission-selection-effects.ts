// @ts-nocheck
import { useEffect } from "react";
import { agentModelOptionsKey } from "../../agents/facade";
import { resolveModelOptions, resolvePreferredModel } from "../utils/composer-options";
import { getDeckClientId } from "../utils/deck-client-id";
import {
  resolveDefaultMissionSessionId,
  resolveDraftSelectionId,
  resolveSessionProjectId,
} from "../utils/session-derivations";

function normalizeWorktreePath(path: string | undefined) {
  return path?.replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
}

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
    activeSessionId,
    sessions,
    statuses,
    draftProject,
    projects,
    helms,
    setSelectedMissionHelmId,
    selectedProjectId,
    setSelectedProjectId,
    requestChatScrollToBottom,
    setActiveSessionId,
    effectiveMissionHelmId,
    setExpandedMissionHelmIds,
    selectedCwd,
    filteredWorktrees,
    setSelectedCwd,
    pairingState,
    rpcClientRef,
    setWorktreeGitByProject,
    dispatch,
    selectedAgentId,
    filteredAgents,
    setSelectedAgentId,
    agentModelOptions,
    setAgentModelOptions,
    agentConnectionInventory,
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
    if (activeSession || selectedProjectId) {
      return;
    }
    const nextActiveSessionId = resolveDefaultMissionSessionId(
      activeSessionId,
      sessions,
      statuses,
    );
    if (!nextActiveSessionId) {
      return;
    }
    const nextSession = sessions.find((session) => session.id === nextActiveSessionId);
    if (!nextSession) {
      return;
    }
    const nextProjectId = resolveSessionProjectId(nextSession, projects);
    setSelectedProjectId(nextProjectId);
    requestChatScrollToBottom(nextActiveSessionId);
    setActiveSessionId(nextActiveSessionId);
  }, [activeSession, activeSessionId, projects, selectedProjectId, sessions, statuses]);
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
    const discardDrafts = () => {
      const client = rpcClientRef.current;
      if (client?.socket.readyState === WebSocket.OPEN) {
        void dispatch(client, "session/discard_draft", {
          deckClientId: getDeckClientId(),
          reason: "tab-disconnect",
        });
      }
    };
    window.addEventListener("pagehide", discardDrafts);
    return () => window.removeEventListener("pagehide", discardDrafts);
  }, []);
  useEffect(() => {
    if (!draftProject) {
      return;
    }
    const defaultCwd = draftProject.path ?? draftProject.worktrees?.[0]?.path;
    const nextWorktreeId = resolveDraftSelectionId(
      selectedCwd,
      filteredWorktrees,
      defaultCwd,
    );
    if (nextWorktreeId && nextWorktreeId !== selectedCwd) {
      setSelectedCwd(nextWorktreeId);
    }
  }, [draftProject, filteredWorktrees, selectedCwd]);
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
    void dispatch(rpcClientRef.current, "project/git/list_branches", {
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
    const selectedWorktree = filteredWorktrees.find(
      (worktree: any) => normalizeWorktreePath(worktree.path) === normalizeWorktreePath(selectedCwd),
    );
    const selectedProject = projects.find((project: any) => project.id === selectedProjectId);
    const selectedDraftCwd = selectedWorktree?.path ?? selectedCwd ?? selectedProject?.path;
    if (
      activeSession ||
      pairingState !== "paired" ||
      !selectedProjectId ||
      !selectedAgentId ||
      !selectedDraftCwd ||
      !rpcClientRef.current ||
      rpcClientRef.current.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const key = agentModelOptionsKey(selectedAgentId, selectedDraftCwd, selectedProjectId);
    const cached = agentModelOptions[key];
    const hasReadyConnection = (agentConnectionInventory ?? []).some(
      (connection: any) =>
        connection.providerId === selectedAgentId &&
        connection.cwd === selectedDraftCwd &&
        connection.initialized &&
        connection.status !== "closed" &&
        connection.status !== "error",
    );
    if (hasReadyConnection) {
      const hasLoadedOptions = Boolean(
        (cached?.modelOptions?.length ?? 0) > 0 || (cached?.configOptions?.length ?? 0) > 0,
      );
      if (cached && !cached.loading && cached.warmed && hasLoadedOptions) {
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
      const shouldProbeModelOptions =
        !cached?.message ||
        cached.message === "ACP provider connected." ||
        cached.message === "ACP 已连接" ||
        cached.message === "正在连接 ACP...";
      if (!shouldProbeModelOptions) {
        return;
      }
      setAgentModelOptions((current) => ({
        ...current,
        [key]: {
          loading: true,
          warmed: true,
          projectId: selectedProjectId,
          deckClientId: getDeckClientId(),
          requestedAt: Date.now(),
          modelOptions: cached?.modelOptions ?? [],
          configOptions: cached?.configOptions ?? [],
          state: cached?.state ?? {},
          message: "正在创建 ACP 草稿会话并加载模型...",
        },
      }));
      void dispatch(rpcClientRef.current, "session/draft", {
        deckClientId: getDeckClientId(),
        projectId: selectedProjectId,
        cwd: selectedDraftCwd,
        agentId: selectedAgentId,
        agentMode: effectiveDraftAgentMode,
        model: selectedModel === "provider-default" ? undefined : selectedModel,
        reasoningEffort: selectedReasoningEffort,
      });
      return;
    }
    if (cached?.loading) {
      const loadingStartedAt = (cached as any).requestedAt;
      if (typeof loadingStartedAt === "number" && Date.now() - loadingStartedAt < 15_000) {
        const retryDelayMs = Math.max(0, 15_000 - (Date.now() - loadingStartedAt) + 50);
        const retryTimer = window.setTimeout(() => {
          setAgentModelOptions((current) => ({ ...current }));
        }, retryDelayMs);
        return () => window.clearTimeout(retryTimer);
      }
    }
    setAgentModelOptions((current) => ({
      ...current,
      [key]: {
        loading: true,
        warmed: false,
        projectId: selectedProjectId,
        requestedAt: Date.now(),
        modelOptions: cached?.modelOptions ?? [],
        configOptions: cached?.configOptions ?? [],
        state: cached?.state ?? {},
        message: "正在连接 ACP...",
      },
    }));
    void dispatch(rpcClientRef.current, "agent/connect", {
      projectId: selectedProjectId,
      cwd: selectedDraftCwd,
      providerId: selectedAgentId,
    });
  }, [
    agentModelOptions,
    agentConnectionInventory,
    pairingState,
    selectedAgentId,
    selectedModel,
    selectedProjectId,
    selectedCwd,
    effectiveDraftAgentMode,
    selectedReasoningEffort,
  ]);
}
