import type { FileDiffSummary, SessionSummary } from "@tiller/shared";
import { useState } from "react";
import { MissionChatPane } from "../conversation";
import { MissionComposer } from "../composer";
import { MissionDiffPanel, MissionDisplaySection } from "../display";
import { MissionInspector } from "../inspector";
import { MissionMobilePager } from "./mobile-pager";
import {
  MISSION_MOBILE_PANE_ORDER,
  selectAdjacentMissionMobilePane as resolveAdjacentMissionMobilePane,
} from "./mobile-pane";
import { useChatWindowActions } from "./chat-window-actions";
import { MissionPage } from "./page";
import {
  buildDraftPreparingMessage,
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
  isManagedWorktreeWorktree,
  normalizeWorktreePath,
} from "./runtime-display";
import {
  buildSelectedSessionWorktreeItems,
  formatInspectorWorktreeSummaryLabel,
} from "./worktree-summary";
import { joinClassNames } from "../utils/session-render-state";

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
    sessionTimeline,
    sessionPlans = {},
    dismissedCompletedSessionPlanKeys = {},
    setDismissedCompletedSessionPlanKeys,
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
  const hydrateOpenSessionStreams = useOpenSessionStreams({
    pairingState,
    rpcClientRef,
    dispatch,
    openSessions,
    sessions: sessions as SessionSummary[],
    messageHistoryState,
    activityHistoryState,
    messagesBySession: messages,
    sessionTimelineBySession: sessionTimeline,
    outputsBySession: outputs,
    toolCallsBySession: toolCalls,
    sessionPlansBySession: sessionPlans,
    setMessageHistoryState,
    setActivityHistoryState,
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
    if (!hasSelectedDisplayDiff) {
      return;
    }
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
  const selectedSessionWorktreeItems = buildSelectedSessionWorktreeItems({
    sessions: openSessions,
    activeSession,
    currentGitBranch,
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
  const inspectorWorktreeCount = selectedSessionWorktreeItems.length || worktreeOptions.length;
  const inspectorWorktreeSummaryLabel = formatInspectorWorktreeSummaryLabel(
    selectedSessionWorktreeItems,
    worktreeOptions.length,
  );
  const renderWorktreeList = () => (
    <MissionWorktreeList
      selectedSessionWorktreeItems={selectedSessionWorktreeItems}
      worktreeOptions={worktreeOptions}
      selectedCwd={selectedCwd}
      activeSessionCwd={activeSession?.cwd}
      agents={agents}
      onSelectCwd={setSelectedCwd}
      onSelectDraftAgent={selectDraftAgent}
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
    setSelectedMissionMobilePane(resolveAdjacentMissionMobilePane(resolvedMissionMobilePane, direction));
  }
  const hasSelectedDisplayDiff = activeDiffs.some(
    (file: FileDiffSummary) =>
      file.path === selectedMissionDiffFilePath ||
      (openedMissionDiffFilePaths ?? []).includes(file.path),
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
  const shouldShowComposer = Boolean(helmConnected && (activeSession || draftChatWindow));
  const shouldShowDraftPreparing = Boolean(helmConnected && !activeSession && selectedAgentId && !selectedDraftConnection);
  const shouldShowRestoreGateNotice = Boolean(
    helmConnected && activeSession && !activeSessionRestoreGate.canChat && activeSessionRestoreGate.message,
  );
  const composerPromptPlaceholder = shouldShowRestoreGateNotice
    ? activeSessionRestoreGate.message
    : draftPromptPlaceholder;
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
          selectedSessionId={missionChatSelectedSessionId}
          activeSessionMessages={activeSessionMessages}
          sessionMessagesById={messages ?? {}}
            sessionTimelineById={sessionTimeline ?? {}}
            activeSessionPlan={activeSessionPlan}
            sessionPlansById={sessionPlans ?? {}}
            dismissedCompletedSessionPlanKeys={dismissedCompletedSessionPlanKeys}
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
          canToggleDisplay={hasSelectedDisplayDiff}
          projectOptions={workbenchProjectOptions}
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
            onReimportSessionHistory={setPendingSessionHistoryReimport}
            onDismissCompletedSessionPlan={dismissCompletedSessionPlan}
            onRespondToPermission={respondToPermission}
          promptQueue={activePromptQueue}
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
              activeSession={activeSession}
              contextSession={selectedComposerSession}
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
