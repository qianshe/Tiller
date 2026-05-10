import { MissionChatPane } from "./chat-pane";
import { MissionComposer } from "./composer";
import { MissionDiffPanel } from "./diff-panel";
import { MissionDisplaySection } from "./display-section";
import { MissionInspector } from "./inspector";
import { MissionMobilePager } from "./mobile-pager";
import { MissionPage } from "./page";
import { MissionPaneResizer } from "./pane-resizer";
import { MissionSidebar } from "./sidebar";
import { buildMissionWorkspaceModel } from "./workspace-model";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/ui";
import { joinClassNames } from "../utils/session-render-state";

export function MissionWorkspace(props: any) {
  const {
    prompt,
    promptImages,
    rpcClientRef,
    dispatch,
    socketRef,
    activeSessionId,
    selectedProjectId,
    selectedWorkspaceId,
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
    selectedWorkspace,
    workspaces,
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
    setSelectedMissionHelmId,
    setSelectedProjectId,
    setSelectedWorkspaceId,
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
    startMissionMobileSwipe,
    finishMissionMobileSwipe,
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
    technicalPanels,
    respondToPermission,
    worktreePickerRef,
    worktreePickerOpen,
    setWorktreePickerOpen,
    agentPickerRef,
    agentPickerOpen,
    setAgentPickerOpen,
    selectedWorkspaceName,
    draftWorkspaceOptions,
    selectDraftWorkspace,
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
    draftPromptPlaceholder,
    slashPopupOpen,
    filteredSlashCommands,
    slashSelectedIndex,
    applySlashCommand,
    setSlashSelectedIndex,
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
    messages,
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
    agentModelOptions,
  } = props;
  const {
    canSend,
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
    overviewWorkspaceName,
    overviewAgentName,
    currentGitBranch,
    projectOverviewItems,
    visibleProjectFiles,
    sessionExecutionPending,
  } = buildMissionWorkspaceModel(props);
  const workspaceOptions = draftWorkspaceOptions.length
    ? draftWorkspaceOptions
    : selectedWorkspace
      ? [selectedWorkspace]
      : [];
  const projectWorktreeOptions = (workspaces ?? []).filter((workspace: any) =>
    isManagedWorktreeWorkspace(workspace),
  );
  const worktreeOptions = mergeWorkspaceOptions(
    workspaceOptions.filter(isManagedWorktreeWorkspace),
    projectWorktreeOptions,
  );
  const renderWorktreeList = () => (
    <div className="mission-worktree-list grid gap-2">
      {worktreeOptions.length ? (
        worktreeOptions.map((workspace: any) => {
          const selected = workspace.id === (activeSession?.workspaceId ?? selectedWorkspaceId);
          return (
            <div
              key={workspace.id}
              className={joinClassNames([
                "rounded-lg border border-border-ghost bg-surface-sunken p-3 text-sm",
                selected ? "border-primary/50 bg-primary-soft/30" : "",
              ])}
            >
              <div className="flex items-center justify-between gap-3">
                <strong className="min-w-0 truncate text-foreground">{workspace.name}</strong>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-surface-emphasis hover:text-foreground"
                      aria-label={`${workspace.name} 的 Worktree 操作`}
                      title="Worktree 操作"
                    >
                      ⋯
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    {filteredAgents.length ? (
                      filteredAgents.map((agent: any) => (
                        <DropdownMenuItem
                          key={`${workspace.id}:${agent.id}`}
                          onSelect={() => createDraftSessionForAgent(agent.id, workspace)}
                        >
                          用 {agent.name ?? agent.id} 创建会话
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <DropdownMenuItem disabled>暂无可用 ACP Agent</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p className="mt-1 break-all text-xs text-muted-foreground">{workspace.path}</p>
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
  const missionLayoutClassName = joinClassNames([
    "card surface-card chat-layout chat-layout-sidebar mission-responsive-mode grid h-[calc(100vh-20px)] min-h-[640px] w-full grid-cols-[var(--mission-sidebar-width)_var(--mission-sidebar-resizer-width)_minmax(0,var(--mission-chat-width))_var(--mission-display-resizer-width)_var(--mission-display-width)_var(--mission-inspector-resizer-width)_var(--mission-inspector-width)] gap-0 overflow-hidden rounded-lg border border-border-ghost bg-surface/80 p-1 shadow-ambient",
    effectiveSidebarCollapsed && "mission-sidebar-collapsed",
    effectiveDisplayCollapsed && "mission-display-collapsed",
    effectiveInspectorCollapsed && "mission-inspector-collapsed",
    isMissionMobile && "mission-mobile-mode",
    `mission-mobile-pane-${resolvedMissionMobilePane}`,
  ]);
  const runtimeOverviewItems = (() => {
    const grouped = new Map<string, any>();
    for (const session of sessions as any[]) {
      const status = statuses[session.id] ?? session.status;
      if (!session.runtimeSessionId) {
        continue;
      }
      const active = status !== "error" && status !== "cancelled";
      const key = String(session.agentId ?? session.agentName ?? "acp");
      const statusLabel = copy.status[status] ?? status;
      const projectName =
        projects.find((project: any) => project.id === session.projectId)?.name ??
        session.projectName ??
        "未选项目";
      const branchName = session.workspaceName ?? session.workspaceId ?? "默认分支";
      const child = {
        id: session.id,
        projectName,
        branchName,
        status: statusLabel,
        model: session.model,
      };
      const existing = grouped.get(key);
      if (existing) {
        existing.sessionCount += 1;
        existing.activeSessionCount += active ? 1 : 0;
        existing.children.push(child);
        continue;
      }
      grouped.set(key, {
        id: `acp:${key}`,
        agentId: session.agentId ?? key,
        projectId: session.projectId,
        workspaceId: session.workspaceId,
        label: session.agentName ?? session.agentId ?? "ACP",
        meta: `${projectName} · ${branchName} · ${statusLabel}`,
        status: "ACP",
        runtimeSessionId: "1 个会话",
        model: session.model,
        sessionCount: 1,
        activeSessionCount: active ? 1 : 0,
        children: [child],
      });
    }

    for (const [key, entry] of Object.entries(agentModelOptions ?? {}) as Array<[string, any]>) {
      const [agentId, workspaceId] = key.split("::");
      const groupKey = String(agentId ?? "acp");
      if (!entry?.runtimeSessionId || grouped.has(groupKey)) {
        continue;
      }
      const agentName = agents.find((agent: any) => agent.id === agentId)?.name ?? agentId ?? "ACP";
      const workspaceName =
        draftWorkspaceOptions.find((workspace: any) => workspace.id === workspaceId)?.name ??
        workspaceId ??
        "Workspace";
      grouped.set(groupKey, {
        id: `acp:${groupKey}`,
        agentId,
        workspaceId,
        label: agentName,

        meta: workspaceName,
        status: entry.loading ? "预热中" : "已预热",
        runtimeSessionId: `${workspaceName} · 预热连接`,
        model: entry.state?.model,
      });
    }

    for (const agent of agents as any[]) {
      const groupKey = String(agent.id ?? agent.name ?? "acp");
      if (grouped.has(groupKey)) {
        continue;
      }
      grouped.set(groupKey, {
        id: `acp:${groupKey}`,
        agentId: agent.id,
        projectId: selectedProjectId ?? undefined,
        workspaceId: selectedWorkspaceId ?? undefined,
        label: agent.name ?? agent.id ?? "ACP",
        meta: "暂无会话",
        status: "未连接",
        runtimeSessionId: "暂无会话",
      });
    }

    return Array.from(grouped.values()).map((item) => ({
      ...item,
      runtimeSessionId:
        typeof item.sessionCount === "number"
          ? formatRuntimeSessionCount(item.sessionCount, item.activeSessionCount)
          : item.runtimeSessionId,
    }));
  })();
  const reconnectAcpRuntime = (runtime: { agentId?: string; projectId?: string; workspaceId?: string }) => {
    const client = rpcClientRef?.current;
    if (!runtime.agentId || !client || client.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    void dispatch?.(client, "agent/reconnect", {
      providerId: runtime.agentId,
      projectId: runtime.projectId ?? selectedProjectId ?? undefined,
      workspaceId: runtime.workspaceId ?? selectedWorkspaceId ?? undefined,
    });
  };
  const shouldShowComposer = Boolean(activeSession);
  const shouldShowDraftPreparing = Boolean(!activeSession && selectedAgentId);
  return (
    <MissionPage
      layoutRef={missionLayoutRef}
      className={missionLayoutClassName}
      style={missionLayoutStyle}
      onPointerDown={startMissionMobileSwipe}
      onPointerUp={finishMissionMobileSwipe}
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
          createDraftSessionForAgent={createDraftSessionForAgent}
          setSelectedMissionHelmId={setSelectedMissionHelmId}
          setSelectedProjectId={setSelectedProjectId}
          setSelectedWorkspaceId={setSelectedWorkspaceId}
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
          pendingPermission={pendingPermission}
          pendingToolTitle={pendingToolActivity?.title ?? null}
          showPermissionWorkspace={technicalPanels.showPermissionWorkspace}
          onRespondToPermission={respondToPermission}
        >
          {shouldShowDraftPreparing ? (
            <div className="mission-draft-preparing m-3 rounded-xl border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">
              <strong className="block text-foreground">正在创建 ACP 会话</strong>
              <span>{selectedDraftAgent?.name ?? "ACP Agent"} 正在启动新会话，完成后将显示会话输入框。</span>
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
              selectedWorkspaceName={selectedWorkspaceName}
              draftWorkspaceOptions={draftWorkspaceOptions}
              selectedWorkspaceId={selectedWorkspaceId}
              selectDraftWorkspace={selectDraftWorkspace}
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
              draftPromptPlaceholder={draftPromptPlaceholder}
              slashPopupOpen={slashPopupOpen}
              filteredSlashCommands={filteredSlashCommands}
              slashSelectedIndex={slashSelectedIndex}
              applySlashCommand={applySlashCommand}
              setSlashSelectedIndex={setSlashSelectedIndex}
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
            sessionMessages={
              activeSession ? (messages[activeSession.id] ?? []) : []
            }
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
        <MissionMobilePager
          selectedPane={resolvedMissionMobilePane}
          onSelectPane={setSelectedMissionMobilePane}
        />
      </>{" "}
    </MissionPage>
  );
}

function mergeWorkspaceOptions(...groups: Array<Array<{ id: string; name?: string; path?: string }>>) {
  const byId = new Map<string, { id: string; name?: string; path?: string }>();
  groups.flat().forEach((workspace) => byId.set(workspace.id, workspace));
  return Array.from(byId.values());
}

function isManagedWorktreeWorkspace(workspace: { id?: string; path?: string }) {
  const normalizedPath = workspace.path?.replace(/\\/g, "/") ?? "";
  return Boolean(
    workspace.id?.includes("-worktree-") ||
      normalizedPath.includes("/.worktrees/") ||
      normalizedPath.includes("/.tiller/worktrees/"),
  );
}

function formatRuntimeSessionCount(sessionCount: number, activeSessionCount?: number) {
  const base = `${sessionCount} 个会话`;
  if (activeSessionCount === undefined || activeSessionCount === sessionCount) {
    return base;
  }
  return `${base} · ${activeSessionCount} 活跃`;
}
