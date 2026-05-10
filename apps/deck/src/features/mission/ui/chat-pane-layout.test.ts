import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const currentDir = dirname(fileURLToPath(import.meta.url));
const workspaceSource = readFileSync(resolve(currentDir, "workspace.tsx"), "utf8");
const shellStylesSource = readFileSync(
  resolve(currentDir, "../../../app/shell/styles.css"),
  "utf8",
);
const sidebarSource = readFileSync(resolve(currentDir, "sidebar.tsx"), "utf8");
const sidebarProjectNodeSource = readFileSync(
  resolve(currentDir, "sidebar-project-node.tsx"),
  "utf8",
);
const sessionRowSource = readFileSync(resolve(currentDir, "session-row.tsx"), "utf8");
const displayPanelSource = readFileSync(resolve(currentDir, "display-panel.tsx"), "utf8");
const workspaceModelSource = readFileSync(resolve(currentDir, "workspace-model.ts"), "utf8");
const missionSelectionEffectsSource = readFileSync(
  resolve(currentDir, "../orchestration/mission-selection-effects.ts"),
  "utf8",
);
const projectFileListSource = readFileSync(
  resolve(currentDir, "project-file-list.tsx"),
  "utf8",
);
const inspectorSource = readFileSync(resolve(currentDir, "inspector.tsx"), "utf8");
const logbookPanelSource = readFileSync(resolve(currentDir, "logbook-panel.tsx"), "utf8");
const cleanupDialogSource = readFileSync(
  resolve(currentDir, "session-cleanup-confirm-dialog.tsx"),
  "utf8",
);
const panelsSource = readFileSync(resolve(currentDir, "panels.tsx"), "utf8");
const paneResizerSource = readFileSync(resolve(currentDir, "pane-resizer.tsx"), "utf8");
const chatPaneSource = readFileSync(resolve(currentDir, "chat-pane.tsx"), "utf8");
const messageTimelineSource = readFileSync(
  resolve(currentDir, "message-timeline.tsx"),
  "utf8",
);
const plainMessagesSource = readFileSync(resolve(currentDir, "plain-messages.tsx"), "utf8");
const missionLayoutHookSource = readFileSync(resolve(currentDir, "../hooks/layout.ts"), "utf8");
const markdownSource = readFileSync(resolve(currentDir, "../../../shared/ui/markdown.tsx"), "utf8");

test("mission chat reserves permission drawer space through localized drawer positioning", () => {
  const permissionDrawerSource = readFileSync(resolve(currentDir, "permission-drawer.tsx"), "utf8");

  assert.match(workspaceSource, /mission-pane-chat relative/);
  assert.match(permissionDrawerSource, /bottom-\[calc\(var\(--mission-permission-composer-offset,190px\)\+24px\)\]/);
  assert.match(shellStylesSource, /bottom:\s*calc\(var\(--mission-permission-composer-offset, 190px\) \+ 68px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(permissionDrawerSource, /left-3/);
  assert.match(permissionDrawerSource, /right-3/);
  assert.doesNotMatch(permissionDrawerSource, /left-1\/2/);
  assert.doesNotMatch(permissionDrawerSource, /-translate-x-1\/2/);
  assert.doesNotMatch(permissionDrawerSource, /w-\[min\(720px/);
  assert.doesNotMatch(chatPaneSource, /padding-bottom:\s*170px/);
});

test("mission message timeline keeps chat list props stable for unchanged messages", () => {
  assert.match(messageTimelineSource, /memo\(function MissionMessageTimeline/);
  assert.match(messageTimelineSource, /useCallback/);
  assert.doesNotMatch(messageTimelineSource, /onLoadOlderMessages=\{\(\) => \{/);
});

test("markdown table wrapper keeps horizontal scrolling without generic overflow CSS", () => {
  assert.match(plainMessagesSource, /\[&_\.markdown-table-scroll\]:overflow-x-auto/);
  assert.match(plainMessagesSource, /\[&_\.markdown-table-scroll\]:overflow-y-hidden/);
  assert.doesNotMatch(plainMessagesSource, /plain-assistant[^\n]+overflow-x-visible/);
});

test("collapsed plain-text user messages use a three-line visual clamp without an overlay", () => {
  assert.match(plainMessagesSource, /plain-message-text-collapsed line-clamp-3 overflow-hidden/);
  assert.doesNotMatch(plainMessagesSource, /plain-message-body-collapsed::after/);
});

test("assistant markdown uses readable prose styling without paragraph marker bullets", () => {
  assert.doesNotMatch(plainMessagesSource, /markdown-paragraph\]:before/);
  assert.doesNotMatch(plainMessagesSource, /before:bg-green-500/);
  assert.match(markdownSource, /markdown-message space-y-3/);
  assert.match(markdownSource, /className="my-2 list-disc/);
  assert.match(markdownSource, /className="markdown-code-block overflow-hidden/);
  assert.match(markdownSource, /className="overflow-x-auto/);
  assert.match(markdownSource, /className="not-prose flex items-center justify-between/);
});

test("mission workspace uses Tailwind pane layout instead of feature css", () => {
  assert.match(workspaceSource, /grid-cols-\[var\(--mission-sidebar-width\)_var\(--mission-sidebar-resizer-width\)_minmax\(0,var\(--mission-chat-width\)\)_var\(--mission-display-resizer-width\)_var\(--mission-display-width\)_var\(--mission-inspector-resizer-width\)_var\(--mission-inspector-width\)\]/);
  assert.doesNotMatch(workspaceSource, /grid-cols-\[minmax\(220px,22%\)_6px_minmax\(0,1fr\)_6px_minmax\(280px,24%\)\]/);
  assert.match(workspaceSource, /mission-sidebar-collapsed/);
  assert.match(workspaceSource, /mission-inspector-collapsed/);
});

test("mission shell fills the viewport so the project pane stays visible on desktop", () => {
  assert.match(shellStylesSource, /\.shell\.view-sessions\s*{[^}]*width:\s*100vw;/s);
  assert.match(shellStylesSource, /\.shell\.view-sessions\s*{[^}]*padding:\s*8px 12px 12px;/s);
  assert.doesNotMatch(shellStylesSource, /\.shell\.view-sessions\s*{[^}]*padding:\s*96px 12px 12px;/s);
  assert.match(shellStylesSource, /\.shell\.view-sessions\s+\.page-content\s*{[^}]*min-height:\s*calc\(100vh - 20px\);/s);
});

test("mission project sidebar uses shared primitives and explicit Tailwind tree rows", () => {
  assert.match(sidebarSource, /Badge/);
  assert.match(sidebarSource, /rounded-xl border border-border-ghost bg-surface-sunken/);
  assert.match(sidebarProjectNodeSource, /Button/);
  assert.match(sidebarProjectNodeSource, /grid-cols-\[18px_22px_minmax\(0,1fr\)_auto\]/);
  assert.match(sessionRowSource, /grid-cols-\[16px_20px_minmax\(0,1fr\)_auto\]/);
});

test("mission sidebar rows stay compact and session actions open below rows", () => {
  assert.match(sidebarSource, /rounded-xl border border-border-ghost bg-surface-sunken p-2/);
  assert.match(sidebarProjectNodeSource, /px-2 py-1\.5/);
  assert.match(sessionRowSource, /px-2 py-1\.5/);
  assert.match(sessionRowSource, /DropdownMenuContent/);
  assert.doesNotMatch(sessionRowSource, /mission-tree-session-menu absolute/);
});

test("mission session rows stay tree-like instead of selected card pills", () => {
  assert.match(sessionRowSource, /grid-cols-\[16px_20px_minmax\(0,1fr\)_auto\]/);
  assert.match(sessionRowSource, /mission-tree-session-meta/);
  assert.match(sessionRowSource, /mission-tree-worktree-indicator/);
  assert.doesNotMatch(sessionRowSource, /session\.id === activeSessionId && "text-primary"/);
  assert.doesNotMatch(sessionRowSource, /rounded-xl/);
});

test("mission logbook keeps session summary fixed while activity list scrolls", () => {
  assert.match(displayPanelSource, /mission-logbook-page grid h-full min-h-0 grid-rows-\[auto_minmax\(0,1fr\)\] overflow-hidden/);
  assert.match(logbookPanelSource, /mission-logbook-layout grid h-full min-h-0 grid-rows-\[auto_minmax\(0,1fr\)\]/);
  assert.match(logbookPanelSource, /mission-logbook-scroll min-h-0 overflow-auto/);
});

test("mission display page navigation is placed above the content", () => {
  assert.match(displayPanelSource, /mission-panel-body grid min-h-0 flex-1 grid-rows-\[auto_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(displayPanelSource, /grid-cols-\[72px_minmax\(0,1fr\)\]/);
  assert.match(panelsSource, /mission-panel-tree flex/);
  assert.match(panelsSource, /border-b border-border-ghost/);
  assert.doesNotMatch(panelsSource, /border-r border-border-ghost/);
});

test("mission project overview renders structured cards instead of raw info text", () => {
  assert.match(displayPanelSource, /parseOverviewItem/);
  assert.match(displayPanelSource, /mission-overview-card/);
  assert.doesNotMatch(displayPanelSource, /<InfoList/);
});

test("mission avoids fetching or rendering every project file by default", () => {
  assert.doesNotMatch(missionSelectionEffectsSource, /project\/list_files/);
  assert.match(workspaceModelSource, /const projectFiles = \[\]/);
  assert.match(workspaceModelSource, /const visibleProjectFiles = \[\]/);
  assert.match(projectFileListSource, /暂不加载全量 Git 文件/);
  assert.match(inspectorSource, /Git Diff/);
  assert.match(inspectorSource, /Worktrees/);
});

test("session cleanup confirmation uses the shared centered dialog primitive", () => {
  assert.match(cleanupDialogSource, /DialogContent/);
  assert.match(cleanupDialogSource, /DialogFooter/);
  assert.doesNotMatch(cleanupDialogSource, /fleet-modal-backdrop/);
  assert.doesNotMatch(cleanupDialogSource, /fleet-delete-helm-modal/);
});

test("mission responsive collapse keeps chat as the last visible pane", () => {
  assert.match(missionLayoutHookSource, /MISSION_AUTO_COLLAPSE_INSPECTOR_WIDTH = 1584/);
  assert.match(missionLayoutHookSource, /MISSION_AUTO_COLLAPSE_SIDEBAR_WIDTH = 1280/);
  assert.match(missionLayoutHookSource, /MISSION_AUTO_COLLAPSE_DISPLAY_WIDTH = 1080/);
  assert.match(missionLayoutHookSource, /MISSION_OUTER_GUTTER = 24/);
  assert.match(missionLayoutHookSource, /chat: \{ min: 280, max: 820 \}/);
  assert.match(missionLayoutHookSource, /--mission-sidebar-resizer-width/);
  assert.match(missionLayoutHookSource, /--mission-display-resizer-width/);
  assert.match(missionLayoutHookSource, /--mission-inspector-resizer-width/);
  assert.match(missionLayoutHookSource, /effectiveDisplayCollapsed/);
  assert.match(workspaceSource, /effectiveDisplayCollapsed && "mission-display-collapsed"/);
  assert.match(workspaceSource, /<MissionDisplaySection/);
  assert.doesNotMatch(workspaceSource, /!effectiveDisplayCollapsed \? \(\s*<MissionDisplaySection/s);
  assert.match(workspaceSource, /!effectiveDisplayCollapsed \? \(\s*<MissionPaneResizer\s*handle="display"/s);
  assert.match(workspaceSource, /mission-pane-chat[^\"]*col-start-3 col-end-4/);
  assert.doesNotMatch(workspaceSource, /max-\[860px\]:h-auto/);
  assert.doesNotMatch(workspaceSource, /max-\[860px\]:flex-col/);
  assert.match(sidebarSource, /mission-pane-sidebar col-start-1 col-end-2/);
  assert.match(displayPanelSource, /mission-pane-display col-start-5 col-end-6/);
  assert.match(inspectorSource, /mission-pane-inspector col-start-7 col-end-8/);
  assert.match(paneResizerSource, /col-start-2 col-end-3/);
  assert.match(paneResizerSource, /col-start-4 col-end-5/);
  assert.match(paneResizerSource, /col-start-6 col-end-7/);
});

test("mission layout hook exposes mobile pane state and intelligent defaults", () => {
  assert.match(missionLayoutHookSource, /export type MissionMobilePane = "project" \| "chat" \| "display" \| "inspector"/);
  assert.match(missionLayoutHookSource, /MISSION_MOBILE_WIDTH = 1081/);
  assert.match(missionLayoutHookSource, /selectedMissionMobilePane/);
  assert.match(missionLayoutHookSource, /setSelectedMissionMobilePane/);
  assert.match(missionLayoutHookSource, /hasActiveSession \? "chat" : "project"/);
  assert.match(missionLayoutHookSource, /window\.innerWidth/);
  assert.match(missionLayoutHookSource, /matchMedia\("\(max-width: 1080px\)"\)/);
  assert.match(missionLayoutHookSource, /Math\.min\(layoutWidth, documentWidth\)/);
});

test("mission layout hook exposes guarded mobile pointer swipe handlers", () => {
  assert.match(missionLayoutHookSource, /startMissionMobileSwipe/);
  assert.match(missionLayoutHookSource, /finishMissionMobileSwipe/);
  assert.match(missionLayoutHookSource, /cancelMissionMobileSwipe/);
  assert.match(missionLayoutHookSource, /isMissionSwipeIgnoredTarget/);
  assert.match(missionLayoutHookSource, /textarea, input, select, a/);
  assert.doesNotMatch(missionLayoutHookSource, /select, button, a/);
  assert.match(missionLayoutHookSource, /\[data-mission-swipe-lock="true"\]/);
  assert.match(missionLayoutHookSource, /MISSION_MOBILE_SWIPE_THRESHOLD = 36/);
  assert.match(missionLayoutHookSource, /PointerEvent/);
});

const mobilePagerSource = readFileSync(resolve(currentDir, "mobile-pager.tsx"), "utf8");

test("mission mobile pager is compact and exposes four pane destinations", () => {
  assert.match(mobilePagerSource, /MissionMobilePager/);
  assert.match(mobilePagerSource, /项目/);
  assert.match(mobilePagerSource, /对话/);
  assert.match(mobilePagerSource, /面板/);
  assert.match(mobilePagerSource, /检视/);
  assert.match(mobilePagerSource, /aria-label=\{item\.label\}/);
  assert.match(shellStylesSource, /\.mission-mobile-pager\s*{[^}]*min-height:\s*16px;/s);
  assert.match(shellStylesSource, /\.mission-mobile-pager-dot\s*{[^}]*height:\s*3px;/s);
  assert.match(shellStylesSource, /\.mission-mobile-pager-item\.active \.mission-mobile-pager-dot\s*{[^}]*opacity:\s*1;/s);
  assert.match(shellStylesSource, /\.mission-mobile-pager-label\s*{[^}]*display:\s*none;/s);
  assert.match(shellStylesSource, /safe-area-inset-bottom/);
  assert.doesNotMatch(mobilePagerSource, /引导|教程|滑动说明/);
});

test("mission workspace renders mobile pager and hides desktop resizers in mobile mode", () => {
  assert.match(workspaceSource, /MissionMobilePager/);
  assert.match(workspaceSource, /isMissionMobile/);
  assert.match(workspaceSource, /!isMissionMobile && !effectiveSidebarCollapsed/);
  assert.match(workspaceSource, /<MissionDisplaySection/);
  assert.doesNotMatch(workspaceSource, /isMissionMobile \|\| !effectiveDisplayCollapsed \? \(/);
  assert.match(workspaceSource, /!isMissionMobile \? \(\s*<MissionPaneResizer\s*handle="inspector"/s);
});

test("mission mobile mode marks panes with identities and shows one selected pane", () => {
  assert.match(sidebarSource, /data-mission-mobile-pane="project"/);
  assert.match(chatPaneSource, /data-mission-mobile-pane="chat"/);
  assert.match(displayPanelSource, /data-mission-mobile-pane="display"/);
  assert.match(inspectorSource, /data-mission-mobile-pane="inspector"/);
  assert.match(workspaceSource, /resolvedMissionMobilePane = selectedMissionMobilePane \?\? \(activeSession \? "chat" : "project"\)/);
  assert.match(workspaceSource, /mission-responsive-mode/);
  assert.match(workspaceSource, /`mission-mobile-pane-\$\{resolvedMissionMobilePane\}`/);
  assert.match(workspaceSource, /selectedPane=\{resolvedMissionMobilePane\}/);
  assert.match(shellStylesSource, /mission-mobile-pane-chat \[data-mission-mobile-pane="chat"\]/);
  assert.match(shellStylesSource, /mission-mobile-pane-project \[data-mission-mobile-pane="project"\]/);
  assert.match(shellStylesSource, /mission-mobile-pane-display \[data-mission-mobile-pane="display"\]/);
  assert.match(shellStylesSource, /mission-mobile-pane-inspector \[data-mission-mobile-pane="inspector"\]/);
  assert.match(shellStylesSource, /animation:\s*mission-mobile-card-switch/);
  assert.match(shellStylesSource, /@keyframes mission-mobile-card-switch/);
});

const diffPanelSource = readFileSync(resolve(currentDir, "diff-panel.tsx"), "utf8");
const composerSource = readFileSync(resolve(currentDir, "composer.tsx"), "utf8");
const composerAttachmentsSource = readFileSync(
  resolve(currentDir, "composer-attachments.tsx"),
  "utf8",
);
const sessionOverviewCardSource = readFileSync(
  resolve(currentDir, "session-overview-card.tsx"),
  "utf8",
);

test("mission workspace attaches mobile pointer swipe handlers and locks horizontal regions", () => {
  assert.match(workspaceSource, /onPointerDown=\{startMissionMobileSwipe\}/);
  assert.match(workspaceSource, /onPointerUp=\{finishMissionMobileSwipe\}/);
  assert.match(workspaceSource, /onPointerCancel=\{cancelMissionMobileSwipe\}/);
  assert.match(shellStylesSource, /touch-action:\s*pan-y/);
  assert.match(shellStylesSource, /\.shell\.view-sessions\s*{[^}]*overflow:\s*hidden;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode\s*{[^}]*height:\s*100%;/s);
  assert.match(shellStylesSource, /overflow-y:\s*auto/);
  assert.match(plainMessagesSource, /data-mission-swipe-lock="true"/);
  assert.match(logbookPanelSource, /data-mission-swipe-lock="true"/);
  assert.match(diffPanelSource, /data-mission-swipe-lock="true"/);
});

test("mission composer is sticky and swipe-locked on mobile", () => {
  assert.match(composerSource, /mission-composer/);
  assert.match(composerSource, /data-mission-swipe-lock="true"/);
  assert.match(composerSource, /mission-image-upload-input/);
  assert.match(composerSource, /accept="image\/\*"/);
  assert.match(composerSource, /onAddPromptImages\(event\.currentTarget\.files\)/);
  assert.doesNotMatch(composerSource, /imagePasteNotice=\{imagePasteNotice\}/);
  assert.doesNotMatch(composerAttachmentsSource, /mission-composer-notice/);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-pane-chat\s*{[^}]*overflow:\s*hidden;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-composer/);
  assert.match(shellStylesSource, /bottom:\s*0;/);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-order-editor\s*{[^}]*padding:\s*8px;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-permission-drawer/);
  assert.match(shellStylesSource, /\.mission-mobile-mode \.mission-sidebar-toggle\s*{[^}]*display:\s*none;/s);
});

test("mission display and logbook headers stay compact on mobile", () => {
  assert.match(sessionOverviewCardSource, /mission-session-overview/);
  assert.match(sessionOverviewCardSource, /mission-session-metrics/);
  assert.match(sessionOverviewCardSource, /mission-session-preview/);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-panel-tree\s*{[^}]*padding:\s*4px;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-panel-content\s*{[^}]*padding:\s*8px;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-session-overview\s*{[^}]*padding:\s*8px;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-session-preview\s*{[^}]*display:\s*none;/s);
});
