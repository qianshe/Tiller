import {
  sortSessionTimelineEntries,
  type AgentMessage,
  type FileDiffSummary,
  type LegacyEvidenceSource,
  type SessionSubagentDetail,
  type SessionSummary,
} from "@tiller/shared";
import { useState, useCallback, useEffect, useRef } from "react";
import {
  canGenerateAssistantHandoff,
  generateAssistantHandoffDraft,
} from "../../prompt-enhancer";
import { MissionChatPane } from "../conversation";
import { useDeckStore } from "../../../store";
import { MissionComposer } from "../composer";
import { MissionDiffPanel, MissionDisplaySection } from "../display";
import { MissionInspector } from "../inspector";
import { generateCommitDescription } from "../inspector/generate-commit-description";
import { MissionMobilePager } from "./mobile-pager";
import {
  MISSION_MOBILE_PANE_ORDER,
  selectAdjacentMissionMobilePane as resolveAdjacentMissionMobilePane,
} from "./mobile-pane";
import { useChatWindowActions } from "./chat-window-actions";
import type { GitCommitDetailState, GitGraphState } from "../../../store/facade";
import { MissionPage } from "./page";
import {
  buildDraftPreparingMessage,
  buildComposerPromptPlaceholder,
  buildMissionChatRestoreNotice,
  resolveMissionChatSelectedSessionId,
} from "./chat-composition";
import { MissionWorktreeList } from "./worktree-list";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../../../shared/ui";
import { MissionSidebar } from "../navigation";
import { buildChatWindowModel } from "./chat-window-model";
import { buildMissionWorktreeModel } from "./model";
import { useOpenSessionStreams } from "./open-session-streams";
import { useRuntimeOverviewActions } from "./runtime-overview-actions";
import {
  normalizeWorktreePath,
} from "./runtime-display";
import { buildHandoffConversationTranscript } from "../utils/composer-options";
import {
  buildSelectedSessionWorktreeItems,
  formatInspectorWorktreeSummaryLabel,
} from "./worktree-summary";
import { joinClassNames } from "../utils/session-render-state";
import { shouldRefreshModelPickerOptions } from "../utils/model-picker-refresh";
import { reconcileMissionDiffs, shouldPrimeGitGraphLoad } from "./git-sync";
import { useGitOperations } from "./git-operations";

export function MissionWorktree(props: any) {
  const {
    embedded = false,
    chatOnly = false,
    prompt,
    promptImages,
    rpcClientRef,
    dispatch,
    socketRef,
    activeSessionId,
    draftChatWindow = null,
    setDraftChatWindow,
    openChatSessionIds = [],
    setOpenChatSessionIds,
    focusedChatWindowId,
    setFocusedChatWindowId,
    selectedProjectId,
    selectedCwd,
    selectedAgentId,
    activeSession,
    diffs,
    historicalDiffIncompleteBySession = {},
    outputs,
    messages,
    sessionTimeline,
    sessionPlans = {},
    dismissedCompletedSessionPlanKeys = {},
    setDismissedCompletedSessionPlanKeys,
    toolCalls,
    statuses,
    copy,
    selectedMissionDisplayTabId,
    activeSessionProjectId,
    projectFilesByScope,
    activeSessionProject,
    draftProject,
    selectedWorktree,
    worktrees,
    selectedDraftAgent,
    projectFileFilter,
    collapsedProjectFileDirectories,
    effectiveSidebarCollapsed,
    effectiveDisplayCollapsed,
    effectiveInspectorCollapsed,
    isMissionMobile,
    selectedMissionMobilePane,
    setSelectedMissionMobilePane,
    missionLayoutRef,
    missionLayoutStyle,
    missionSidebarCollapsed,
    missionSidebarPaneStyle,
    handleMissionTreeScroll,
    setMissionSidebarCollapsed,
    setMissionDisplayCollapsed,
    setMissionInspectorCollapsed,
    missionHelms,
    effectiveMissionHelmId,
    activeHelm,
    missionProjects,
    expandedMissionHelmIds,
    projects,
    helmConnectionStates,
    activeProfileId,
    connection,
    toggleMissionHelmNode,
    selectProject,
    missionSelectedProjectId,
    expandedMissionProjectIds,
    sessions,
    sessionCountsByProject,
    agents,
    agentConnectionInventory = [],
    setSelectedMissionHelmId,
    setSelectedProjectId,
    setSelectedCwd,
    setSelectedAgentId,
    setExpandedMissionProjectIds,
    setActiveSessionId,
    openSession,
    renderMissionAgentIcon,
    resolveDisplaySessionTitle,
    regenerateSessionTitle,
    regeneratingIds,
    formatRelativeTime,
    setPendingSessionCleanup,
    sessionHistoryState,
    toggleMissionProjectNode,
    startMissionPaneResize,
    nudgeMissionPane,
    isMissionPaneResizing,
    missionPaneResizeVersion,
    missionChatPaneStyle,
    chatMainRef,
    handleChatMainScroll,
    pairingState,
    activeSessionMessages,
    activePromptQueue,
    promptQueues = {},
    expandedMessageIds,
    messageHistoryState,
    setMessageHistoryState,
    loadOlderMessages,
    toggleExpandedMessage,
    pendingPermission,
    pendingApprovals,
    technicalPanels,
    respondToPermission,
    updateQueuedPrompt,
    deleteQueuedPrompt,
    worktreePickerRef,
    worktreePickerOpen,
    setWorktreePickerOpen,
    agentPickerRef,
    agentPickerOpen,
    setAgentPickerOpen,
    selectedWorktreeName,
    draftWorktreeOptions,
    selectDraftWorktree,
    agentLocked,
    filteredAgents,
    navigateToView,
    selectDraftAgent,
    createDraftSessionForAgent,
    submitPrompt,
    slashWrapperRef,
    removePromptImage,
    imagePasteNotice,
    draftContexts,
    clearDraftContexts,
    addDraftContext,
    removeDraftContext,
    commandRetentionNotice,
    setCommandRetentionNotice,
    missionPromptRef,
    setPrompt,
    handleMissionPromptKeyDown,
    handleMissionPromptPaste,
    onAddPromptImages,
    draftPromptPlaceholder,
    slashPopupOpen,
    filteredSlashCommands,
    slashSelectedIndex,
    applySlashCommand,
    setSlashSelectedIndex,
    openSlashCommands,
    showDraftAgentModeSelect,
    missionConfigPicker,
    setMissionConfigPicker,
    draftAgentModePickerLabel,
    draftAgentModeOptions,
    effectiveDraftAgentMode,
    updateSessionDraftPreferences,
    draftModelPlaceholder,
    draftModelPickerDisabled,
    draftModelPickerLabel,
    draftModelLoading,
    draftModelConfigReady,
    draftModelBaseOptions,
    resolveReasoningOptionsForModel,
    draftAllModelOptions,
    draftConfigOptions,
    effectiveDraftReasoningEffort,
    effectiveDraftModelBase,
    resolveCombinedModelValue,
    showDraftReasoningSelect,
    resolveReasoningLabel,
    draftReasoningOptions,
    deckPreferences,
    enhancePromptDraft,
    promptEnhancerBusy,
    setPromptEnhancerStatus,
    cancelSession,
    missionDisplayPaneStyle,
    selectedMissionDiffFilePath,
    activityHistoryState,
    setActivityHistoryState,
    activityVisibleCounts,
    setActivityVisibleCounts,
    loadOlderActivities,
    setSelectedMissionDisplayTabId,
    missionGitErrorTabOpen,
    openMissionGitErrorTab,
    closeMissionGitErrorTab,
    openDiffDetail,
    toggleMissionDiffDirectory,
    collapsedMissionDiffDirectories,
    missionInspectorPaneStyle,
    setProjectFileFilter,
    toggleProjectFileDirectory,
    agentModelOptions = {},
    gitStatusByWorktree = {},
    setGitStatusByWorktree,
    gitGraphByWorktree = {},
    setGitGraphByWorktree,
    openedMissionDiffFilePaths = [],
    closeMissionDiffFile,
  } = props;
  const sessionLegacyEvidence = useDeckStore((state) => state.sessionLegacyEvidence);
  const setSessionLegacyEvidence = useDeckStore((state) => state.setSessionLegacyEvidence);
  const sessionSubagentDetails = useDeckStore((state) => state.sessionSubagentDetails);
  const setSessionSubagentDetails = useDeckStore((state) => state.setSessionSubagentDetails);
  const subagentDetailGenerationsRef = useRef(new Map<string, number>());
  const pendingSubagentDetailRequestsRef = useRef(new Set<string>());

  const loadSubagentDetail = useCallback((sessionId: string, parentToolCallId: string) => {
    const client = rpcClientRef.current;
    const key = `${sessionId}\0${parentToolCallId}`;
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      setSessionSubagentDetails((current) => ({
        ...current,
        [key]: {
          ...(current[key] ?? {
            sessionId,
            parentToolCallId,
            throughSequence: 0,
            entries: [],
          }),
          loading: false,
          failed: true,
        },
      }));
      return;
    }
    if (pendingSubagentDetailRequestsRef.current.has(key)) {
      return;
    }
    pendingSubagentDetailRequestsRef.current.add(key);
    const generation = (subagentDetailGenerationsRef.current.get(key) ?? 0) + 1;
    subagentDetailGenerationsRef.current.set(key, generation);
    setSessionSubagentDetails((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? {
          sessionId,
          parentToolCallId,
          throughSequence: 0,
          entries: [],
        }),
        loading: true,
        failed: false,
      },
    }));
    void client.request("session/get_subagent_detail", { sessionId, parentToolCallId })
      .then((result: unknown) => {
        if (subagentDetailGenerationsRef.current.get(key) !== generation) return;
        const snapshot = result as SessionSubagentDetail;
        setSessionSubagentDetails((current) => {
          const buffered = current[key];
          if (!buffered) return current;
          return {
            ...current,
            [key]: {
              ...mergeSubagentDetailSnapshot(snapshot, buffered),
              loading: false,
              failed: false,
            },
          };
        });
      })
      .catch(() => {
        if (subagentDetailGenerationsRef.current.get(key) !== generation) return;
        setSessionSubagentDetails((current) => {
          const existing = current[key];
          return existing
            ? { ...current, [key]: { ...existing, loading: false, failed: true } }
            : current;
        });
      })
      .finally(() => {
        pendingSubagentDetailRequestsRef.current.delete(key);
      });
  }, [rpcClientRef, setSessionSubagentDetails]);

  const toggleSubagentDetail = useCallback((sessionId: string, parentToolCallId: string, open: boolean) => {
    if (open) {
      loadSubagentDetail(sessionId, parentToolCallId);
    }
  }, [loadSubagentDetail]);
  const pendingLegacyEvidenceRequestsRef = useRef(new Set<string>());
  const loadSessionLegacyEvidence = useCallback((
    sessionId: string,
    source: LegacyEvidenceSource,
    after?: string,
  ) => {
    const requestKey = `${sessionId}:${source}:${after ?? ""}`;
    if (pendingLegacyEvidenceRequestsRef.current.has(requestKey)) {
      return;
    }
    const client = rpcClientRef.current;
    if (!client) {
      return;
    }
    pendingLegacyEvidenceRequestsRef.current.add(requestKey);
    setSessionLegacyEvidence((current) => {
      const existing = current[sessionId];
      return {
        ...current,
        [sessionId]: {
          availability: existing?.availability,
          pages: existing?.pages ?? {},
          loading: { ...existing?.loading, [source]: true },
        },
      };
    });
    void dispatch(client, "session/list_legacy_evidence", { sessionId, source, limit: 50, after })
      .catch(() => {
        setSessionLegacyEvidence((current) => {
          const existing = current[sessionId];
          if (!existing) {
            return current;
          }
          return {
            ...current,
            [sessionId]: {
              ...existing,
              loading: { ...existing.loading, [source]: false },
            },
          };
        });
      })
      .finally(() => {
        pendingLegacyEvidenceRequestsRef.current.delete(requestKey);
      });
  }, [dispatch, rpcClientRef, setSessionLegacyEvidence]);
  const [selectedCommitDiffPaths, setSelectedCommitDiffPaths] = useState<Set<string>>(() => new Set());
  const [assistantHandoffBusy, setAssistantHandoffBusy] = useState(false);
  const modelPickerRefreshBySessionRef = useRef<Record<string, string | null>>({});
  const canHandoffAssistantMessage =
    canGenerateAssistantHandoff(deckPreferences.promptEnhancer) &&
    typeof setPrompt === "function" &&
    typeof setPromptEnhancerStatus === "function";
  const handleAssistantHandoff = async (
    session: SessionSummary,
    assistantBlockText: string,
    sessionMessagesForHandoff: AgentMessage[],
  ) => {
    if (!canHandoffAssistantMessage || assistantHandoffBusy) {
      return;
    }

    setAssistantHandoffBusy(true);
    try {
      await generateAssistantHandoffDraft({
        assistantBlockText,
        session,
        sessionSummary: buildHandoffConversationTranscript(
          sessionMessagesForHandoff,
        ),
        promptEnhancer: deckPreferences.promptEnhancer,
        projects,
        worktrees,
        selectedCwd,
        activeSessionProject,
        draftProject,
        setPrompt,
        setPromptEnhancerStatus,
      });
      missionPromptRef.current?.focus?.();
    } catch (error) {
      setPromptEnhancerStatus(
        error instanceof Error ? error.message : "Handoff 草稿生成失败",
      );
    } finally {
      setAssistantHandoffBusy(false);
    }
  };
  const {
    focusedRealSessionId,
    persistedOpenChatSessionIds,
    visibleChatSessionIds,
    openSessions,
    openSessionIdSet,
    focusedDraftWindow,
    selectedComposerSession,
  } = buildChatWindowModel({
    sessions: sessions as SessionSummary[],
    activeSessionId,
    activeSession,
    openChatSessionIds: openChatSessionIds as string[],
    focusedChatWindowId,
    draftChatWindow,
    isMissionMobile,
  });
  const composerSession = selectedComposerSession ?? activeSession;
  const handleOpenModelPicker = useCallback(() => {
    if (!composerSession?.id) {
      return;
    }

    const lastRefreshedRuntimeSessionId =
      modelPickerRefreshBySessionRef.current[composerSession.id];

    if (!shouldRefreshModelPickerOptions({
      activeSessionId: composerSession.id,
      runtimeSessionId: composerSession.runtimeSessionId,
      lastRefreshedRuntimeSessionId,
    })) {
      return;
    }

    modelPickerRefreshBySessionRef.current[composerSession.id] =
      composerSession.runtimeSessionId ?? null;

    updateSessionDraftPreferences({
      agentMode: effectiveDraftAgentMode,
      model: resolveCombinedModelValue(
        effectiveDraftModelBase,
        effectiveDraftReasoningEffort,
        draftAllModelOptions,
      ),
      reasoningEffort: effectiveDraftReasoningEffort,
    });
  }, [
    composerSession,
    updateSessionDraftPreferences,
    effectiveDraftAgentMode,
    effectiveDraftModelBase,
    effectiveDraftReasoningEffort,
    draftAllModelOptions,
    resolveCombinedModelValue,
  ]);
  const {
    canSend,
    activeSessionRestoreGate,
    composerSessionRestoreGate,
    activeMissionHelm,
    activeDiffs,
    activeOutputs,
    activeToolCalls,
    activeSessionStatus,
    composerSessionStatus,
    pendingToolActivity,
    missionActivityLoading,
    missionDiffCount: sessionMissionDiffCount,
    missionLogCount,
    missionStatusLabel,
    missionDisplayTabs,
    selectedMissionDisplayTab,
    projectFilesScope,
    projectFilesEntry,
    projectFiles,
    overviewProject,
    overviewProjectName,
    overviewWorktreeName,
    overviewAgentName,
    currentGitBranch,
    filteredWorktrees,
    projectOverviewItems,
    visibleProjectFiles,
    sessionExecutionPending,
    composerModelLoading,
    composerSessionRestoring,
  } = buildMissionWorktreeModel({
    ...props,
    composerSession,
  });
  const activeGitProjectId = activeSessionProjectId ?? selectedProjectId;
  const activeGitCwd = selectedCwd ?? activeSession?.cwd;
  const currentGitStatus = activeGitCwd ? gitStatusByWorktree[activeGitCwd] : undefined;
  const effectiveMissionDisplayTab = selectedMissionDisplayTabId === "git-error"
    ? { id: "git-error", title: "Git 错误" }
    : selectedMissionDisplayTab;
  const historicalDiffIncomplete = Boolean(
    activeSessionId && historicalDiffIncompleteBySession[activeSessionId],
  );
  const diffEmptyText = historicalDiffIncomplete
    ? "历史快照不完整：未保存 Diff patch。"
    : currentGitStatus
    ? copy.noDiffSummary
    : "请先刷新 Git 获取当前文件树。";
  const syncedMissionDiffs: FileDiffSummary[] = historicalDiffIncomplete
    ? activeDiffs
    : reconcileMissionDiffs(activeDiffs, currentGitStatus?.files);
  const missionDiffCount = syncedMissionDiffs.length;
  const hasWorktreeScope = Boolean(activeSession || selectedProjectId);
  const toggleMissionThinking = () => {
    props.updateTechnicalPanelPreference?.(
      "showMissionThinking",
      !technicalPanels.showMissionThinking,
    );
  };
  const hydrateOpenSessionStreams = useOpenSessionStreams({
    pairingState,
    connection,
    rpcClientRef,
    dispatch,
    openSessions,
    sessions: sessions as SessionSummary[],
    messageHistoryState,
    messagesBySession: messages,
    sessionTimelineBySession: sessionTimeline,
    setMessageHistoryState,
  });
  const effectiveSelectedAgentId = focusedDraftWindow?.agentId ?? selectedAgentId;
  const effectiveSelectedCwd = focusedDraftWindow?.cwd ?? selectedCwd;
  const effectiveSelectedProjectId = focusedDraftWindow?.projectId ?? selectedProjectId;
  const effectiveSelectedProjectName =
    (projects as any[]).find((project) => project.id === effectiveSelectedProjectId)?.name ?? "未选项目";
  const effectiveSelectedDraftAgent = (agents as any[]).find((agent) => agent.id === effectiveSelectedAgentId) ?? selectedDraftAgent;
  const effectiveSelectedWorktree = (draftWorktreeOptions as any[]).find(
    (worktree) => normalizeWorktreePath(worktree.path) === normalizeWorktreePath(effectiveSelectedCwd ?? undefined),
  ) ?? selectedWorktree;
  const effectiveSelectedWorktreeName = effectiveSelectedWorktree?.name ?? selectedWorktreeName;
  const {
    openChatSession,
    selectChatSession,
    closeChatSession,
    openDraftChatWindow,
    selectAgentForDraftWindow,
    submitPromptFromFocusedWindow,
  } = useChatWindowActions({
    activeSessionId,
    activeSession,
    isMissionMobile,
    sessions: sessions as SessionSummary[],
    focusedChatWindowId,
    focusedRealSessionId,
    focusedDraftWindow,
    draftChatWindow,
    projects,
    selectedProjectId,
    selectedCwd,
    selectedAgentId,
    hydrateOpenSessionStreams,
    setOpenChatSessionIds,
    setFocusedChatWindowId,
    openSession,
    setActiveSessionId,
    setDraftChatWindow,
    setSelectedMissionHelmId,
    setSelectedProjectId,
    setSelectedCwd,
    setSelectedAgentId,
    setSelectedMissionMobilePane,
    selectDraftAgent,
    submitPrompt,
  });
  const selectDraftWorktreeForFocusedWindow = (worktreePath: string) => {
    selectDraftWorktree(worktreePath);
    if (!focusedDraftWindow) {
      return;
    }
    setDraftChatWindow?.((current: any) =>
      current?.id === focusedDraftWindow.id ? { ...current, cwd: worktreePath } : current,
    );
  };
  const selectDraftProjectForFocusedWindow = (projectId: string) => {
    const project = (projects as any[]).find((item) => item.id === projectId);
    if (!project) {
      return;
    }
    const worktreePaths = ((project.worktrees ?? []) as any[])
      .map((worktree) => worktree.path)
      .filter(Boolean);
    const currentCwd = focusedDraftWindow?.cwd ?? selectedCwd;
    const nextCwd = worktreePaths.includes(currentCwd ?? "")
      ? currentCwd
      : (project.path ?? worktreePaths[0] ?? null);
    selectProject(projectId);
    if (!focusedDraftWindow) {
      return;
    }
    const nextDraftWindowId = `draft:${projectId}`;
    setDraftChatWindow?.((current: any) =>
      current?.id === focusedDraftWindow.id
        ? { ...current, id: nextDraftWindowId, projectId, cwd: nextCwd, agentId: null }
        : current,
    );
    setFocusedChatWindowId(nextDraftWindowId);
  };
  const onToggleDisplay = () => {
    setMissionDisplayCollapsed((current: boolean) => !current);
  };
  const onToggleInspector = () => {
    setMissionInspectorCollapsed((current: boolean) => !current);
  };
  const rawWorktreeOptions = hasWorktreeScope
    ? filteredWorktrees.length
      ? filteredWorktrees
      : selectedWorktree
        ? [selectedWorktree]
        : []
    : [];
  const worktreeOptions = rawWorktreeOptions;
  const selectedWorktreeSummaryItem = selectedCwd
    ? worktreeOptions.find(
        (worktree: any) =>
          normalizeWorktreePath(worktree.path) === normalizeWorktreePath(selectedCwd),
      )
    : null;
  const selectedSessionWorktreeItems = buildSelectedSessionWorktreeItems({
    sessions: [],
    activeSession,
    currentGitBranch,
    selectedCwd,
    branchByCwd: Object.fromEntries(
      Object.entries(gitStatusByWorktree ?? {}).map(([cwd, status]: [string, any]) => [
        normalizeWorktreePath(cwd),
        status?.branch ?? undefined,
      ]),
    ),
  });
  const activeSessionPlan = activeSession?.id ? sessionPlans?.[activeSession.id] : null;
  const dismissCompletedSessionPlan = (sessionId: string, planKey: string) => {
    setDismissedCompletedSessionPlanKeys?.((current: Record<string, string>) => ({
      ...current,
      [sessionId]: planKey,
    }));
  };
  const workbenchProjectOptions = (projects as any[]).map((project) => ({
    id: project.id,
    name: project.name ?? project.id,
  }));
  const openNewTaskFromWorkbench = (projectId: string) => {
    const targetProject =
      (projects as any[]).find((project) => project.id === projectId);
    if (!targetProject) {
      return;
    }
    setExpandedMissionProjectIds((current: Set<string>) => new Set([...current, targetProject.id]));
    openDraftChatWindow({
      projectId: targetProject.id,
      cwd: targetProject.path ?? targetProject.worktrees?.[0]?.path ?? null,
      agentId: null,
    });
  };

  const {
    handleRefreshGitStatus,
    handleFetch,
    handlePush,
    handlePull,
    handleCommit,
    handleDiscard,
    handleFetchFileDiffs,
  } = useGitOperations({
    activeGitProjectId,
    activeGitCwd,
    rpcClientRef,
    dispatch,
    gitGraphByWorktree,
    setGitStatusByWorktree,
    setGitGraphByWorktree,
    setSelectedCommitDiffPaths,
  });

  // Status 快照只带统计;选中文件缺 patch 时按需批量拉取,状态刷新后指纹
  // (lastUpdated)变化会重新请求,避免对同一快照重复请求。
  const requestedDiffPathsRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!selectedMissionDiffFilePath || !currentGitStatus?.lastUpdated) {
      return;
    }
    const selectedDiff = syncedMissionDiffs.find(
      (diff) => diff.path === selectedMissionDiffFilePath,
    );
    const inGitStatus = currentGitStatus.files?.some(
      (file: { path: string }) => file.path === selectedMissionDiffFilePath,
    );
    if (!selectedDiff || selectedDiff.patch || !inGitStatus) {
      return;
    }
    const fingerprint = currentGitStatus.lastUpdated;
    if (requestedDiffPathsRef.current.get(selectedMissionDiffFilePath) === fingerprint) {
      return;
    }
    requestedDiffPathsRef.current.set(selectedMissionDiffFilePath, fingerprint);
    void handleFetchFileDiffs([selectedMissionDiffFilePath]);
  }, [
    selectedMissionDiffFilePath,
    syncedMissionDiffs,
    currentGitStatus,
    handleFetchFileDiffs,
  ]);

  const handleGenerateDescription = useCallback(async (): Promise<string> => {
    if (!deckPreferences.promptEnhancer.llm.enabled) {
      throw new Error("LLM not configured in preferences");
    }

    const selectedChanges = syncedMissionDiffs
      .filter((diff) => selectedCommitDiffPaths.has(diff.path))
      .map((diff) => ({
        path: diff.path,
        status: diff.status,
        patch: diff.patch,
      }));

    // 补齐缺失的 patch:直接使用返回值,不等待 store 回流。
    const missingPaths = selectedChanges
      .filter((change) => !change.patch)
      .map((change) => change.path);
    if (missingPaths.length > 0) {
      const fetched = await handleFetchFileDiffs(missingPaths);
      const patchByPath = new Map(
        (fetched.files ?? []).map((file) => [file.path.replace(/\\/g, "/"), file.patch] as const),
      );
      for (const change of selectedChanges) {
        change.patch ??= patchByPath.get(change.path.replace(/\\/g, "/"));
      }
    }

    return await generateCommitDescription({
      selectedChanges,
      llmConfig: deckPreferences.promptEnhancer.llm,
    });
  }, [
    deckPreferences.promptEnhancer.llm,
    handleFetchFileDiffs,
    selectedCommitDiffPaths,
    syncedMissionDiffs,
  ]);

  const handleOpenGraph = useCallback(() => {
    setSelectedMissionDisplayTabId("graph");
    setMissionDisplayCollapsed(false);
    if (isMissionMobile) {
      setSelectedMissionMobilePane("display");
    }

    // Fetch graph data if not already loaded
    if (!activeGitProjectId || !activeGitCwd || !rpcClientRef.current) {
      return;
    }

    const currentGraph = gitGraphByWorktree[activeGitCwd];
    if (!currentGraph?.loading) {
      setGitGraphByWorktree?.((current: Record<string, any>) => ({
        ...current,
        [activeGitCwd]: {
          projectId: activeGitProjectId,
          cwd: activeGitCwd,
          head: currentGraph?.head,
          signature: currentGraph?.signature,
          commits: currentGraph?.commits ?? [],
          loading: true,
          message: "正在加载提交历史...",
        },
      }));
    }
    void dispatch(rpcClientRef.current, "project/git/graph", {
      projectId: activeGitProjectId,
      cwd: activeGitCwd,
      ...(currentGraph?.signature ? { knownSignature: currentGraph.signature } : {}),
    });
  }, [activeGitProjectId, activeGitCwd, rpcClientRef, dispatch, gitGraphByWorktree, setSelectedMissionDisplayTabId, setMissionDisplayCollapsed, isMissionMobile, setSelectedMissionMobilePane]);

  const handleOpenGitError = useCallback(() => {
    openMissionGitErrorTab();
    setMissionDisplayCollapsed(false);
    if (isMissionMobile) {
      setSelectedMissionMobilePane("display");
    }
  }, [isMissionMobile, openMissionGitErrorTab, setMissionDisplayCollapsed, setSelectedMissionMobilePane]);
  const handleSelectGitCommit = useCallback((commitHash: string) => {
    if (!activeGitProjectId || !activeGitCwd || !rpcClientRef.current) {
      return;
    }
    const projectId = activeGitProjectId;
    const cwd = activeGitCwd;
    const currentDetail = gitGraphByWorktree[cwd]?.commitDetails?.[commitHash];
    if (currentDetail?.loading || (currentDetail && !currentDetail.error)) {
      return;
    }
    // Seed the graph entry when missing so detail state always has a home.
    const patchCommitDetail = (
      detail: Omit<GitCommitDetailState, "commitHash" | "files">,
    ) => {
      setGitGraphByWorktree?.((current: Record<string, GitGraphState>) => {
        const graph: GitGraphState = current[cwd] ?? { projectId, cwd, commits: [] };
        const files = graph.commitDetails?.[commitHash]?.files ?? [];
        return {
          ...current,
          [cwd]: {
            ...graph,
            commitDetails: {
              ...graph.commitDetails,
              [commitHash]: { commitHash, files, ...detail },
            },
          },
        };
      });
    };
    patchCommitDetail({ loading: true, message: "正在加载提交详情..." });
    void dispatch(rpcClientRef.current, "project/git/commit_detail", {
      projectId,
      cwd,
      commitHash,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "提交详情加载失败";
      patchCommitDetail({ loading: false, message, error: message });
    });
  }, [
    activeGitCwd,
    activeGitProjectId,
    dispatch,
    gitGraphByWorktree,
    rpcClientRef,
    setGitGraphByWorktree,
  ]);
  const inspectorWorktreeCount = worktreeOptions.length || selectedSessionWorktreeItems.length;
  const inspectorWorktreeSummaryLabel = selectedWorktreeSummaryItem
    ? `${activeSessionProject?.name ?? draftProject?.name ?? "未命名项目"} / ${gitStatusByWorktree?.[selectedWorktreeSummaryItem.path]?.branch ?? selectedWorktreeSummaryItem.branch ?? selectedWorktreeSummaryItem.name ?? "未检测分支"}`
    : formatInspectorWorktreeSummaryLabel(
        selectedSessionWorktreeItems,
        worktreeOptions.length,
        selectedCwd,
        activeSession?.cwd,
      );
  const renderWorktreeList = () => (
    <MissionWorktreeList
      selectedSessionWorktreeItems={[]}
      worktreeOptions={worktreeOptions}
      selectedCwd={selectedCwd}
      activeSessionCwd={activeSession?.cwd}
      onSelectCwd={(cwd) => {
        setSelectedCwd(cwd);
        setWorktreePickerOpen(false);
      }}
    />
  );
  const toggleCommitDiffPath = (path: string) => {
    setSelectedCommitDiffPaths((current) => {
      const next = new Set(current);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };
  const toggleCommitDiffDirectory = (paths: string[]) => {
    setSelectedCommitDiffPaths((current) => {
      const next = new Set(current);
      const allSelected = paths.every((path) => next.has(path));
      paths.forEach((path) => {
        if (allSelected) {
          next.delete(path);
        } else {
          next.add(path);
        }
      });
      return next;
    });
  };
  const toggleSelectAllCommitDiffs = () => {
    setSelectedCommitDiffPaths((current) => {
      if (current.size === syncedMissionDiffs.length && syncedMissionDiffs.length > 0) {
        return new Set();
      }
      return new Set(syncedMissionDiffs.map((diff) => diff.path));
    });
  };
  const renderInspectorDiffPanel = () => (
    <MissionDiffPanel
      selectedDiffFilePath={selectedMissionDiffFilePath}
      diffs={syncedMissionDiffs}
      noDiffSummary={diffEmptyText}
      historicalDiffIncomplete={historicalDiffIncomplete}
      collapsedDiffDirectories={collapsedMissionDiffDirectories}
      selectedCommitDiffPaths={selectedCommitDiffPaths}
      onToggleCommitDiff={toggleCommitDiffPath}
      onToggleCommitDiffDirectory={toggleCommitDiffDirectory}
      onOpenDiffDetail={openDiffDetail}
      onToggleDiffDirectory={toggleMissionDiffDirectory}
    />
  );
  const chatPaneClassName = joinClassNames([
    "chat-conversation mission-pane mission-pane-chat relative col-start-3 col-end-4 flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-canvas",
    !activeSession && "mission-draft-chat",
  ]);
  const resolvedMissionMobilePane = chatOnly
    ? "chat"
    : selectedMissionMobilePane ?? ((activeSession || draftChatWindow) ? "chat" : "project");
  const currentMobilePaneIndex = MISSION_MOBILE_PANE_ORDER.indexOf(resolvedMissionMobilePane);
  useEffect(() => {
    const visiblePaths = new Set(syncedMissionDiffs.map((diff) => diff.path));
    setSelectedCommitDiffPaths((current) => {
      const next = new Set(
        Array.from(current).filter((path) => visiblePaths.has(path)),
      );
      return next.size === current.size ? current : next;
    });
  }, [syncedMissionDiffs]);
  useEffect(() => {
    if (
      selectedMissionDisplayTabId !== "graph" ||
      !activeGitProjectId ||
      !activeGitCwd ||
      !rpcClientRef.current
    ) {
      return;
    }

    const client = rpcClientRef.current;
    if (client.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const currentGraph = gitGraphByWorktree[activeGitCwd];
    if (!shouldPrimeGitGraphLoad(currentGraph)) {
      return;
    }

    setGitGraphByWorktree?.((current: Record<string, any>) => ({
      ...current,
      [activeGitCwd]: {
        projectId: activeGitProjectId,
        cwd: activeGitCwd,
        commits: [],
        loading: true,
        message: "正在加载提交历史...",
      },
    }));

    void dispatch(client, "project/git/graph", {
      projectId: activeGitProjectId,
      cwd: activeGitCwd,
    });
  }, [
    activeGitCwd,
    activeGitProjectId,
    dispatch,
    gitGraphByWorktree,
    rpcClientRef,
    selectedMissionDisplayTabId,
    setGitGraphByWorktree,
  ]);
  function selectAdjacentMissionMobilePane(direction: -1 | 1) {
    setSelectedMissionMobilePane(resolveAdjacentMissionMobilePane(resolvedMissionMobilePane, direction));
  }
  const displayPaneCollapsed = effectiveDisplayCollapsed;
  const canToggleDisplay = true;
  const missionLayoutClassName = joinClassNames([
    "wb-pane shadow-ambient chat-layout chat-layout-sidebar mission-responsive-mode mission-grid w-full overflow-hidden",
    embedded ? "h-full min-h-0" : "h-[calc(100vh-16px)] min-h-[640px]",
    chatOnly && "mission-chat-only",
    effectiveSidebarCollapsed && "mission-sidebar-collapsed",
    effectiveSidebarCollapsed && "sidebar-collapsed",
    displayPaneCollapsed && "mission-display-collapsed",
    displayPaneCollapsed && "display-collapsed",
    effectiveInspectorCollapsed && "mission-inspector-collapsed",
    effectiveInspectorCollapsed && "inspector-collapsed",
    isMissionMobile && "mission-mobile-mode",
    `mission-mobile-pane-${resolvedMissionMobilePane}`,
  ]);
  const { runtimeOverviewItems, reconnectAcpRuntime } = useRuntimeOverviewActions({
    rpcClientRef,
    dispatch,
    agentConnectionInventory: agentConnectionInventory as any[],
    agents: agents as any[],
    worktrees: worktrees ?? [],
    sessions: sessions as SessionSummary[],
    projects,
    statuses,
    statusLabels: copy.status,
    selectedProjectId,
    selectedCwd,
    activeSession,
    activeSessionRestoreGate,
    agentModelOptions: agentModelOptions as Record<string, any>,
    draftWorktreeOptions,
  });
  const selectedDraftConnection = !activeSession && effectiveSelectedAgentId && effectiveSelectedCwd
    ? (agentConnectionInventory as any[]).find(
        (connection) =>
          connection.providerId === effectiveSelectedAgentId &&
          normalizeWorktreePath(connection.cwd) === normalizeWorktreePath(effectiveSelectedCwd) &&
          connection.initialized &&
          connection.status !== "closed" &&
          connection.status !== "error",
      )
    : null;
  const draftConnectionEntry = !activeSession && effectiveSelectedAgentId && effectiveSelectedCwd
    ? (agentModelOptions as Record<string, any>)[`${effectiveSelectedAgentId}::${effectiveSelectedCwd}::${selectedProjectId ?? "global"}`] ??
      Object.entries(agentModelOptions as Record<string, any>).find(
        ([key, entry]) => key.startsWith(`${effectiveSelectedAgentId}::${effectiveSelectedCwd}`) && entry?.loading,
      )?.[1]
    : null;
  const visibleDraftChatWindow = draftChatWindow
    ? {
        id: draftChatWindow.id,
        title: "新建会话",
        projectName: projects.find((project: any) => project.id === draftChatWindow.projectId)?.name ?? "未选项目",
        worktreeName: worktrees.find((worktree: any) => normalizeWorktreePath(worktree.path) === normalizeWorktreePath(draftChatWindow.cwd ?? undefined))?.name ?? "",
        agentName: agents.find((agent: any) => agent.id === draftChatWindow.agentId)?.name ?? null,
        status: draftChatWindow.agentId
          ? selectedDraftConnection
            ? "ready" as const
            : "connecting" as const
          : "select-agent" as const,
        message: draftChatWindow.agentId
          ? selectedDraftConnection
            ? "ACP 已就绪，输入第一条消息后会创建真正的 session。"
            : draftConnectionEntry?.message ?? "正在连接 ACP，连接成功后即可发送第一条消息。"
          : "请选择下方 ACP Agent，或使用输入框中的 Agent 选择器。",
      }
    : null;
  const visibleDraftAgentOptions = (filteredAgents as any[]).map((agent) => ({
    id: agent.id,
    name: agent.name ?? agent.id,
  }));
  const helmConnected = pairingState === "paired";
  useEffect(() => {
    if (!helmConnected) return;
    for (const detail of Object.values(useDeckStore.getState().sessionSubagentDetails)) {
      if (detail) loadSubagentDetail(detail.sessionId, detail.parentToolCallId);
    }
  }, [helmConnected, loadSubagentDetail]);
  const shouldShowComposer = Boolean(helmConnected && (activeSession || draftChatWindow));
  const shouldShowDraftPreparing = Boolean(helmConnected && !activeSession && selectedAgentId && !selectedDraftConnection);
  const shouldShowRestoreGateNotice = Boolean(
    helmConnected && activeSession && !activeSessionRestoreGate.canChat && activeSessionRestoreGate.message,
  );
  const composerPromptPlaceholder = buildComposerPromptPlaceholder({
    showRestoreNotice: shouldShowRestoreGateNotice,
    state: activeSessionRestoreGate.state,
    message: activeSessionRestoreGate.message,
    isMobile: isMissionMobile,
    draftPromptPlaceholder,
  });
  const missionChatSelectedSessionId = resolveMissionChatSelectedSessionId({
    focusedDraftWindow: Boolean(focusedDraftWindow),
    focusedRealSessionId,
    activeSessionId: activeSession?.id,
  });
  const missionChatRestoreNotice = buildMissionChatRestoreNotice({
    show: shouldShowRestoreGateNotice,
    state: activeSessionRestoreGate.state,
    message: activeSessionRestoreGate.message,
  });
  const draftPreparingMessage = buildDraftPreparingMessage({
    agentName: effectiveSelectedDraftAgent?.name,
    connectionMessage: draftConnectionEntry?.message,
  });
  return (
    <MissionPage
      layoutRef={missionLayoutRef}
      className={missionLayoutClassName}
      style={missionLayoutStyle}
    >
      {" "}
      <ResizablePanelGroup
        id="mission-workbench-resizable"
        direction="horizontal"
        className="mission-resizable-group h-full min-h-0 w-full [grid-column:1/-1]"
        resizeTargetMinimumSize={{ fine: 4, coarse: 16 }}
      >
        {" "}
        {!chatOnly && (isMissionMobile || !effectiveSidebarCollapsed) ? (
          <ResizablePanel
            id="mission-sidebar"
            defaultSize="248px"
            minSize="0px"
            className="h-full min-w-0"
          >
            <MissionSidebar
              effectiveSidebarCollapsed={isMissionMobile ? false : effectiveSidebarCollapsed}
              missionSidebarCollapsed={missionSidebarCollapsed}
              missionSidebarPaneStyle={missionSidebarPaneStyle}
              handleMissionTreeScroll={handleMissionTreeScroll}
              setMissionSidebarCollapsed={setMissionSidebarCollapsed}
              missionHelms={missionHelms}
              effectiveMissionHelmId={effectiveMissionHelmId}
              expandedMissionHelmIds={expandedMissionHelmIds}
              projects={projects}
              helmConnectionStates={helmConnectionStates}
              activeProfileId={activeProfileId}
              connection={connection}
              toggleMissionHelmNode={toggleMissionHelmNode}
              missionSelectedProjectId={missionSelectedProjectId}
              expandedMissionProjectIds={expandedMissionProjectIds}
              sessions={sessions}
              sessionCountsByProject={sessionCountsByProject}
              currentGitBranch={currentGitBranch}
              missionDiffCount={missionDiffCount}
              runtimeOverviewItems={runtimeOverviewItems}
              setActiveSessionId={setActiveSessionId}
              statuses={statuses}
              copy={copy}
              activeSessionId={activeSessionId}
              highlightedSessionId={focusedRealSessionId ?? activeSessionId}
              openSessionIds={openSessionIdSet}
              openSession={openChatSession}
              renderMissionAgentIcon={renderMissionAgentIcon}
              resolveDisplaySessionTitle={resolveDisplaySessionTitle}
              regenerateSessionTitle={regenerateSessionTitle}
              regeneratingIds={regeneratingIds}
              formatRelativeTime={formatRelativeTime}
              setPendingSessionCleanup={setPendingSessionCleanup}
              sessionHistoryState={sessionHistoryState}
              toggleMissionProjectNode={toggleMissionProjectNode}
              setSelectedMissionMobilePane={setSelectedMissionMobilePane}
              isMobile={isMissionMobile}
              resizer={null}
            />{" "}
          </ResizablePanel>
        ) : null}
        {!chatOnly && !isMissionMobile && !effectiveSidebarCollapsed ? (
          <ResizableHandle
            className="mission-pane-resizer mission-pane-resizer-sidebar w-px bg-transparent hover:bg-primary-soft/20"
            aria-label="调整任务列表宽度"
          />
        ) : null}
        <ResizablePanel
          id="mission-chat"
          defaultSize="100%"
          minSize="360px"
          className="h-full min-w-0"
        >
          <MissionChatPane
            className={chatPaneClassName}
            style={missionChatPaneStyle}
            isMissionMobile={isMissionMobile}
            hideWorkspaceHeader={chatOnly}
            hideSessionCloseAction={chatOnly}
            isPaneResizing={isMissionPaneResizing}
          paneResizeVersion={missionPaneResizeVersion}
          chatMainRef={chatMainRef}
          onChatMainScroll={handleChatMainScroll}
          helmConnected={helmConnected}
          activeSession={activeSession}
          openSessions={openSessions}
          draftWindow={visibleDraftChatWindow}
          draftAgentOptions={visibleDraftAgentOptions}
          selectedWindowId={focusedChatWindowId}
          onSelectDraftWindow={(draftWindowId) => {
            setFocusedChatWindowId(draftWindowId);
            setActiveSessionId(null);
            if (isMissionMobile) {
              setSelectedMissionMobilePane("chat");
            }
          }}
          onSelectDraftAgent={selectAgentForDraftWindow}
          onCloseDraftWindow={() => {
            setDraftChatWindow?.(null);
            setFocusedChatWindowId(persistedOpenChatSessionIds.at(-1) ? `session:${persistedOpenChatSessionIds.at(-1)}` : null);
          }}
          selectedSessionId={missionChatSelectedSessionId}
          activeSessionMessages={activeSessionMessages}
          sessionMessagesById={messages ?? {}}
            sessionTimelineById={sessionTimeline ?? {}}
            sessionLegacyEvidenceById={sessionLegacyEvidence}
            activeSessionPlan={activeSessionPlan}
            sessionPlansById={sessionPlans ?? {}}
            dismissedCompletedSessionPlanKeys={dismissedCompletedSessionPlanKeys}
            activeSessionToolCalls={activeToolCalls}
          sessionToolCallsById={toolCalls ?? {}}
          copy={copy}
          canHandoffAssistantMessage={canHandoffAssistantMessage}
          assistantHandoffBusy={assistantHandoffBusy}
          onHandoffAssistantMessage={handleAssistantHandoff}
          expandedMessageIds={expandedMessageIds}
          messageHistoryState={messageHistoryState}
          onLoadOlderMessages={loadOlderMessages}
          onLoadLegacyEvidence={loadSessionLegacyEvidence}
          onToggleExpandedMessage={toggleExpandedMessage}
          onAddDraftContext={addDraftContext}
          subagentDetails={sessionSubagentDetails}
          onToggleSubagentDetail={toggleSubagentDetail}
          activityLoading={missionActivityLoading}
          pendingToolPresent={Boolean(pendingToolActivity)}
          pendingApprovals={pendingApprovals}
          pendingToolTitle={pendingToolActivity?.title ?? null}
          showPermissionWorktree={technicalPanels.showPermissionWorktree}
          displayCollapsed={chatOnly || displayPaneCollapsed}
          inspectorCollapsed={chatOnly || effectiveInspectorCollapsed}
          sidebarCollapsed={chatOnly ? false : effectiveSidebarCollapsed}
          showThinking={technicalPanels.showMissionThinking}
          canToggleDisplay={canToggleDisplay}
          projectOptions={workbenchProjectOptions}
          hasAgents={agents.length > 0}
          hasProjects={workbenchProjectOptions.length > 0}
          onNavigateAgents={(tab) => navigateToView("agents", { agentsTab: tab })}
          onExpandSidebar={() => setMissionSidebarCollapsed(false)}
          onToggleDisplay={onToggleDisplay}
          onToggleInspector={onToggleInspector}
          onToggleThinking={toggleMissionThinking}
          onCreateTask={openNewTaskFromWorkbench}
          onFocusSession={openChatSession}
          onSelectSessionView={selectChatSession}
          onRenameSession={regenerateSessionTitle}
            onCloseSessionView={closeChatSession}
            onClearSession={setPendingSessionCleanup}
            onDismissCompletedSessionPlan={dismissCompletedSessionPlan}
          onRespondToPermission={respondToPermission}
          promptQueue={activePromptQueue}
          sessionPromptQueuesById={promptQueues}
          restoreNotice={missionChatRestoreNotice}
          onUpdateQueuedPrompt={updateQueuedPrompt}
          onDeleteQueuedPrompt={deleteQueuedPrompt}
        >
          {shouldShowDraftPreparing ? (
            <div className="mission-draft-preparing m-3 rounded-xl border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">
              <strong className="block text-foreground">正在连接 ACP</strong>
              <span>
                {draftPreparingMessage}
              </span>
            </div>
          ) : null}
          {shouldShowComposer ? (
            <MissionComposer
              activeSession={composerSession}
              contextSession={selectedComposerSession}
              isMobile={isMissionMobile}
              worktreePickerRef={worktreePickerRef}
              worktreePickerOpen={worktreePickerOpen}
              setWorktreePickerOpen={setWorktreePickerOpen}
              agentPickerRef={agentPickerRef}
              agentPickerOpen={agentPickerOpen}
              setAgentPickerOpen={setAgentPickerOpen}
              selectedProjectId={effectiveSelectedProjectId}
              selectedProjectName={effectiveSelectedProjectName}
              draftProjectOptions={missionProjects}
              selectDraftProject={selectDraftProjectForFocusedWindow}
              selectedWorktreeName={effectiveSelectedWorktreeName}
              draftWorktreeOptions={draftWorktreeOptions}
              selectedCwd={effectiveSelectedCwd}
              selectDraftWorktree={selectDraftWorktreeForFocusedWindow}
              currentGitBranch={currentGitBranch}
              copy={copy}
              agentLocked={agentLocked}
              selectedDraftAgent={effectiveSelectedDraftAgent}
              filteredAgents={filteredAgents}
              selectedAgentId={effectiveSelectedAgentId}
              selectDraftAgent={selectDraftAgent}
              submitPrompt={submitPromptFromFocusedWindow}
              slashWrapperRef={slashWrapperRef}
              promptImages={promptImages}
              removePromptImage={removePromptImage}
              imagePasteNotice={imagePasteNotice}
              missionPromptRef={missionPromptRef}
              prompt={prompt}
              setPrompt={setPrompt}
              handleMissionPromptKeyDown={handleMissionPromptKeyDown}
              handleMissionPromptPaste={handleMissionPromptPaste}
              onAddPromptImages={onAddPromptImages}
              draftPromptPlaceholder={composerPromptPlaceholder}
              slashPopupOpen={slashPopupOpen}
              filteredSlashCommands={filteredSlashCommands}
              slashSelectedIndex={slashSelectedIndex}
              applySlashCommand={applySlashCommand}
              setSlashSelectedIndex={setSlashSelectedIndex}
              openSlashCommands={openSlashCommands}
              showDraftAgentModeSelect={showDraftAgentModeSelect}
              missionConfigPicker={missionConfigPicker}
              setMissionConfigPicker={setMissionConfigPicker}
              draftAgentModePickerLabel={draftAgentModePickerLabel}
              draftAgentModeOptions={draftAgentModeOptions}
              effectiveDraftAgentMode={effectiveDraftAgentMode}
              updateSessionDraftPreferences={updateSessionDraftPreferences}
              draftModelPlaceholder={draftModelPlaceholder}
              draftModelPickerDisabled={draftModelPickerDisabled}
              draftModelPickerLabel={draftModelPickerLabel}
              draftModelLoading={composerModelLoading}
              draftModelConfigReady={draftModelConfigReady}
              modelSettingsLocked={Boolean(composerSession && !composerSessionRestoreGate.canChat)}
              sessionRestoring={composerSessionRestoring}
              draftModelBaseOptions={draftModelBaseOptions}
              resolveReasoningOptionsForModel={resolveReasoningOptionsForModel}
              draftAllModelOptions={draftAllModelOptions}
              draftConfigOptions={draftConfigOptions}
              effectiveDraftReasoningEffort={effectiveDraftReasoningEffort}
              effectiveDraftModelBase={effectiveDraftModelBase}
              resolveCombinedModelValue={resolveCombinedModelValue}
              showDraftReasoningSelect={showDraftReasoningSelect}
              resolveReasoningLabel={resolveReasoningLabel}
              draftReasoningOptions={draftReasoningOptions}
              deckPreferences={deckPreferences}
              enhancePromptDraft={enhancePromptDraft}
              promptEnhancerBusy={promptEnhancerBusy}
              promptEnhancerStatus={props.promptEnhancerStatus || ""}
              sessionCanCancel={sessionExecutionPending && composerSessionStatus !== "starting"}
              cancelSession={cancelSession}
              onOpenModelPicker={handleOpenModelPicker}
              canSend={canSend}
              reviewContext={{
                draftContexts,
                commandRetentionNotice,
                removeDraftContext,
              }}
            />
          ) : null}{" "}
        </MissionChatPane>{" "}
        </ResizablePanel>
        {!chatOnly && !isMissionMobile && !displayPaneCollapsed ? (
          <ResizableHandle
            className="mission-pane-resizer mission-pane-resizer-display w-px bg-transparent hover:bg-primary-soft/20"
            aria-label="调整任务展示宽度"
          />
        ) : null}
        {!chatOnly && (isMissionMobile || !displayPaneCollapsed) ? (
          <ResizablePanel
            id="mission-display"
            defaultSize="320px"
            minSize="0px"
            className="h-full min-w-0"
          >
        <MissionDisplaySection
            style={missionDisplayPaneStyle}
            pages={missionDisplayTabs}
            selectedPage={effectiveMissionDisplayTab}
            overviewItems={projectOverviewItems}
            runtimeOverviewItems={runtimeOverviewItems}
            currentModelSummary={`当前模型：${draftModelPickerLabel} · 推理：${resolveReasoningLabel(effectiveDraftReasoningEffort)}`}
            openedDiffFilePaths={openedMissionDiffFilePaths ?? []}
            selectedDiffFilePath={selectedMissionDiffFilePath}
            diffs={syncedMissionDiffs}
            noDiffSummary={diffEmptyText}
            historicalDiffIncomplete={historicalDiffIncomplete}
            onReconnectRuntime={reconnectAcpRuntime}
            gitGraph={activeGitCwd ? gitGraphByWorktree[activeGitCwd] : undefined}
            gitStatus={currentGitStatus}
            gitErrorTabOpen={missionGitErrorTabOpen}
            onSelectGitCommit={handleSelectGitCommit}
            onCloseGitErrorTab={closeMissionGitErrorTab}
            onAddPage={() => {}}
            onSelectPage={setSelectedMissionDisplayTabId}
            onDragStart={() => {}}
            onDrop={() => {}}
            onRenamePage={() => {}}
            onMovePage={() => {}}
            onDeletePage={() => {}}
            onOpenDiffDetail={openDiffDetail}
            onCloseDiffFile={closeMissionDiffFile}
            onAddDraftContext={addDraftContext}
            onCollapse={onToggleDisplay}
        />{" "}
          </ResizablePanel>
        ) : null}
        {!chatOnly && !isMissionMobile && !effectiveInspectorCollapsed ? (
          <ResizableHandle
            className="mission-pane-resizer mission-pane-resizer-inspector w-px bg-transparent hover:bg-primary-soft/20"
            aria-label="调整检视器宽度"
          />
        ) : null}
        {!chatOnly && (isMissionMobile || !effectiveInspectorCollapsed) ? (
          <ResizablePanel
            id="mission-inspector"
            defaultSize="280px"
            minSize="0px"
            className="h-full min-w-0"
          >
        <MissionInspector
          collapsed={isMissionMobile ? false : effectiveInspectorCollapsed}
          style={missionInspectorPaneStyle}
          activeSessionPresent={Boolean(activeSession)}
          activeSession={activeSession}
          worktreeCount={inspectorWorktreeCount}
          worktreeSummaryLabel={inspectorWorktreeSummaryLabel}
          worktreeList={renderWorktreeList()}
          diffCount={missionDiffCount}
          selectedDiffCount={selectedCommitDiffPaths.size}
          selectedDiffPaths={selectedCommitDiffPaths}
          diffPanel={renderInspectorDiffPanel()}
          gitStatus={activeGitCwd ? gitStatusByWorktree[activeGitCwd] : undefined}
          onCommit={handleCommit}
          onGenerateDescription={handleGenerateDescription}
          onOpenGraph={handleOpenGraph}
          onOpenGitError={handleOpenGitError}
          onCollapse={onToggleInspector}
          onRefreshGitStatus={handleRefreshGitStatus}
          onFetch={handleFetch}
          onPush={handlePush}
          onPull={handlePull}
          onDiscard={handleDiscard}
          onToggleSelectAllDiffs={toggleSelectAllCommitDiffs}
          resizer={null}
        />{" "}
          </ResizablePanel>
        ) : null}
        {!chatOnly && isMissionMobile ? (
          <nav className="mission-mobile-edge-pager" aria-label="移动端左右翻页热区">
            <button
              type="button"
              className="mission-mobile-edge-pager-button mission-mobile-edge-pager-prev"
              onClick={() => selectAdjacentMissionMobilePane(-1)}
              disabled={currentMobilePaneIndex <= 0}
              aria-label="上一页"
            />
            <span aria-hidden="true" />
            <button
              type="button"
              className="mission-mobile-edge-pager-button mission-mobile-edge-pager-next"
              onClick={() => selectAdjacentMissionMobilePane(1)}
              disabled={currentMobilePaneIndex >= MISSION_MOBILE_PANE_ORDER.length - 1}
              aria-label="下一页"
            />
          </nav>
        ) : null}
        {!chatOnly ? (
          <MissionMobilePager
            selectedPane={resolvedMissionMobilePane}
            onSelectPane={setSelectedMissionMobilePane}
          />
        ) : null}
      </ResizablePanelGroup>{" "}
    </MissionPage>
  );
}

function mergeSubagentDetailSnapshot(
  snapshot: SessionSubagentDetail,
  buffered: SessionSubagentDetail | undefined,
): SessionSubagentDetail {
  if (!buffered || buffered.throughSequence <= snapshot.throughSequence) {
    if (!buffered) return snapshot;
    const snapshotKeys = new Set(snapshot.entries.map((entry) => `${entry.kind}:${entry.id}`));
    const missingBufferedEntries = buffered.entries.filter(
      (entry) => !snapshotKeys.has(`${entry.kind}:${entry.id}`),
    );
    return missingBufferedEntries.length === 0
      ? snapshot
      : { ...snapshot, entries: sortSessionTimelineEntries([...snapshot.entries, ...missingBufferedEntries]) };
  }
  const entries = new Map(snapshot.entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]));
  for (const entry of buffered.entries) entries.set(`${entry.kind}:${entry.id}`, entry);
  return {
    ...snapshot,
    throughSequence: buffered.throughSequence,
    entries: sortSessionTimelineEntries([...entries.values()]),
  };
}
