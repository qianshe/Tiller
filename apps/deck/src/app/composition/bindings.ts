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
    selectedMissionDisplayTabId: panelPages.selectedDisplayTabId,
    setSelectedMissionDisplayTabId: panelPages.setSelectedDisplayTabId,
    openedMissionDiffFilePaths: panelPages.openedDiffFilePaths,
    selectedMissionDiffFilePath: panelPages.selectedDiffFilePath,
    setSelectedMissionDiffFilePath: panelPages.setSelectedDiffFilePath,
    collapsedMissionDiffDirectories: panelPages.collapsedDiffDirectories,
    toggleMissionDiffDirectory: panelPages.toggleDiffDirectory,
    openMissionDiffFile: panelPages.openDiffFile,
    closeMissionDiffFile: panelPages.closeDiffFile,
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
    setPromptEnhancerStatus: input.promptEnhancerSettings.setStatus,
    promptEnhancerModels: input.promptEnhancerSettings.models,
    promptEnhancerModelFilter: input.promptEnhancerSettings.modelFilter,
    setPromptEnhancerModelFilter: input.promptEnhancerSettings.setModelFilter,
    promptEnhancerModelPickerOpen: input.promptEnhancerSettings.modelPickerOpen,
    setPromptEnhancerModelPickerOpen: input.promptEnhancerSettings.setModelPickerOpen,
    updatePromptEnhancerPreference: input.promptEnhancerSettings.updatePreference,
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
    loggingSettings: input.loggingSettings,
    loggingStatus: input.loggingStatus,
    loggingClientAvailable: input.loggingClientAvailable,
    loggingConnectionKnownConnected: input.loggingConnectionKnownConnected,
    refreshLoggingSettings: input.refreshLoggingSettings,
    saveLoggingLevel: input.saveLoggingLevel,
  };
}

export function resolveShellClassName(activeView: string, theme: string, reduceMotion: boolean) {
  return [
    "shell",
    `view-${activeView}`,
    "v6-radial-shell",
    `theme-${theme}`,
    reduceMotion ? "motion-reduced" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
