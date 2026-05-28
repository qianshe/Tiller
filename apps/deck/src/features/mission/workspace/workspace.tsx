import type { SessionSummary } from "@tiller/shared";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import {
  subscribeToSessionTopic,
  unsubscribeFromSessionTopic,
} from "../../helm-connection/facade";
import { MissionChatPane } from "../conversation";
import { MissionComposer } from "../composer";
import { MissionDiffPanel, MissionDisplaySection } from "../display";
import { MissionInspector } from "../inspector";
import { MissionMobilePager } from "./mobile-pager";
import { MissionPage } from "./page";
import {
  Icon,
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../../../shared/ui";
import { MissionSidebar } from "../navigation";
import { buildChatWindowModel } from "./chat-window-model";
import { buildMissionWorktreeModel } from "./workspace-model";
import { dedupeRuntimeOverviewItems } from "./workspace-runtime-overview";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/ui";
import { joinClassNames } from "../utils/session-render-state";
import { DEFAULT_ACTIVITY_PAGE_LIMIT, DEFAULT_MESSAGE_PAGE_LIMIT } from "../config";

const MISSION_MOBILE_PANE_ORDER = ["project", "chat", "display", "inspector"] as const;

export function MissionWorktree(props: any) {
  const {
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
    outputs,
    messages,
    toolCalls,
    statuses,
    copy,
    customMissionPanelPages,
    selectedMissionPanelPageId,
    openedMissionDiffFilePaths,
    closeMissionDiffFile,
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
    setPendingSessionHistoryReimport,
    sessionHistoryState,
    toggleMissionProjectNode,
    startMissionPaneResize,
    nudgeMissionPane,
    missionChatPaneStyle,
    chatMainRef,
    handleChatMainScroll,
    pairingState,
    activeSessionMessages,
    activePromptQueue,
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
    selectDraftAgent,
    createDraftSessionForAgent,
    submitPrompt,
    slashWrapperRef,
    removePromptImage,
    imagePasteNotice,
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
    cancelSession,
    missionDisplayPaneStyle,
    selectedMissionDiffFilePath,
    activityHistoryState,
    setActivityHistoryState,
    activityVisibleCounts,
    setActivityVisibleCounts,
    loadOlderActivities,
    addMissionPanelPage,
    setSelectedMissionPanelPageId,
    setDraggedMissionPanelPageId,
    dropMissionPanelPage,
    openDiffDetail,
    renameMissionPanelPage,
    moveMissionPanelPage,
    deleteMissionPanelPage,
    toggleMissionDiffDirectory,
    collapsedMissionDiffDirectories,
    missionInspectorPaneStyle,
    setProjectFileFilter,
    toggleProjectFileDirectory,
    defaultLogbookVisibleLimit,
    agentModelOptions = {},
  } = props;
  const [pendingAcpReconnects, setPendingAcpReconnects] = useState<Record<string, string | null>>({});
  const [selectedCommitDiffPaths, setSelectedCommitDiffPaths] = useState<Set<string>>(() => new Set());
  const {
    canSend,
    activeSessionRestoreGate,
    activeMissionHelm,
    activeDiffs,
    activeOutputs,
    activeToolCalls,
    activeSessionStatus,
    pendingToolActivity,
    missionActivityLoading,
    missionDiffCount,
    missionLogCount,
    missionStatusLabel,
    missionPanelPages,
    selectedMissionPanelPage,
    projectFilesScope,
    projectFilesEntry,
    projectFiles,
    overviewProject,
    overviewProjectName,
    overviewWorktreeName,
    overviewAgentName,
    currentGitBranch,
    projectOverviewItems,
    visibleProjectFiles,
    sessionExecutionPending,
    composerModelLoading,
  } = buildMissionWorktreeModel(props);
  const hasWorktreeScope = Boolean(activeSession || selectedProjectId);
  const toggleMissionThinking = () => {
    props.updateTechnicalPanelPreference?.(
      "showMissionThinking",
      !technicalPanels.showMissionThinking,
    );
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
  });
  const openSessionResumeCheckRef = useRef<Set<string>>(new Set());
  const openSessionTopicSubscriptionsRef = useRef<Set<string>>(new Set());
  const pendingDraftWindowRef = useRef<typeof draftChatWindow>(null);
  const sessionById = new Map((sessions as SessionSummary[]).map((session) => [session.id, session]));
  const effectiveSelectedAgentId = focusedDraftWindow?.agentId ?? selectedAgentId;
  const effectiveSelectedCwd = focusedDraftWindow?.cwd ?? selectedCwd;
  const effectiveSelectedDraftAgent = (agents as any[]).find((agent) => agent.id === effectiveSelectedAgentId) ?? selectedDraftAgent;
  const effectiveSelectedWorktree = (draftWorktreeOptions as any[]).find(
    (worktree) => normalizeWorktreePath(worktree.path) === normalizeWorktreePath(effectiveSelectedCwd ?? undefined),
  ) ?? selectedWorktree;
  const effectiveSelectedWorktreeName = effectiveSelectedWorktree?.name ?? selectedWorktreeName;
  const openSessionStreamKey = openSessions.map((session) => session.id).join("|");
  useEffect(() => {
    const client = rpcClientRef.current;
    if (
      pairingState !== "paired" ||
      !client ||
      client.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const nextSessionIds = new Set(openSessions.map((session) => session.id));
    const subscribedSessionIds = openSessionTopicSubscriptionsRef.current;

    subscribedSessionIds.forEach((sessionId) => {
      if (!nextSessionIds.has(sessionId)) {
        subscribedSessionIds.delete(sessionId);
        void unsubscribeFromSessionTopic(client, sessionId, dispatch);
      }
    });
    nextSessionIds.forEach((sessionId) => {
      if (!subscribedSessionIds.has(sessionId)) {
        subscribedSessionIds.add(sessionId);
        void subscribeToSessionTopic(client, sessionId, dispatch);
      }
    });

    return () => {
      nextSessionIds.forEach((sessionId) => {
        if (client.socket.readyState === WebSocket.OPEN) {
          void unsubscribeFromSessionTopic(client, sessionId, dispatch);
        }
        subscribedSessionIds.delete(sessionId);
      });
    };
  }, [openSessionStreamKey, pairingState]);
  const hydrateOpenSessionStreams = (sessionIds: string[]) => {
    const client = rpcClientRef.current;
    if (
      pairingState !== "paired" ||
      !client ||
      client.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    const uniqueSessionIds = [...new Set(sessionIds)];
    const messageSessionIds = uniqueSessionIds.filter((sessionId) => (
      !messageHistoryState[sessionId] && !messages?.[sessionId]?.length
    ));
    const activitySessionIds = uniqueSessionIds.filter((sessionId) => (
      !activityHistoryState[sessionId] &&
      !outputs?.[sessionId]?.length &&
      !toolCalls?.[sessionId]?.length
    ));
    const resumeCheckSessionIds = uniqueSessionIds.filter((sessionId) => {
      const session = sessionById.get(sessionId);
      return Boolean(
        session &&
          session.status !== "running" &&
          session.resume?.state !== "resume-unavailable" &&
          !openSessionResumeCheckRef.current.has(sessionId),
      );
    });

    if (messageSessionIds.length > 0) {
      setMessageHistoryState((current: any) => {
        const next = { ...current };
        messageSessionIds.forEach((sessionId) => {
          if (!next[sessionId]) {
            next[sessionId] = { hasMore: false, loading: true };
          }
        });
        return next;
      });
      messageSessionIds.forEach((sessionId) => {
        void dispatch(client, "session/list_messages", {
          sessionId,
          limit: DEFAULT_MESSAGE_PAGE_LIMIT,
        });
      });
    }

    if (activitySessionIds.length > 0) {
      setActivityHistoryState((current: any) => {
        const next = { ...current };
        activitySessionIds.forEach((sessionId) => {
          if (!next[sessionId]) {
            next[sessionId] = { hasMore: false, loading: true };
          }
        });
        return next;
      });
      activitySessionIds.forEach((sessionId) => {
        void dispatch(client, "session/get_artifacts", {
          sessionId,
          limit: DEFAULT_ACTIVITY_PAGE_LIMIT,
        });
      });
    }

    resumeCheckSessionIds.forEach((sessionId) => {
      openSessionResumeCheckRef.current.add(sessionId);
      void dispatch(client, "session/check_resume", { sessionId });
    });
  };
  useEffect(() => {
    hydrateOpenSessionStreams(openSessions.map((session) => session.id));
  }, [
    openSessionStreamKey,
    pairingState,
    messageHistoryState,
    activityHistoryState,
    messages,
    outputs,
    toolCalls,
    sessions,
  ]);
  useEffect(() => {
    setOpenChatSessionIds((current: string[]) => {
      const existingSessionIds = new Set((sessions as SessionSummary[]).map((session) => session.id));
      const retained = current.filter((sessionId) => existingSessionIds.has(sessionId));
      if (!activeSession?.id || retained.includes(activeSession.id)) {
        return retained.length === current.length ? current : retained;
      }
      return [...retained, activeSession.id];
    });
  }, [activeSession?.id, sessions]);
  useEffect(() => {
    if (activeSession?.id && !focusedChatWindowId) {
      setFocusedChatWindowId(`session:${activeSession.id}`);
    }
  }, [activeSession?.id, focusedChatWindowId]);
  useEffect(() => {
    if (!focusedDraftWindow) {
      return;
    }
    if (focusedDraftWindow.projectId !== selectedProjectId) {
      setSelectedProjectId(focusedDraftWindow.projectId);
    }
    if (focusedDraftWindow.cwd !== selectedCwd) {
      setSelectedCwd(focusedDraftWindow.cwd);
    }
    if (focusedDraftWindow.agentId && focusedDraftWindow.agentId !== selectedAgentId) {
      setSelectedAgentId(focusedDraftWindow.agentId);
    }
  }, [focusedDraftWindow?.projectId, focusedDraftWindow?.cwd, focusedDraftWindow?.agentId, selectedProjectId, selectedCwd, selectedAgentId]);
  const openChatSession = (sessionId: string) => {
    setOpenChatSessionIds((current: string[]) => (current.includes(sessionId) ? current : [...current, sessionId]));
    setFocusedChatWindowId(`session:${sessionId}`);
    hydrateOpenSessionStreams([sessionId]);
    if (sessionId !== activeSessionId) {
      openSession(sessionId);
    }
  };
  const selectChatSession = (sessionId: string) => {
    setOpenChatSessionIds((current: string[]) => (current.includes(sessionId) ? current : [...current, sessionId]));
    setFocusedChatWindowId(`session:${sessionId}`);
    if (sessionId !== activeSessionId) {
      openSession(sessionId);
    }
  };
  const closeChatSession = (session: SessionSummary) => {
    setOpenChatSessionIds((current: string[]) => {
      const next = current.filter((sessionId) => sessionId !== session.id);
      if (focusedRealSessionId === session.id) {
        setFocusedChatWindowId(next.at(-1) ? `session:${next.at(-1)}` : null);
      }
      if (activeSessionId === session.id) {
        const nextActiveSessionId = next.at(-1) ?? null;
        if (nextActiveSessionId) {
          openSession(nextActiveSessionId);
        } else {
          setActiveSessionId(null);
        }
      }
      return next;
    });
  };
  const openDraftChatWindow = ({
    projectId,
    cwd,
    agentId = null,
  }: {
    projectId: string;
    cwd: string | null;
    agentId?: string | null;
  }) => {
    const project = projects.find((item: any) => item.id === projectId);
    const draftWindow = {
      id: `draft:${projectId}`,
      projectId,
      cwd,
      agentId,
    };
    setDraftChatWindow?.(draftWindow);
    setFocusedChatWindowId(draftWindow.id);
    setActiveSessionId(null);
    setSelectedMissionHelmId(project?.helmId ?? null);
    setSelectedProjectId(projectId);
    setSelectedCwd(cwd);
    setSelectedAgentId(agentId);
    setActiveSessionId(null);
    setSelectedMissionMobilePane("chat");
  };
  const selectAgentForDraftWindow = (agentId: string) => {
    const focusedDraftWindowId = draftChatWindow?.id ?? (selectedProjectId ? `draft:${selectedProjectId}` : null);
    setDraftChatWindow?.((current: any) => (current ? { ...current, agentId } : current));
    if (focusedDraftWindowId) {
      setFocusedChatWindowId(focusedDraftWindowId);
    }
    setActiveSessionId(null);
    selectDraftAgent(agentId);
  };
  const submitPromptFromFocusedWindow = (event: FormEvent<HTMLFormElement>, targetSession?: SessionSummary | null) => {
    if (focusedDraftWindow) {
      pendingDraftWindowRef.current = draftChatWindow;
    }
    submitPrompt(event, targetSession);
  };
  useEffect(() => {
    const pendingDraftWindow = pendingDraftWindowRef.current;
    if (!pendingDraftWindow || !activeSession?.id) {
      return;
    }
    const sameProject = activeSession.projectId === pendingDraftWindow.projectId;
    const sameCwd = normalizeWorktreePath(activeSession.cwd) === normalizeWorktreePath(pendingDraftWindow.cwd ?? undefined);
    const sameAgent = !pendingDraftWindow.agentId || activeSession.agentId === pendingDraftWindow.agentId;
    if (!sameProject || !sameCwd || !sameAgent) {
      return;
    }
    pendingDraftWindowRef.current = null;
    setDraftChatWindow?.(null);
    setOpenChatSessionIds((current: string[]) => (
      current.includes(activeSession.id) ? current : [...current, activeSession.id]
    ));
    setFocusedChatWindowId(`session:${activeSession.id}`);
  }, [activeSession?.id, activeSession?.projectId, activeSession?.cwd, activeSession?.agentId, draftChatWindow]);
  const onToggleDisplay = () => {
    setMissionDisplayCollapsed((current: boolean) => !current);
  };
  const onToggleInspector = () => {
    setMissionInspectorCollapsed((current: boolean) => !current);
  };
  const rawWorktreeOptions = hasWorktreeScope
    ? draftWorktreeOptions.length
      ? draftWorktreeOptions
      : selectedWorktree
        ? [selectedWorktree]
        : []
    : [];
  const worktreeOptions = rawWorktreeOptions.filter(isManagedWorktreeWorktree);
  const selectedSessionWorktreeItems = (() => {
    const sourceSessions = openSessions.length ? openSessions : activeSession ? [activeSession] : [];
    const byCwd = new Map<
      string,
      {
        branchName: string;
        cwd: string;
        sessionCount: number;
        sessionTitles: string[];
      }
    >();

    for (const session of sourceSessions) {
      if (!session.cwd) {
        continue;
      }
      const cwdKey = normalizeWorktreePath(session.cwd) ?? session.cwd;
      const activeCwd = activeSession?.cwd ? normalizeWorktreePath(activeSession.cwd) : null;
      const branchName =
        session.worktreeName ??
        (activeCwd && cwdKey === activeCwd ? currentGitBranch : null) ??
        session.projectName ??
        "未检测分支";
      const existing = byCwd.get(cwdKey);
      if (existing) {
        existing.sessionCount += 1;
        continue;
      }
      byCwd.set(cwdKey, {
        branchName,
        cwd: session.cwd,
        sessionCount: 1,
        sessionTitles: [],
      });
    }

    return Array.from(byCwd.values());
  })();
  const inspectorWorktreeCount = selectedSessionWorktreeItems.length || worktreeOptions.length;
  const inspectorWorktreeSummaryLabel = selectedSessionWorktreeItems.length
    ? `${selectedSessionWorktreeItems
        .slice(0, 2)
        .map((item) => item.branchName)
        .join(" / ")}${selectedSessionWorktreeItems.length > 2 ? ` +${selectedSessionWorktreeItems.length - 2}` : ""}`
    : `${worktreeOptions.length} Worktrees`;
  const renderWorktreeList = () => (
    <div className="mission-worktree-list grid gap-1">
      {selectedSessionWorktreeItems.length ? (
        selectedSessionWorktreeItems.map((item) => (
          <div
            key={normalizeWorktreePath(item.cwd)}
            className="rounded border border-border-ghost bg-surface px-3 py-2 text-sm"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Icon name="branch" size={11} className="text-muted-foreground" />
              <strong className="min-w-0 truncate text-foreground">{item.branchName}</strong>
            </div>
            <p className="mt-1 break-all font-mono text-[10px] leading-snug text-muted-foreground">
              {item.cwd}
            </p>
          </div>
        ))
      ) : worktreeOptions.length ? (
        worktreeOptions.map((worktree: any) => {
          const selected = normalizeWorktreePath(worktree.path) === normalizeWorktreePath(activeSession?.cwd ?? selectedCwd);
          return (
            <div
              key={worktree.path}
              className={joinClassNames([
                "bg-transparent px-3 py-2 text-sm",
                selected ? "bg-surface-emphasis/50" : "hover:bg-surface-emphasis/40",
              ])}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <strong className="block truncate text-foreground">{worktree.name ?? worktree.path}</strong>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="rounded border border-border-ghost px-2 py-1 text-xs text-muted-foreground hover:bg-surface-emphasis"
                    >
                      连接
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {agents.length ? (
                      agents.map((agent: any) => (
                        <DropdownMenuItem
                          key={agent.id}
                          onSelect={() => {
                            setSelectedCwd(worktree.path);
                            selectDraftAgent(agent.id);
                          }}
                        >
                          用 {agent.name ?? agent.id} 连接 ACP
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <DropdownMenuItem disabled>暂无可用 ACP Agent</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p className="mt-1 break-all text-xs text-muted-foreground">{worktree.path}</p>
            </div>
          );
        })
      ) : (
        <p className="subtle compact text-sm leading-relaxed text-muted-foreground">
          当前选中会话暂无 cwd / 分支记录。
        </p>
      )}
    </div>
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
  const renderInspectorDiffPanel = () => (
    <MissionDiffPanel
      selectedDiffFilePath={selectedMissionDiffFilePath}
      diffs={activeDiffs}
      noDiffSummary={copy.noDiffSummary}
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
  const resolvedMissionMobilePane = selectedMissionMobilePane ?? (activeSession ? "chat" : "project");
  const currentMobilePaneIndex = MISSION_MOBILE_PANE_ORDER.indexOf(resolvedMissionMobilePane);
  function selectAdjacentMissionMobilePane(direction: -1 | 1) {
    const nextIndex = Math.min(
      MISSION_MOBILE_PANE_ORDER.length - 1,
      Math.max(0, currentMobilePaneIndex + direction),
    );
    setSelectedMissionMobilePane(MISSION_MOBILE_PANE_ORDER[nextIndex]);
  }
  const hasSelectedDisplayDiff = Boolean(
    selectedMissionDiffFilePath || (openedMissionDiffFilePaths?.length ?? 0) > 0,
  );
  const displayPaneCollapsed = effectiveDisplayCollapsed || !hasSelectedDisplayDiff;
  const missionLayoutClassName = joinClassNames([
    "wb-pane shadow-ambient chat-layout chat-layout-sidebar mission-responsive-mode mission-grid h-[calc(100vh-16px)] min-h-[640px] w-full overflow-hidden",
    effectiveSidebarCollapsed && "mission-sidebar-collapsed",
    effectiveSidebarCollapsed && "sidebar-collapsed",
    displayPaneCollapsed && "mission-display-collapsed",
    displayPaneCollapsed && "display-collapsed",
    effectiveInspectorCollapsed && "mission-inspector-collapsed",
    effectiveInspectorCollapsed && "inspector-collapsed",
    isMissionMobile && "mission-mobile-mode",
    `mission-mobile-pane-${resolvedMissionMobilePane}`,
  ]);
  useEffect(() => {
    setPendingAcpReconnects((current) => {
      let changed = false;
      const next = { ...current };
      for (const connection of agentConnectionInventory as any[]) {
        const key = acpReconnectKey(connection.providerId, connection.cwd);
        if (
          key in next &&
          connection.status === "ready" &&
          connection.runtimeConnectionId !== next[key]
        ) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [agentConnectionInventory]);
  const runtimeOverviewItems = (() => {
    const sessionById = new Map((sessions as SessionSummary[]).map((session) => [session.id, session]));
    const items: any[] = (agentConnectionInventory as any[]).map((connection) => {
      const agent = (agents as any[]).find((item) => item.id === connection.providerId);
      const worktree = (worktrees ?? []).find(
        (item: any) => normalizeWorktreePath(item.path) === normalizeWorktreePath(connection.cwd),
      );
      const children = (connection.sessions ?? []).map((runtimeSession: any) => {
        const session = sessionById.get(runtimeSession.tillerSessionId) as any;
        const status = session ? (statuses[session.id] ?? session.status) : runtimeSession.status;
        const statusLabel = copy.status[status] ?? status;
        const projectName =
          projects.find((project: any) => project.id === session?.projectId)?.name ??
          session?.projectName ??
          "未选项目";
        return {
          id: runtimeSession.tillerSessionId,
          projectName,
          branchName: worktree?.name ?? session?.worktreeName ?? connection.worktreeName ?? connection.cwd,
          status: statusLabel,
          model: session?.model ?? runtimeSession.model,
          reasoningEffort: session?.reasoningEffort ?? runtimeSession.reasoningEffort,
        };
      });
      const reconnectKey = acpReconnectKey(connection.providerId, connection.cwd);
      const reconnectPending = reconnectKey in pendingAcpReconnects;
      return {
        id: `acp:${connection.providerId}:${connection.cwd}`,
        agentId: connection.providerId,
        projectId: selectedProjectId ?? undefined,
        cwd: connection.cwd,
        label: agent?.name ?? connection.providerId ?? "ACP",
        meta: reconnectPending ? "等待重新连接成功" : connection.lastError ?? worktree?.name ?? connection.cwd ?? "Worktree",
        status: reconnectPending ? "未连接" : formatAcpConnectionStatus(connection.status),
        runtimeSessionId: formatRuntimeSessionCount(
          connection.activeSessionCount ?? children.length,
          Math.max(0, (connection.activeSessionCount ?? children.length) - (connection.pendingSessionCount ?? 0)),
        ),
        model: children[0]?.model,
        reasoningEffort: children[0]?.reasoningEffort,
        canReconnect: !reconnectPending,
        canConnect: reconnectPending,
        children,
      };
    });

    if (activeSession?.agentId && activeSession.cwd) {
      const agent = (agents as any[]).find((item) => item.id === activeSession.agentId);
      const worktree = (worktrees ?? []).find(
        (item: any) => normalizeWorktreePath(item.path) === normalizeWorktreePath(activeSession.cwd),
      );
      const status = statuses[activeSession.id] ?? activeSession.status;
      items.push({
        id: `acp:${activeSession.agentId}:${activeSession.cwd}:active-session`,
        agentId: activeSession.agentId,
        projectId: activeSession.projectId ?? selectedProjectId ?? undefined,
        cwd: activeSession.cwd,
        label: agent?.name ?? activeSession.agentName ?? activeSession.agentId ?? "ACP",
        meta: worktree?.name ?? activeSession.worktreeName ?? activeSession.cwd,
        status: activeSessionRestoreGate.canChat ? "已连接" : "连接中",
        runtimeSessionId: formatRuntimeSessionCount(1, activeSessionRestoreGate.canChat ? 1 : 0),
        model: activeSession.model,
        reasoningEffort: activeSession.reasoningEffort,
        canReconnect: true,
        canConnect: false,
        children: [
          {
            id: activeSession.id,
            projectName: activeSession.projectName ?? "未选项目",
            branchName: worktree?.name ?? activeSession.worktreeName ?? activeSession.cwd,
            status: copy.status[status] ?? status,
            model: activeSession.model,
            reasoningEffort: activeSession.reasoningEffort,
          },
        ],
      });
    }

    for (const [key, entry] of Object.entries(agentModelOptions ?? {}) as Array<[string, any]>) {
      const [agentId, cwd] = key.split("::");
      if (!entry?.runtimeSessionId || items.some((item) => item.agentId === agentId && item.cwd === cwd)) {
        continue;
      }
      const agentName = agents.find((agent: any) => agent.id === agentId)?.name ?? agentId ?? "ACP";
      const worktreeName =
        draftWorktreeOptions.find((worktree: any) => worktree.path === cwd)?.name ??
        cwd ??
        "Worktree";
      items.push({
        id: `acp:${agentId}:${cwd}:prewarm`,
        agentId,
        cwd,
        label: agentName,
        meta: worktreeName,
        status: entry.loading ? "预热中" : "已预热",
        runtimeSessionId: `${worktreeName} · 预热连接`,
        model: entry.state?.model,
        reasoningEffort: entry.state?.reasoningEffort,
        canReconnect: true,
      });
    }

    const overviewConnectCwd = selectedCwd ?? activeSession?.cwd;
    for (const agent of agents as any[]) {
      const hasConnection = items.some((item) => item.agentId === agent.id);
      if (hasConnection) {
        continue;
      }
      items.push({
        id: `acp:${agent.id ?? agent.name ?? "acp"}`,
        agentId: agent.id,
        projectId: selectedProjectId ?? undefined,
        cwd: overviewConnectCwd ?? undefined,
        label: agent.name ?? agent.id ?? "ACP",
        meta: "暂无连接",
        status: "未连接",
        runtimeSessionId: "暂无连接",
        canConnect: Boolean(agent.id && overviewConnectCwd),
        canReconnect: false,
      });
    }

    const agentOrder = new Map(
      (agents as any[]).map((agent, index) => [agent.id, index]),
    );
    return dedupeRuntimeOverviewItems(items).sort(
      (left, right) =>
        (agentOrder.get(left.agentId) ?? Number.MAX_SAFE_INTEGER) -
          (agentOrder.get(right.agentId) ?? Number.MAX_SAFE_INTEGER) ||
        left.label.localeCompare(right.label),
    );
  })();
  const reconnectAcpRuntime = (runtime: {
    agentId?: string;
    projectId?: string;
    cwd?: string;
    canConnect?: boolean;
    canReconnect?: boolean;
  }) => {
    const client = rpcClientRef?.current;
    if (!runtime.agentId || !client || client.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const reconnectKey = acpReconnectKey(runtime.agentId, runtime.cwd);
    const currentConnection = (agentConnectionInventory as any[]).find(
      (connection) =>
        connection.providerId === runtime.agentId &&
        normalizeWorktreePath(connection.cwd) === normalizeWorktreePath(runtime.cwd),
    );
    setPendingAcpReconnects((current) => ({
      ...current,
      [reconnectKey]: currentConnection?.runtimeConnectionId ?? null,
    }));
    void dispatch?.(client, runtime.canReconnect ? "agent/reconnect" : "agent/connect", {
      providerId: runtime.agentId,
      projectId: runtime.projectId ?? selectedProjectId ?? undefined,
      cwd: runtime.cwd ?? selectedCwd ?? undefined,
    });
  };
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
  const shouldShowComposer = Boolean(helmConnected && (activeSession || draftChatWindow));
  const shouldShowDraftPreparing = Boolean(helmConnected && !activeSession && selectedAgentId && !selectedDraftConnection);
  const shouldShowRestoreGateNotice = Boolean(
    helmConnected && activeSession && !activeSessionRestoreGate.canChat && activeSessionRestoreGate.message,
  );
  const composerPromptPlaceholder = shouldShowRestoreGateNotice
    ? activeSessionRestoreGate.message
    : draftPromptPlaceholder;
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
        {isMissionMobile || !effectiveSidebarCollapsed ? (
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
          agents={agents}
          runtimeOverviewItems={runtimeOverviewItems}
          selectedAgentId={selectedAgentId}
          agentPickerOpen={agentPickerOpen}
          selectDraftAgent={selectAgentForDraftWindow}
          openDraftChatWindow={openDraftChatWindow}
          setSelectedMissionHelmId={setSelectedMissionHelmId}
          setSelectedProjectId={setSelectedProjectId}
          setSelectedCwd={setSelectedCwd}
          setSelectedAgentId={setSelectedAgentId}
          setAgentPickerOpen={setAgentPickerOpen}
          setExpandedMissionProjectIds={setExpandedMissionProjectIds}
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
          resizer={null}
        />{" "}
          </ResizablePanel>
        ) : null}
        {!isMissionMobile && !effectiveSidebarCollapsed ? (
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
          }}
          onSelectDraftAgent={selectAgentForDraftWindow}
          onCloseDraftWindow={() => {
            setDraftChatWindow?.(null);
            setFocusedChatWindowId(persistedOpenChatSessionIds.at(-1) ? `session:${persistedOpenChatSessionIds.at(-1)}` : null);
          }}
          selectedSessionId={focusedDraftWindow ? null : focusedRealSessionId ?? activeSession?.id ?? null}
          activeSessionMessages={activeSessionMessages}
          sessionMessagesById={messages ?? {}}
          activeSessionToolCalls={activeToolCalls}
          sessionToolCallsById={toolCalls ?? {}}
          copy={copy}
          expandedMessageIds={expandedMessageIds}
          messageHistoryState={messageHistoryState}
          activityHistoryState={activityHistoryState}
          onLoadOlderMessages={loadOlderMessages}
          onToggleExpandedMessage={toggleExpandedMessage}
          activityLoading={missionActivityLoading}
          pendingToolPresent={Boolean(pendingToolActivity)}
          pendingApprovals={pendingApprovals}
          pendingToolTitle={pendingToolActivity?.title ?? null}
          showPermissionWorktree={technicalPanels.showPermissionWorktree}
          displayCollapsed={displayPaneCollapsed}
          inspectorCollapsed={effectiveInspectorCollapsed}
          sidebarCollapsed={effectiveSidebarCollapsed}
          showThinking={technicalPanels.showMissionThinking}
          onExpandSidebar={() => setMissionSidebarCollapsed(false)}
          onToggleDisplay={onToggleDisplay}
          onToggleInspector={onToggleInspector}
          onToggleThinking={toggleMissionThinking}
          onFocusSession={openChatSession}
          onSelectSessionView={selectChatSession}
          onRenameSession={regenerateSessionTitle}
          onCloseSessionView={closeChatSession}
          onClearSession={setPendingSessionCleanup}
          onReimportSessionHistory={setPendingSessionHistoryReimport}
          onRespondToPermission={respondToPermission}
          promptQueue={activePromptQueue}
          restoreNotice={shouldShowRestoreGateNotice ? {
            title: activeSessionRestoreGate.state === "history-only" || activeSessionRestoreGate.state === "failed"
              ? "ACP 会话未恢复"
              : "正在恢复 ACP",
            message: activeSessionRestoreGate.message,
          } : undefined}
          onUpdateQueuedPrompt={updateQueuedPrompt}
          onDeleteQueuedPrompt={deleteQueuedPrompt}
        >
          {shouldShowDraftPreparing ? (
            <div className="mission-draft-preparing m-3 rounded-xl border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">
              <strong className="block text-foreground">正在连接 ACP</strong>
              <span>
                {effectiveSelectedDraftAgent?.name ?? "ACP Agent"} {draftConnectionEntry?.message ?? "正在启动连接，连接成功后将显示输入框。"}
              </span>
            </div>
          ) : null}
          {shouldShowComposer ? (
            <MissionComposer
              activeSession={activeSession}
              contextSession={selectedComposerSession}
              worktreePickerRef={worktreePickerRef}
              worktreePickerOpen={worktreePickerOpen}
              setWorktreePickerOpen={setWorktreePickerOpen}
              agentPickerRef={agentPickerRef}
              agentPickerOpen={agentPickerOpen}
              setAgentPickerOpen={setAgentPickerOpen}
              selectedWorktreeName={effectiveSelectedWorktreeName}
              draftWorktreeOptions={draftWorktreeOptions}
              selectedCwd={effectiveSelectedCwd}
              selectDraftWorktree={selectDraftWorktree}
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
              modelSettingsLocked={Boolean(activeSession && !activeSessionRestoreGate.canChat)}
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
              sessionCanCancel={sessionExecutionPending && activeSessionStatus !== "starting"}
              cancelSession={cancelSession}
              canSend={canSend}
            />
          ) : null}{" "}
        </MissionChatPane>{" "}
        </ResizablePanel>
        {!isMissionMobile && !displayPaneCollapsed ? (
          <ResizableHandle
            className="mission-pane-resizer mission-pane-resizer-display w-px bg-transparent hover:bg-primary-soft/20"
            aria-label="调整任务展示宽度"
          />
        ) : null}
        {isMissionMobile || !displayPaneCollapsed ? (
          <ResizablePanel
            id="mission-display"
            defaultSize="320px"
            minSize="0px"
            className="h-full min-w-0"
          >
        <MissionDisplaySection
            style={missionDisplayPaneStyle}
            pages={missionPanelPages}
            selectedPage={selectedMissionPanelPage}
            overviewItems={projectOverviewItems}
            runtimeOverviewItems={runtimeOverviewItems}
            currentModelSummary={`当前模型：${draftModelPickerLabel} · 推理：${resolveReasoningLabel(effectiveDraftReasoningEffort)}`}
            openedDiffFilePaths={openedMissionDiffFilePaths ?? []}
            selectedDiffFilePath={selectedMissionDiffFilePath}
            diffs={activeDiffs}
            noDiffSummary={copy.noDiffSummary}
            onReconnectRuntime={reconnectAcpRuntime}
            activeSession={activeSession}
            sessionToolCalls={activeToolCalls}
            commandChunks={activeOutputs}
            sessionMessages={activeSessionMessages}
            historyState={
              activeSession ? activityHistoryState[activeSession.id] : undefined
            }
            visibleCount={
              activeSession
                ? (activityVisibleCounts[activeSession.id] ??
                  defaultLogbookVisibleLimit)
                : defaultLogbookVisibleLimit
            }
            visibleLimit={defaultLogbookVisibleLimit}
            copy={copy}
            onShowMore={(targetSessionId, nextVisibleCount) =>
              setActivityVisibleCounts((current: any) => ({
                ...current,
                [targetSessionId]: nextVisibleCount,
              }))
            }
            onLoadOlder={loadOlderActivities}
            onAddPage={addMissionPanelPage}
            onSelectPage={setSelectedMissionPanelPageId}
            onDragStart={setDraggedMissionPanelPageId}
            onDrop={dropMissionPanelPage}
            onRenamePage={renameMissionPanelPage}
            onMovePage={moveMissionPanelPage}
            onDeletePage={deleteMissionPanelPage}
            onOpenDiffDetail={openDiffDetail}
            onCloseDiffFile={closeMissionDiffFile}
            onCollapse={onToggleDisplay}
        />{" "}
          </ResizablePanel>
        ) : null}
        {!isMissionMobile && !effectiveInspectorCollapsed ? (
          <ResizableHandle
            className="mission-pane-resizer mission-pane-resizer-inspector w-px bg-transparent hover:bg-primary-soft/20"
            aria-label="调整检视器宽度"
          />
        ) : null}
        {isMissionMobile || !effectiveInspectorCollapsed ? (
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
          worktreeCount={inspectorWorktreeCount}
          worktreeSummaryLabel={inspectorWorktreeSummaryLabel}
          worktreeList={renderWorktreeList()}
          diffCount={missionDiffCount}
          selectedDiffCount={selectedCommitDiffPaths.size}
          diffPanel={renderInspectorDiffPanel()}
          onCollapse={onToggleInspector}
          resizer={null}
        />{" "}
          </ResizablePanel>
        ) : null}
        {isMissionMobile ? (
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
        <MissionMobilePager
          selectedPane={resolvedMissionMobilePane}
          onSelectPane={setSelectedMissionMobilePane}
        />
      </ResizablePanelGroup>{" "}
    </MissionPage>
  );
}

function isManagedWorktreeWorktree(worktree: { path?: string }) {
  const normalizedPath = worktree.path?.replace(/\\/g, "/") ?? "";
  return Boolean(
    normalizedPath.includes("/.worktrees/") ||
      normalizedPath.includes("/.tiller/worktrees/"),
  );
}

function acpReconnectKey(agentId?: string, cwd?: string) {
  return `${agentId ?? "unknown"}::${cwd ?? "global"}`;
}

function normalizeWorktreePath(path: string | undefined) {
  return path?.replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
}

function formatRuntimeSessionCount(sessionCount: number, activeSessionCount?: number) {
  const base = `${sessionCount} 个会话`;
  if (activeSessionCount === undefined || activeSessionCount === sessionCount) {
    return base;
  }
  return `${base} · ${activeSessionCount} 活跃`;
}

function formatAcpConnectionStatus(status: string) {
  switch (status) {
    case "ready":
      return "已连接";
    case "opening":
      return "连接中";
    case "error":
      return "连接异常";
    case "closed":
      return "已关闭";
    default:
      return status || "未知";
  }
}
