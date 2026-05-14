import { useEffect, useState } from "react";
import { MissionChatPane } from "./chat-pane";
import { MissionComposer } from "./composer";
import { MissionDiffPanel } from "./diff-panel";
import { MissionDisplaySection } from "./display-section";
import { MissionInspector } from "./inspector";
import { MissionMobilePager } from "./mobile-pager";
import { MissionPage } from "./page";
import { MissionPaneResizer } from "./pane-resizer";
import { MissionSidebar } from "./sidebar";
import { buildMissionWorktreeModel } from "./workspace-model";
import { dedupeRuntimeOverviewItems } from "./workspace-runtime-overview";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/ui";
import { joinClassNames } from "../utils/session-render-state";

const MISSION_MOBILE_PANE_ORDER = ["project", "chat", "display", "inspector"] as const;

export function MissionWorktree(props: any) {
  const {
    prompt,
    promptImages,
    rpcClientRef,
    dispatch,
    socketRef,
    activeSessionId,
    selectedProjectId,
    selectedCwd,
    selectedAgentId,
    activeSession,
    diffs,
    outputs,
    toolCalls,
    statuses,
    copy,
    customMissionPanelPages,
    selectedMissionPanelPageId,
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
    sessionHistoryState,
    toggleMissionProjectNode,
    startMissionPaneResize,
    nudgeMissionPane,
    missionChatPaneStyle,
    chatMainRef,
    handleChatMainScroll,
    pairingState,
    activeSessionMessages,
    expandedMessageIds,
    messageHistoryState,
    loadOlderMessages,
    toggleExpandedMessage,
    pendingPermission,
    pendingApprovals,
    technicalPanels,
    respondToPermission,
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
  } = buildMissionWorktreeModel(props);
  const hasWorktreeScope = Boolean(activeSession || selectedProjectId);
  const rawWorktreeOptions = hasWorktreeScope
    ? draftWorktreeOptions.length
      ? draftWorktreeOptions
      : selectedWorktree
        ? [selectedWorktree]
        : []
    : [];
  const worktreeOptions = rawWorktreeOptions.filter(isManagedWorktreeWorktree);
  const renderWorktreeList = () => (
    <div className="mission-worktree-list grid gap-2">
      {worktreeOptions.length ? (
        worktreeOptions.map((worktree: any) => {
          const selected = normalizeWorktreePath(worktree.path) === normalizeWorktreePath(activeSession?.cwd ?? selectedCwd);
          return (
            <div
              key={worktree.path}
              className={joinClassNames([
                "rounded-lg border border-border-ghost bg-surface-sunken p-3 text-sm",
                selected ? "border-primary/50 bg-primary-soft/30" : "",
              ])}
            >
              <div className="flex items-center justify-between gap-3">
                <strong className="min-w-0 truncate text-foreground">{worktree.name}</strong>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-surface-emphasis hover:text-foreground"
                      aria-label={`${worktree.name} 的 Worktree 操作`}
                      title="Worktree 操作"
                    >
                      ⋯
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    {filteredAgents.length ? (
                      filteredAgents.map((agent: any) => (
                        <DropdownMenuItem
                          key={`${worktree.path}:${agent.id}`}
                          onSelect={() => {
                            setActiveSessionId(null);
                            selectDraftWorktree(worktree.path);
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
当前项目暂无 Tiller Worktree 记录。
        </p>
      )}
    </div>
  );
  const renderInspectorDiffPanel = () => (
    <MissionDiffPanel
      selectedDiffFilePath={selectedMissionDiffFilePath}
      diffs={activeDiffs}
      noDiffSummary={copy.noDiffSummary}
      collapsedDiffDirectories={collapsedMissionDiffDirectories}
      onOpenDiffDetail={openDiffDetail}
      onToggleDiffDirectory={toggleMissionDiffDirectory}
    />
  );
  const chatPaneClassName = joinClassNames([
    "chat-conversation mission-pane mission-pane-chat relative col-start-3 col-end-4 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-ghost bg-surface shadow-none",
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
  const missionLayoutClassName = joinClassNames([
    "card surface-card chat-layout chat-layout-sidebar mission-responsive-mode grid h-[calc(100vh-20px)] min-h-[640px] w-full grid-cols-[var(--mission-sidebar-width)_var(--mission-sidebar-resizer-width)_minmax(0,var(--mission-chat-width))_var(--mission-display-resizer-width)_var(--mission-display-width)_var(--mission-inspector-resizer-width)_var(--mission-inspector-width)] gap-0 overflow-hidden rounded-lg border border-border-ghost bg-surface/80 p-1 shadow-ambient",
    effectiveSidebarCollapsed && "mission-sidebar-collapsed",
    effectiveDisplayCollapsed && "mission-display-collapsed",
    effectiveInspectorCollapsed && "mission-inspector-collapsed",
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
    const sessionById = new Map((sessions as any[]).map((session) => [session.id, session]));
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
        canReconnect: true,
        canConnect: false,
        children: [
          {
            id: activeSession.id,
            projectName: activeSession.projectName ?? "未选项目",
            branchName: worktree?.name ?? activeSession.worktreeName ?? activeSession.cwd,
            status: copy.status[status] ?? status,
            model: activeSession.model,
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
        canReconnect: true,
      });
    }

    for (const agent of agents as any[]) {
      const hasConnection = items.some((item) => item.agentId === agent.id);
      if (hasConnection) {
        continue;
      }
      items.push({
        id: `acp:${agent.id ?? agent.name ?? "acp"}`,
        agentId: agent.id,
        projectId: selectedProjectId ?? undefined,
        cwd: selectedCwd ?? undefined,
        label: agent.name ?? agent.id ?? "ACP",
        meta: "暂无连接",
        status: "未连接",
        runtimeSessionId: "暂无连接",
        canConnect: Boolean(agent.id && selectedCwd),
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
  const selectedDraftConnection = !activeSession && selectedAgentId && selectedCwd
    ? (agentConnectionInventory as any[]).find(
        (connection) =>
          connection.providerId === selectedAgentId &&
          normalizeWorktreePath(connection.cwd) === normalizeWorktreePath(selectedCwd) &&
          connection.initialized &&
          connection.status !== "closed" &&
          connection.status !== "error",
      )
    : null;
  const draftConnectionEntry = !activeSession && selectedAgentId && selectedCwd
    ? (agentModelOptions as Record<string, any>)[`${selectedAgentId}::${selectedCwd}::${selectedProjectId ?? "global"}`] ??
      Object.entries(agentModelOptions as Record<string, any>).find(
        ([key, entry]) => key.startsWith(`${selectedAgentId}::${selectedCwd}`) && entry?.loading,
      )?.[1]
    : null;
  const shouldShowComposer = Boolean(activeSession || selectedDraftConnection);
  const shouldShowDraftPreparing = Boolean(!activeSession && selectedAgentId && !selectedDraftConnection);
  const shouldShowRestoreGateNotice = Boolean(
    activeSession && !activeSessionRestoreGate.canChat && activeSessionRestoreGate.message,
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
      <>
        {" "}
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
          agents={agents}
          selectedAgentId={selectedAgentId}
          agentPickerOpen={agentPickerOpen}
          selectDraftAgent={selectDraftAgent}
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
          openSession={openSession}
          renderMissionAgentIcon={renderMissionAgentIcon}
          resolveDisplaySessionTitle={resolveDisplaySessionTitle}
          regenerateSessionTitle={regenerateSessionTitle}
          regeneratingIds={regeneratingIds}
          formatRelativeTime={formatRelativeTime}
          setPendingSessionCleanup={setPendingSessionCleanup}
          sessionHistoryState={sessionHistoryState}
          toggleMissionProjectNode={toggleMissionProjectNode}
          resizer={
            !isMissionMobile && !effectiveSidebarCollapsed ? (
              <MissionPaneResizer
                handle="sidebar"
                label="调整任务列表宽度"
                onResizeStart={startMissionPaneResize}
                onNudge={nudgeMissionPane}
              />
            ) : null
          }
        />{" "}
        <MissionChatPane
          className={chatPaneClassName}
          style={missionChatPaneStyle}
          chatMainRef={chatMainRef}
          onChatMainScroll={handleChatMainScroll}
          helmConnected={pairingState === "paired"}
          activeSession={activeSession}
          activeSessionMessages={activeSessionMessages}
          activeSessionToolCalls={activeToolCalls}
          copy={copy}
          expandedMessageIds={expandedMessageIds}
          messageHistoryState={messageHistoryState}
          onLoadOlderMessages={loadOlderMessages}
          onToggleExpandedMessage={toggleExpandedMessage}
          activityLoading={missionActivityLoading}
          pendingToolPresent={Boolean(pendingToolActivity)}
          pendingApprovals={pendingApprovals}
          pendingToolTitle={pendingToolActivity?.title ?? null}
          showPermissionWorktree={technicalPanels.showPermissionWorktree}
          onRespondToPermission={respondToPermission}
        >
          {shouldShowDraftPreparing ? (
            <div className="mission-draft-preparing m-3 rounded-xl border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">
              <strong className="block text-foreground">正在连接 ACP</strong>
              <span>
                {selectedDraftAgent?.name ?? "ACP Agent"} {draftConnectionEntry?.message ?? "正在启动连接，连接成功后将显示输入框。"}
              </span>
            </div>
          ) : null}
          {shouldShowRestoreGateNotice ? (
            <div className="mission-restore-gate m-3 rounded-xl border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">
              <strong className="block text-foreground">
                {activeSessionRestoreGate.state === "history-only" || activeSessionRestoreGate.state === "failed"
                  ? "ACP 会话未恢复"
                  : "正在恢复 ACP"}
              </strong>
              <span>{activeSessionRestoreGate.message}</span>
            </div>
          ) : null}
          {shouldShowComposer ? (
            <MissionComposer
              activeSession={activeSession}
              worktreePickerRef={worktreePickerRef}
              worktreePickerOpen={worktreePickerOpen}
              setWorktreePickerOpen={setWorktreePickerOpen}
              agentPickerRef={agentPickerRef}
              agentPickerOpen={agentPickerOpen}
              setAgentPickerOpen={setAgentPickerOpen}
              selectedWorktreeName={selectedWorktreeName}
              draftWorktreeOptions={draftWorktreeOptions}
              selectedCwd={selectedCwd}
              selectDraftWorktree={selectDraftWorktree}
              currentGitBranch={currentGitBranch}
              copy={copy}
              agentLocked={agentLocked}
              selectedDraftAgent={selectedDraftAgent}
              filteredAgents={filteredAgents}
              selectedAgentId={selectedAgentId}
              selectDraftAgent={selectDraftAgent}
              submitPrompt={submitPrompt}
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
              draftModelLoading={draftModelLoading}
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
        {!isMissionMobile && !effectiveDisplayCollapsed ? (
          <MissionPaneResizer
            handle="display"
            label="调整任务展示宽度"
            onResizeStart={startMissionPaneResize}
            onNudge={nudgeMissionPane}
          />
        ) : null}{" "}
        <MissionDisplaySection
            style={missionDisplayPaneStyle}
            pages={missionPanelPages}
            selectedPage={selectedMissionPanelPage}
            diffCount={missionDiffCount}
            logCount={missionLogCount}
            overviewItems={projectOverviewItems}
            runtimeOverviewItems={runtimeOverviewItems}
            selectedDiffFilePath={selectedMissionDiffFilePath}
            diffs={activeDiffs}
            noDiffSummary={copy.noDiffSummary}
            onReconnectRuntime={reconnectAcpRuntime}
            activeSession={activeSession}
            statusLabel={missionStatusLabel}
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
        />{" "}
        <MissionInspector
          collapsed={isMissionMobile ? false : effectiveInspectorCollapsed}
          style={missionInspectorPaneStyle}
          activeSessionPresent={Boolean(activeSession)}
          worktreeCount={worktreeOptions.length}
          worktreeList={renderWorktreeList()}
          diffCount={missionDiffCount}
          diffPanel={renderInspectorDiffPanel()}
          resizer={
            !isMissionMobile ? (
              <MissionPaneResizer
                handle="inspector"
                label="调整检视器宽度"
                onResizeStart={startMissionPaneResize}
                onNudge={nudgeMissionPane}
              />
            ) : null
          }
        />{" "}
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
      </>{" "}
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
