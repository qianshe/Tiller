import assert from "node:assert/strict";
import test from "node:test";
import { buildAppRouteContext, buildMissionPanelContext } from "./bindings.js";

test("buildAppRouteContext forwards Dashboard section state", () => {
  const setDashboardSection = () => undefined;
  const promptEnhancerSettings = {
    busy: false,
    status: "",
    setStatus: () => undefined,
    models: [],
    modelFilter: "",
    setModelFilter: () => undefined,
    modelPickerOpen: false,
    setModelPickerOpen: () => undefined,
    updatePreference: () => undefined,
    updateLlmPreference: () => undefined,
    testSelectedModel: () => undefined,
    refreshModels: () => undefined,
    updateModelInput: () => undefined,
    selectModel: () => undefined,
  };

  const context = buildAppRouteContext({
    promptEnhancerSettings,
    route: { activeView: "dashboard", navigateToView: () => undefined },
    dashboardSection: "agents",
    setDashboardSection,
  });

  assert.equal(context.dashboardSection, "agents");
  assert.equal(context.setDashboardSection, setDashboardSection);
});

test("buildMissionPanelContext maps the new display tab state fields", () => {
  const panelPages = {
    selectedDisplayTabId: "graph",
    setSelectedDisplayTabId: () => undefined,
    gitErrorTabOpen: true,
    openGitErrorTab: () => undefined,
    closeGitErrorTab: () => undefined,
    openedDiffFilePaths: ["apps/deck/src/app.tsx"],
    selectedDiffFilePath: "apps/deck/src/app.tsx",
    setSelectedDiffFilePath: () => undefined,
    collapsedDiffDirectories: new Set(["apps"]),
    toggleDiffDirectory: () => undefined,
    openDiffFile: () => undefined,
    closeDiffFile: () => undefined,
  };

  const context = buildMissionPanelContext(panelPages);

  assert.equal(context.selectedMissionDisplayTabId, "graph");
  assert.equal(context.setSelectedMissionDisplayTabId, panelPages.setSelectedDisplayTabId);
  assert.equal(context.missionGitErrorTabOpen, true);
  assert.equal(context.openMissionGitErrorTab, panelPages.openGitErrorTab);
  assert.equal(context.closeMissionGitErrorTab, panelPages.closeGitErrorTab);
  assert.equal("selectedMissionPanelPageId" in context, false);
  assert.equal("setSelectedMissionPanelPageId" in context, false);
});
