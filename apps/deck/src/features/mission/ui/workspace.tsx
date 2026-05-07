import { MissionChatPane } from "./chat-pane";
import { MissionComposer } from "./composer";
import { MissionDisplaySection } from "./display-section";
import { MissionInspector } from "./inspector";
import { MissionPage } from "./page";
import { MissionPaneResizer } from "./pane-resizer";
import { ProjectFileList } from "./project-file-list";
import { MissionSidebar } from "./sidebar";
import { buildMissionWorkspaceModel } from "./workspace-model";
import { joinClassNames } from "../utils/session-render-state";

export function MissionWorkspace(props: any) {
  const {
    prompt,
    promptImages,
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
    selectedDraftAgent,
    projectFileFilter,
    collapsedProjectFileDirectories,
    effectiveSidebarCollapsed,
    effectiveDisplayCollapsed,
    effectiveInspectorCollapsed,
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
    projectOverviewItems,
    visibleProjectFiles,
    sessionExecutionPending,
  } = buildMissionWorkspaceModel(props);
  const renderProjectFileList = () => (
    <ProjectFileList
      activeSessionPresent={Boolean(activeSession)}
      loading={projectFilesEntry?.loading}
      message={projectFilesEntry?.message}
      projectFiles={projectFiles}
      visibleProjectFiles={visibleProjectFiles}
      expandedDirectories={collapsedProjectFileDirectories}
      onToggleDirectory={toggleProjectFileDirectory}
    />
  );
  const chatPaneClassName = joinClassNames([
    "chat-conversation mission-pane mission-pane-chat col-start-3 col-end-4 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-ghost bg-surface shadow-none",
    !activeSession && "mission-draft-chat",
  ]);
  const missionLayoutClassName = joinClassNames([
    "card surface-card chat-layout chat-layout-sidebar grid h-[calc(100vh-20px)] min-h-[640px] w-full grid-cols-[var(--mission-sidebar-width)_var(--mission-sidebar-resizer-width)_minmax(0,var(--mission-chat-width))_var(--mission-display-resizer-width)_var(--mission-display-width)_var(--mission-inspector-resizer-width)_var(--mission-inspector-width)] gap-0 overflow-hidden rounded-lg border border-border-ghost bg-surface/80 p-1 shadow-ambient",
    effectiveSidebarCollapsed && "mission-sidebar-collapsed",
    effectiveDisplayCollapsed && "mission-display-collapsed",
    effectiveInspectorCollapsed && "mission-inspector-collapsed",
  ]);
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
          effectiveSidebarCollapsed={effectiveSidebarCollapsed}
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
          setSelectedMissionHelmId={setSelectedMissionHelmId}
          setSelectedProjectId={setSelectedProjectId}
          setSelectedWorkspaceId={setSelectedWorkspaceId}
          setSelectedAgentId={setSelectedAgentId}
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
            !effectiveSidebarCollapsed ? (
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
            sessionExecutionPending={sessionExecutionPending}
            cancelSession={cancelSession}
            canSend={canSend}
          />{" "}
        </MissionChatPane>{" "}
        {!effectiveDisplayCollapsed ? (
          <MissionPaneResizer
            handle="display"
            label="调整任务展示宽度"
            onResizeStart={startMissionPaneResize}
            onNudge={nudgeMissionPane}
          />
        ) : null}{" "}
        {!effectiveDisplayCollapsed ? (
          <MissionDisplaySection
            style={missionDisplayPaneStyle}
            pages={missionPanelPages}
            selectedPage={selectedMissionPanelPage}
            selectedDiffFilePath={selectedMissionDiffFilePath}
            diffs={activeDiffs}
            diffCount={missionDiffCount}
            logCount={missionLogCount}
            overviewItems={projectOverviewItems}
            noDiffSummary={copy.noDiffSummary}
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
            collapsedDiffDirectories={collapsedMissionDiffDirectories}
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
            onOpenDiffDetail={openDiffDetail}
            onRenamePage={renameMissionPanelPage}
            onMovePage={moveMissionPanelPage}
            onDeletePage={deleteMissionPanelPage}
            onToggleDiffDirectory={toggleMissionDiffDirectory}
          />
        ) : null}{" "}
        <MissionInspector
          collapsed={effectiveInspectorCollapsed}
          style={missionInspectorPaneStyle}
          activeSessionPresent={Boolean(activeSession)}
          projectFileCount={projectFiles.length}
          loading={projectFilesEntry?.loading}
          message={projectFilesEntry?.message}
          filter={projectFileFilter}
          projectFileList={renderProjectFileList()}
          resizer={
            <MissionPaneResizer
              handle="inspector"
              label="调整检视器宽度"
              onResizeStart={startMissionPaneResize}
              onNudge={nudgeMissionPane}
            />
          }
          onFilterChange={setProjectFileFilter}
        />{" "}
      </>{" "}
    </MissionPage>
  );
}
