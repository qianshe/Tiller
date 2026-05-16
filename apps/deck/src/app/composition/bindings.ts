export function buildAppLayoutContext(layout: any) {
  return {
    ...layout,
    missionLayoutStyle: layout.paneStyles.layout,
    missionSidebarPaneStyle: layout.paneStyles.sidebar,
    missionChatPaneStyle: layout.paneStyles.chat,
    missionDisplayPaneStyle: layout.paneStyles.display,
    missionInspectorPaneStyle: layout.paneStyles.inspector,
  };
}

export function buildMissionPanelContext(panelPages: any) {
  return {
    customMissionPanelPages: panelPages.customPages,
    selectedMissionPanelPageId: panelPages.selectedPageId,
    setSelectedMissionPanelPageId: panelPages.setSelectedPageId,
    selectedMissionDiffFilePath: panelPages.selectedDiffFilePath,
    setSelectedMissionDiffFilePath: panelPages.setSelectedDiffFilePath,
    collapsedMissionDiffDirectories: panelPages.collapsedDiffDirectories,
    setDraggedMissionPanelPageId: panelPages.setDraggedPageId,
    toggleMissionDiffDirectory: panelPages.toggleDiffDirectory,
    addMissionPanelPage: panelPages.addPage,
    dropMissionPanelPage: panelPages.dropPage,
    renameMissionPanelPage: panelPages.renamePage,
    moveMissionPanelPage: panelPages.movePage,
    deleteMissionPanelPage: panelPages.deletePage,
  };
}

export function buildAppRouteContext(input: any) {
  return {
    runtimeState: input.runtimeState,
    deckData: input.deckData,
    missionView: input.missionView,
    titleActions: input.titleActions,
    formatRelativeTime: input.formatRelativeTime,
    resolveCombinedModelValue: input.resolveCombinedModelValue,
    resolveReasoningOptionsForModel: input.resolveReasoningOptionsForModel,
    resolveReasoningLabel: input.resolveReasoningLabel,
    appActions: input.appActions,
    controllers: input.controllers,
    panelPages: input.panelPages,
    selection: input.selection,
    layout: input.layout,
    history: input.history,
    preferenceActions: input.preferenceActions,
    promptEnhancerSettings: input.promptEnhancerSettings,
    promptEnhancerBusy: input.promptEnhancerSettings.busy,
    promptEnhancerStatus: input.promptEnhancerSettings.status,
    promptEnhancerModels: input.promptEnhancerSettings.models,
    promptEnhancerModelFilter: input.promptEnhancerSettings.modelFilter,
    setPromptEnhancerModelFilter: input.promptEnhancerSettings.setModelFilter,
    promptEnhancerModelPickerOpen: input.promptEnhancerSettings.modelPickerOpen,
    setPromptEnhancerModelPickerOpen: input.promptEnhancerSettings.setModelPickerOpen,
    updatePromptEnhancerLlmPreference: input.promptEnhancerSettings.updateLlmPreference,
    testPromptEnhancerSelectedModel: input.promptEnhancerSettings.testSelectedModel,
    refreshPromptEnhancerModels: input.promptEnhancerSettings.refreshModels,
    updatePromptEnhancerModelInput: input.promptEnhancerSettings.updateModelInput,
    selectPromptEnhancerModel: input.promptEnhancerSettings.selectModel,
    slash: input.slash,
    codeActions: input.codeActions,
    helmConnection: input.helmConnection,
    route: input.route,
    activeView: input.route.activeView,
    navigateToView: input.route.navigateToView,
    activeProfileId: input.activeProfileId,
    copy: input.copy,
    agentLocked: input.agentLocked,
    enhancePromptDraft: input.enhancePromptDraft,
    updateSessionDraftPreferences: input.updateSessionDraftPreferences,
    toggleProjectFileDirectory: input.toggleProjectFileDirectory,
    openDiffDetail: input.openDiffDetail,
    toggleExpandedMessage: input.toggleExpandedMessage,
    renderMissionAgentIcon: input.renderMissionAgentIcon,
  };
}

export function resolveShellClassName(activeView: string, theme: string, reduceMotion: boolean) {
  return [
    "shell",
    `view-${activeView}`,
    `theme-${theme}`,
    reduceMotion ? "motion-reduced" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
