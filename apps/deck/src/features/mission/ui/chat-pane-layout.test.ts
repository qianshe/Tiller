import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const currentDir = dirname(fileURLToPath(import.meta.url));
const worktreeSource = readFileSync(resolve(currentDir, "workspace.tsx"), "utf8");
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
const worktreeModelSource = readFileSync(resolve(currentDir, "workspace-model.ts"), "utf8");
const missionViewModelSource = readFileSync(
  resolve(currentDir, "../orchestration/mission-view-model.ts"),
  "utf8",
);
const missionSelectionEffectsSource = readFileSync(
  resolve(currentDir, "../orchestration/mission-selection-effects.ts"),
  "utf8",
);
const appRootSource = readFileSync(resolve(currentDir, "../../../app/shell/root.tsx"), "utf8");
const projectFileListSource = readFileSync(
  resolve(currentDir, "project-file-list.tsx"),
  "utf8",
);
const inspectorSource = readFileSync(resolve(currentDir, "inspector.tsx"), "utf8");
const panelHeaderSource = readFileSync(resolve(currentDir, "panel-header.tsx"), "utf8");
const logbookPanelSource = readFileSync(resolve(currentDir, "logbook-panel.tsx"), "utf8");
const cleanupDialogSource = readFileSync(
  resolve(currentDir, "session-cleanup-confirm-dialog.tsx"),
  "utf8",
);
const paneResizerSource = readFileSync(resolve(currentDir, "pane-resizer.tsx"), "utf8");
const chatPaneSource = readFileSync(resolve(currentDir, "chat-pane.tsx"), "utf8");
const composerSource = readFileSync(resolve(currentDir, "composer.tsx"), "utf8");
const messageTimelineSource = readFileSync(
  resolve(currentDir, "message-timeline.tsx"),
  "utf8",
);
const plainMessagesSource = readFileSync(resolve(currentDir, "plain-messages.tsx"), "utf8");
const missionLayoutHookSource = readFileSync(resolve(currentDir, "../hooks/layout.ts"), "utf8");
const slashCommandsHookSource = readFileSync(resolve(currentDir, "../hooks/slash-commands.ts"), "utf8");
const sessionEventsSource = readFileSync(resolve(currentDir, "../../server-events/session-events.ts"), "utf8");
const markdownSource = readFileSync(resolve(currentDir, "../../../shared/ui/markdown.tsx"), "utf8");

test("mission message history loading also advances artifact history for thinking cards", () => {
  const historyPaginationSource = readFileSync(resolve(currentDir, "../hooks/history-pagination.ts"), "utf8");

  assert.match(historyPaginationSource, /function loadOlderActivities/);
  assert.match(historyPaginationSource, /const canLoadMessages =/);
  assert.match(historyPaginationSource, /const canLoadActivities =/);
  assert.match(historyPaginationSource, /!canLoadMessages && !canLoadActivities/);
  assert.match(historyPaginationSource, /if \(canLoadMessages\)/);
  assert.match(historyPaginationSource, /if \(canLoadActivities\)/);
});

test("mission chat history state includes activity history for thinking-only pages", () => {
  assert.match(worktreeSource, /activityHistoryState=\{activityHistoryState\}/);
  assert.match(chatPaneSource, /activityHistoryState: Record<string, HistoryState \| undefined>/);
  assert.match(chatPaneSource, /activityHistoryStateBySession=\{activityHistoryState\}/);
  assert.match(messageTimelineSource, /resolveConversationHistoryState/);
  assert.match(messageTimelineSource, /messageHistoryState\?\.hasMore \|\| activityHistoryState\?\.hasMore/);
});

test("mission chat reserves permission drawer space through localized drawer positioning", () => {
  const permissionDrawerSource = readFileSync(resolve(currentDir, "permission-drawer.tsx"), "utf8");

  assert.match(worktreeSource, /mission-pane-chat relative/);
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

test("assistant streaming messages expose streaming state for lightweight rendering", () => {
  assert.match(plainMessagesSource, /message\.streaming/);
  assert.match(plainMessagesSource, /plain-message-streaming/);
});

test("slash command suppression resets after leaving slash mode", () => {
  assert.match(
    slashCommandsHookSource,
    /if \(commandToken === null\) \{\s*setSuppressedFor\(null\);\s*return;/,
  );
});

test("slash command names normalize provider leading slashes", () => {
  assert.match(slashCommandsHookSource, /normalizeSlashCommandName/);
  assert.match(slashCommandsHookSource, /formatSlashCommandInvocation\(cmd\)/);
  assert.match(slashCommandsHookSource, /formatSlashCommandLabel\(cmd\)\.slice\(1\)\.toLowerCase\(\)\.startsWith\(commandToken\)/);
});

test("ACP model loading badge is not limited to OpenCode", () => {
  assert.match(composerSource, /selectedDraftAgent\?\.protocol === "acp"/);
  assert.doesNotMatch(composerSource, /selectedDraftAgent\?\.id === "opencode"/);
});

test("mission composer uses restore-aware model loading state", () => {
  assert.match(worktreeModelSource, /composerModelLoading/);
  assert.match(worktreeModelSource, /activeSession && !activeSessionRestoreGate\.canChat/);
  assert.match(worktreeSource, /draftModelLoading=\{composerModelLoading\}/);
  assert.match(worktreeSource, /modelSettingsLocked=\{Boolean\(activeSession && !activeSessionRestoreGate\.canChat\)\}/);
});

test("mission loading gates omit model-loading hint while ACP is still connecting", () => {
  assert.doesNotMatch(worktreeSource, /mission-draft-preparing[\s\S]*<MissionStatusBar/);
  assert.doesNotMatch(worktreeSource, /mission-restore-gate[\s\S]*<MissionStatusBar/);
  assert.doesNotMatch(worktreeSource, /from "\.\/mission-status-bar"/);
});

test("mission chat hides restore and composer controls while Helm is disconnected", () => {
  assert.match(worktreeSource, /const helmConnected = pairingState === "paired"/);
  assert.match(worktreeSource, /const shouldShowComposer = Boolean\(helmConnected && \(activeSession \|\| selectedDraftConnection\)\)/);
  assert.match(worktreeSource, /const shouldShowDraftPreparing = Boolean\(helmConnected && !activeSession/);
  assert.match(worktreeSource, /helmConnected && activeSession && !activeSessionRestoreGate\.canChat/);
  assert.match(worktreeSource, /helmConnected=\{helmConnected\}/);
});

test("mission composer requires active-session config readiness before settings can open", () => {
  assert.match(missionViewModelSource, /const draftModelConfigReady = activeSession/);
  assert.match(missionViewModelSource, /const draftLoadingAgentModelOptions = !activeSession && draftAgentModelOptionsPrefix/);
  assert.match(missionViewModelSource, /sessionConfigOptions\[activeSession\.id\]/);
  assert.match(missionViewModelSource, /activeSession\.configOptions\?\.length/);
  assert.match(missionViewModelSource, /activeSession\.modelOptions\?\.length/);
  assert.match(missionViewModelSource, /\|\|\s*\(activeSession\.configOptions\?\.length \?\? 0\) > 0/);
  assert.match(worktreeSource, /draftModelConfigReady=\{draftModelConfigReady\}/);
  assert.match(composerSource, /const modelConfigMissing = activeSession/);
  assert.match(composerSource, /\? !draftModelConfigReady/);
  assert.match(composerSource, /const modelSettingsDisabled = activeSession/);
  assert.match(composerSource, /\? \(modelConfigMissing && !activeSessionModelKnown\) \|\| modelSettingsLocked/);
});


test("mission composer falls back to active session available commands", () => {
  assert.match(appRootSource, /activeSessionSlashCommands/);
  assert.match(appRootSource, /missionView\.activeSession\?\.availableCommands/);
  assert.match(appRootSource, /\[missionView\.activeSession\.id\]: activeSessionSlashCommands/);
});

test("ACP runtime overview refreshes after restore and does not stay connected during reconnect", () => {
  assert.match(sessionEventsSource, /"agent\/connections"/);
  assert.match(worktreeSource, /pendingAcpReconnects/);
  assert.match(worktreeSource, /status: reconnectPending \? "未连接" : formatAcpConnectionStatus/);
  assert.match(worktreeSource, /canReconnect: !reconnectPending/);
  assert.match(worktreeSource, /canConnect: reconnectPending/);
  assert.match(worktreeSource, /agentOrder/);
  assert.match(worktreeSource, /return dedupeRuntimeOverviewItems\(items\)\.sort/);
});

test("mission worktree uses Tailwind pane layout instead of feature css", () => {
  assert.match(worktreeSource, /mission-grid/);
  assert.match(worktreeSource, /wb-pane shadow-ambient/);
  assert.doesNotMatch(worktreeSource, /grid-cols-\[minmax\(220px,22%\)_6px_minmax\(0,1fr\)_6px_minmax\(280px,24%\)\]/);
  assert.doesNotMatch(worktreeSource, /surface-card/);
  assert.match(worktreeSource, /mission-sidebar-collapsed/);
  assert.match(worktreeSource, /sidebar-collapsed/);
  assert.match(worktreeSource, /display-collapsed/);
  assert.match(worktreeSource, /mission-inspector-collapsed/);
  assert.match(worktreeSource, /inspector-collapsed/);
  assert.match(chatPaneSource, /wb-pane-head/);
});

test("mission chat pane follows the v6 workbench header and canvas body", () => {
  assert.match(chatPaneSource, /wb-pane-head/);
  assert.match(chatPaneSource, /wb-pane-head-eyebrow">工作台/);
  assert.doesNotMatch(chatPaneSource, /min-h-9/);
  assert.match(chatPaneSource, /aria-label="展开任务导航"/);
  assert.match(chatPaneSource, /chat-main flex-1 overflow-y-auto overflow-x-hidden min-h-0 relative/);
  assert.match(chatPaneSource, /SessionCard/);
  assert.match(chatPaneSource, /gridTemplateColumns: "repeat\(auto-fill, minmax\(420px, 1fr\)\)"/);
  assert.match(chatPaneSource, /flat \? "h-full bg-surface" : "bg-surface rounded-\[8px\] transition-all cursor-default"/);
  assert.match(chatPaneSource, /AgentIcon name=\{session\.agentName\}/);
  assert.match(chatPaneSource, /StatusDot tone=\{statusTone\}/);
  assert.match(chatPaneSource, /title="关闭此 session"/);
  assert.match(chatPaneSource, /Icon name="more"/);
  assert.doesNotMatch(chatPaneSource, /rounded-md bg-surface-sunken\/70 p-3/);
});


test("mission chat pane exposes the v6 session grid and more menu actions", () => {
  assert.match(chatPaneSource, /mission-session-grid/);
  assert.match(chatPaneSource, /openSessions/);
  assert.match(chatPaneSource, /role="menu"/);
  assert.match(chatPaneSource, /w-\[200px\]/);
  assert.match(chatPaneSource, /Icon name="check"/);
  assert.match(chatPaneSource, /onDragOver/);
  assert.match(chatPaneSource, /onDragLeave/);
  assert.match(chatPaneSource, /onDrop=\{handleDrop\}/);
  assert.match(chatPaneSource, /application\/x-tiller-session-id/);
  assert.match(chatPaneSource, /dragOver \? "inset 0 0 0 2px var\(--primary\)" : "none"/);
  assert.match(chatPaneSource, /重命名/);
  assert.match(chatPaneSource, /生成摘要/);
  assert.match(chatPaneSource, /展示栏/);
  assert.match(chatPaneSource, /Inspector 面板/);
  assert.match(chatPaneSource, /导出对话/);
  assert.match(chatPaneSource, /清理会话/);
  assert.doesNotMatch(chatPaneSource, /DropdownMenuContent/);
});

test("mission sidebar exposes search and new-task actions in the header", () => {
  assert.match(sidebarSource, /aria-label="搜索任务"/);
  assert.match(sidebarSource, /aria-label="新建任务"/);
  assert.match(sidebarSource, /wb-pane-head-eyebrow">Helm · 任务/);
  assert.match(sidebarSource, /currentGitBranch/);
  assert.match(sidebarSource, /missionDiffCount/);
  assert.match(sidebarSource, /dirty/);
});

test("mission workspace wires session grid toggles into the chat pane", () => {
  assert.match(worktreeSource, /openSessions=/);
  assert.match(worktreeSource, /sidebarCollapsed=\{effectiveSidebarCollapsed\}/);
  assert.match(worktreeSource, /onExpandSidebar=\{\(\) => setMissionSidebarCollapsed\(false\)\}/);
  assert.match(worktreeSource, /onToggleDisplay=/);
  assert.match(worktreeSource, /onToggleInspector=/);
  assert.match(worktreeSource, /setMissionDisplayCollapsed/);
  assert.match(worktreeSource, /setMissionInspectorCollapsed/);
});

test("mission composer mirrors the v6 sunken command deck", () => {
  assert.match(composerSource, /border-t border-border-ghost p-2 bg-surface/);
  assert.match(composerSource, /wb-pane-sunken p-2 max-w-\[1080px\] mx-auto/);
  assert.match(composerSource, /rows=\{3\}/);
  assert.match(composerSource, /esc 取消 · ↑ 历史/);
  assert.match(composerSource, /Icon name="send"/);
  assert.doesNotMatch(composerSource, /mission-order-editor grid gap-3 rounded-md border/);
});

test("mission shell fills the viewport so the project pane stays visible on desktop", () => {
  assert.match(shellStylesSource, /\.shell\.view-sessions\s*{[^}]*width:\s*100vw;/s);
  assert.match(shellStylesSource, /\.shell\.view-sessions\s*{[^}]*padding:\s*8px;/s);
  assert.match(shellStylesSource, /\.shell\.view-sessions\.v6-radial-shell\s*{[^}]*padding:\s*8px;/s);
  assert.doesNotMatch(shellStylesSource, /\.shell\.view-sessions\s*{[^}]*padding:\s*96px 12px 12px;/s);
  assert.match(shellStylesSource, /\.shell\.view-sessions\s+\.page-content\s*{[^}]*min-height:\s*calc\(100vh - 16px\);/s);
});

test("mission project sidebar uses shared primitives and explicit Tailwind tree rows", () => {
  assert.match(sidebarSource, /Badge/);
  assert.match(sidebarSource, /wb-pane-head/);
  assert.match(sidebarSource, /bg-surface-sunken border-r border-border-ghost/);
  assert.match(sidebarSource, /mission-tree-switcher flex-1 overflow-auto p-1/);
  assert.doesNotMatch(sidebarSource, /Helm → Project → Session/);
  assert.match(sidebarProjectNodeSource, /Button/);
  assert.match(sidebarProjectNodeSource, /grid-cols-\[12px_14px_minmax\(0,1fr\)_auto\]/);
  assert.doesNotMatch(sidebarProjectNodeSource, />Project<\/span>/);
  assert.match(sessionRowSource, /grid-cols-\[12px_14px_minmax\(0,1fr\)_auto\]/);
});

test("mission sidebar rows stay compact and session actions open below rows", () => {
  assert.match(sidebarSource, /sidebar-section mission-tree-switcher flex-1 overflow-auto p-1/);
  assert.match(sidebarSource, /mission-tree grid gap-1/);
  assert.match(sidebarProjectNodeSource, /px-1\.5 h-5/);
  assert.match(sidebarProjectNodeSource, /ml-3 grid gap-1 border-l border-border-ghost pl-1\.5/);
  assert.doesNotMatch(sidebarProjectNodeSource, /ml-4 grid gap-1 border-l border-border-ghost pl-2/);
  assert.match(sessionRowSource, /px-1\.5 h-5/);
  assert.match(sessionRowSource, /DropdownMenuContent/);
  assert.doesNotMatch(sessionRowSource, /mission-tree-session-menu absolute/);
});

test("mission session rows stay tree-like instead of selected card pills", () => {
  assert.match(sessionRowSource, /grid-cols-\[12px_14px_minmax\(0,1fr\)_auto\]/);
  assert.doesNotMatch(sessionRowSource, /mission-tree-session-meta/);
  assert.doesNotMatch(sessionRowSource, /\{session\.agentName\}<\/span>/);
  assert.match(sessionRowSource, /mission-tree-cleanup/);
  assert.doesNotMatch(sessionRowSource, /session\.id === activeSessionId && "text-primary"/);
  assert.doesNotMatch(sessionRowSource, /rounded-xl/);
});

test("mission logbook keeps session summary fixed while activity list scrolls", () => {
  assert.match(displayPanelSource, /mission-logbook-page grid h-full min-h-0 grid-rows-\[auto_minmax\(0,1fr\)\] overflow-hidden/);
  assert.match(logbookPanelSource, /mission-logbook-layout grid h-full min-h-0 grid-rows-\[auto_minmax\(0,1fr\)\]/);
  assert.match(logbookPanelSource, /mission-logbook-scroll min-h-0 overflow-auto/);
});

test("mission display page navigation is placed above the content", () => {
  assert.match(displayPanelSource, /mission-display-tab-strip/);
  assert.match(displayPanelSource, /mission-panel-content min-h-0 flex-1 overflow-auto p-3/);
  assert.doesNotMatch(displayPanelSource, /MissionPanelNav/);
  assert.doesNotMatch(displayPanelSource, /mission-panel-body grid min-h-0 flex-1 grid-rows-\[auto_minmax\(0,1fr\)\]/);
});

test("mission display pane mirrors the v6 viewer chrome", () => {
  assert.match(displayPanelSource, /wb-pane-head/);
  assert.match(displayPanelSource, /展示栏/);
  assert.match(displayPanelSource, /mission-display-tab-strip/);
  assert.match(displayPanelSource, /rounded-\[8px\]/);
  assert.match(displayPanelSource, /mission-display-status-bar/);
  assert.doesNotMatch(displayPanelSource, /MissionPanelNav/);
  assert.doesNotMatch(displayPanelSource, /MissionPanelHeader title="任务展示" bordered \/>/);
});

test("mission inspector mirrors the v6 worktree chrome", () => {
  assert.match(inspectorSource, /wb-pane-head/);
  assert.match(inspectorSource, /工作区/);
  assert.match(inspectorSource, /mission-worktree-picker/);
  assert.match(inspectorSource, /mission-inspector-commit/);
  assert.doesNotMatch(inspectorSource, /TabsList/);
  assert.doesNotMatch(inspectorSource, /TabsTrigger/);
  assert.doesNotMatch(inspectorSource, /<MissionPanelHeader/);
});

test("mission display panel header uses compact height", () => {
  assert.match(displayPanelSource, /wb-pane-head/);
  assert.match(displayPanelSource, /展示栏/);
  assert.match(displayPanelSource, /mission-display-tab-strip/);
  assert.doesNotMatch(displayPanelSource, /mission-display-add-page-button/);
  assert.doesNotMatch(displayPanelSource, /<p className="eyebrow[^>]*>展示<\/p>/);
  assert.match(inspectorSource, /wb-pane-head/);
  assert.match(inspectorSource, /工作区/);
  assert.match(inspectorSource, /MissionPanelLoadingBadge/);
  assert.match(inspectorSource, /mission-inspector-section-head/);
  assert.match(panelHeaderSource, /PANEL_HEADER_FRAME_CLASS = "flex items-center justify-between gap-2 px-2 py-1\.5"/);
  assert.match(panelHeaderSource, /PANEL_HEADER_TITLE_CLASS = "text-section font-semibold leading-tight text-foreground"/);
  assert.match(panelHeaderSource, /mission-inline-loading[^\n]+px-2[^\n]+py-0\.5[^\n]+text-2xs/);
  assert.doesNotMatch(inspectorSource, /<p className="eyebrow[^>]*>项目变更<\/p>/);
});

test("mission project overview renders structured cards instead of raw info text", () => {
  assert.match(displayPanelSource, /parseOverviewItem/);
  assert.match(displayPanelSource, /mission-overview-card/);
  assert.doesNotMatch(displayPanelSource, /<InfoList/);
});

test("mission avoids fetching or rendering every project file by default", () => {
  assert.doesNotMatch(missionSelectionEffectsSource, /project\/list_files/);
  assert.match(worktreeModelSource, /const projectFiles = \[\]/);
  assert.match(worktreeModelSource, /const visibleProjectFiles = \[\]/);
  assert.match(projectFileListSource, /暂不加载全量 Git 文件/);
  assert.match(inspectorSource, /mission-worktree-picker/);
  assert.match(inspectorSource, /mission-inspector-commit/);
  assert.doesNotMatch(inspectorSource, /TabsList/);
});

test("session cleanup confirmation uses the shared centered dialog primitive", () => {
  assert.match(cleanupDialogSource, /DialogContent/);
  assert.match(cleanupDialogSource, /DialogFooter/);
  assert.doesNotMatch(cleanupDialogSource, /fleet-modal-backdrop/);
  assert.doesNotMatch(cleanupDialogSource, /fleet-delete-helm-modal/);
});

test("mission responsive collapse keeps chat as the last visible pane", () => {
  assert.match(missionLayoutHookSource, /sidebar: 248/);
  assert.match(missionLayoutHookSource, /display: 320/);
  assert.match(missionLayoutHookSource, /inspector: 280/);
  assert.match(missionLayoutHookSource, /MISSION_RESIZER_WIDTH = 2/);
  assert.match(missionLayoutHookSource, /MISSION_MIN_CHAT_WIDTH = 460/);
  assert.match(missionLayoutHookSource, /MISSION_AUTO_COLLAPSE_SIDEBAR_WIDTH = 1081/);
  assert.match(missionLayoutHookSource, /MISSION_AUTO_COLLAPSE_DISPLAY_WIDTH = 1081/);
  assert.match(missionLayoutHookSource, /MISSION_OUTER_GUTTER = 16/);
  assert.match(missionLayoutHookSource, /chat: \{ min: MISSION_MIN_CHAT_WIDTH/);
  assert.match(missionLayoutHookSource, /shouldCollapseInspectorForChat/);
  assert.match(missionLayoutHookSource, /shouldCollapseDisplayForChat/);
  assert.match(missionLayoutHookSource, /--mission-sidebar-resizer-width/);
  assert.match(missionLayoutHookSource, /--mission-display-resizer-width/);
  assert.match(missionLayoutHookSource, /--mission-inspector-resizer-width/);
  assert.match(missionLayoutHookSource, /effectiveDisplayCollapsed/);
  assert.match(worktreeSource, /effectiveDisplayCollapsed && "mission-display-collapsed"/);
  assert.match(worktreeSource, /<MissionDisplaySection/);
  assert.doesNotMatch(worktreeSource, /!effectiveDisplayCollapsed \? \(\s*<MissionDisplaySection/s);
  assert.match(worktreeSource, /!effectiveDisplayCollapsed \? \(\s*<MissionPaneResizer\s*handle="display"/s);
  assert.match(worktreeSource, /mission-pane-chat[^\"]*col-start-3 col-end-4/);
  assert.doesNotMatch(worktreeSource, /max-\[860px\]:h-auto/);
  assert.doesNotMatch(worktreeSource, /max-\[860px\]:flex-col/);
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

test("mission mobile uses explicit edge paging zones instead of draggable cards", () => {
  assert.match(worktreeSource, /mission-mobile-edge-pager/);
  assert.match(worktreeSource, /selectAdjacentMissionMobilePane/);
  assert.doesNotMatch(worktreeSource, /onPointerDown=\{startMissionMobileSwipe\}/);
  assert.doesNotMatch(worktreeSource, /onPointerMove=\{trackMissionMobileSwipe\}/);
  assert.doesNotMatch(worktreeSource, /--mission-mobile-swipe-offset/);
  assert.match(worktreeSource, /aria-label="上一页"\s*\/?>/);
  assert.match(worktreeSource, /aria-label="下一页"\s*\/?>/);
  assert.doesNotMatch(worktreeSource, />\s*上一页\s*<\/button>/);
  assert.doesNotMatch(worktreeSource, />\s*下一页\s*<\/button>/);
  assert.match(shellStylesSource, /\.mission-mobile-edge-pager\s*{[^}]*z-index:\s*6;/s);
  assert.match(shellStylesSource, /\.mission-mobile-edge-pager\s*{[^}]*grid-template-columns:\s*14px minmax\(0, 1fr\) 14px;/s);
  assert.match(shellStylesSource, /\.mission-mobile-edge-pager\s*{[^}]*align-items:\s*start;/s);
  assert.match(shellStylesSource, /\.mission-mobile-edge-pager\s*{[^}]*padding-top:\s*96px;/s);
  assert.match(shellStylesSource, /\.mission-mobile-edge-pager\s*{[^}]*pointer-events:\s*none;/s);
  assert.match(shellStylesSource, /\.mission-mobile-edge-pager-button\s*{[^}]*width:\s*14px;/s);
  assert.match(shellStylesSource, /\.mission-mobile-edge-pager-button\s*{[^}]*height:\s*min\(48vh, 420px\);/s);
  assert.match(shellStylesSource, /\.mission-mobile-edge-pager-button\s*{[^}]*border:\s*0;/s);
  assert.match(shellStylesSource, /\.mission-mobile-edge-pager-button\s*{[^}]*background:\s*transparent;/s);
  assert.match(shellStylesSource, /\.mission-mobile-edge-pager-button\s*{[^}]*font-size:\s*0;/s);
  assert.match(shellStylesSource, /\.mission-mobile-edge-pager-button\s*{[^}]*pointer-events:\s*auto;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \[data-mission-mobile-pane\] button,[\s\S]*?z-index:\s*7;/);
});

test("mission composer tools trigger advertises disabled affordance", () => {
  assert.match(shellStylesSource, /\.mission-tools-trigger:disabled\s*{[^}]*pointer-events:\s*auto;/s);
  assert.match(shellStylesSource, /\.mission-tools-trigger:disabled\s*{[^}]*cursor:\s*not-allowed;/s);
  assert.match(shellStylesSource, /\.mission-tools-trigger:disabled\s*{[^}]*opacity:\s*0\.6;/s);
});

const mobilePagerSource = readFileSync(resolve(currentDir, "mobile-pager.tsx"), "utf8");

test("mission mobile pager is compact and exposes four pane destinations", () => {
  assert.match(mobilePagerSource, /MissionMobilePager/);
  assert.match(mobilePagerSource, /项目/);
  assert.match(mobilePagerSource, /对话/);
  assert.match(mobilePagerSource, /面板/);
  assert.match(mobilePagerSource, /检视/);
  assert.match(mobilePagerSource, /aria-label=\{item\.label\}/);
  assert.match(shellStylesSource, /\.mission-mobile-pager\s*{[^}]*min-height:\s*3px;/s);
  assert.match(shellStylesSource, /\.mission-mobile-pager\s*{[^}]*padding:\s*2px 14px max\(2px, env\(safe-area-inset-bottom\)\);/s);
  assert.match(shellStylesSource, /\.mission-mobile-pager-item\s*{[^}]*min-height:\s*3px;/s);
  assert.match(shellStylesSource, /\.mission-mobile-pager-dot\s*{[^}]*height:\s*3px;/s);
  assert.match(shellStylesSource, /\.mission-mobile-pager-item\.active \.mission-mobile-pager-dot\s*{[^}]*opacity:\s*1;/s);
  assert.match(shellStylesSource, /\.mission-mobile-pager-label\s*{[^}]*display:\s*none;/s);
  assert.match(shellStylesSource, /safe-area-inset-bottom/);
  assert.doesNotMatch(mobilePagerSource, /引导|教程|滑动说明/);
});

test("mission worktree renders mobile pager and hides desktop resizers in mobile mode", () => {
  assert.match(worktreeSource, /MissionMobilePager/);
  assert.match(worktreeSource, /isMissionMobile/);
  assert.match(worktreeSource, /!isMissionMobile && !effectiveSidebarCollapsed/);
  assert.match(worktreeSource, /<MissionDisplaySection/);
  assert.doesNotMatch(worktreeSource, /isMissionMobile \|\| !effectiveDisplayCollapsed \? \(/);
  assert.match(worktreeSource, /!isMissionMobile \? \(\s*<MissionPaneResizer\s*handle="inspector"/s);
});

test("mission mobile mode marks panes with identities and shows one selected pane", () => {
  assert.match(sidebarSource, /data-mission-mobile-pane="project"/);
  assert.match(chatPaneSource, /data-mission-mobile-pane="chat"/);
  assert.match(displayPanelSource, /data-mission-mobile-pane="display"/);
  assert.match(inspectorSource, /data-mission-mobile-pane="inspector"/);
  assert.match(worktreeSource, /resolvedMissionMobilePane = selectedMissionMobilePane \?\? \(activeSession \? "chat" : "project"\)/);
  assert.match(worktreeSource, /mission-responsive-mode/);
  assert.match(worktreeSource, /`mission-mobile-pane-\$\{resolvedMissionMobilePane\}`/);
  assert.match(worktreeSource, /selectedPane=\{resolvedMissionMobilePane\}/);
  assert.match(shellStylesSource, /mission-mobile-pane-chat \[data-mission-mobile-pane="chat"\]/);
  assert.match(shellStylesSource, /mission-mobile-pane-project \[data-mission-mobile-pane="project"\]/);
  assert.match(shellStylesSource, /mission-mobile-pane-display \[data-mission-mobile-pane="display"\]/);
  assert.match(shellStylesSource, /mission-mobile-pane-inspector \[data-mission-mobile-pane="inspector"\]/);
  assert.match(shellStylesSource, /animation:\s*mission-mobile-card-switch/);
  assert.match(shellStylesSource, /@keyframes mission-mobile-card-switch/);
});

const diffPanelSource = readFileSync(resolve(currentDir, "diff-panel.tsx"), "utf8");
const diffTreeSource = readFileSync(resolve(currentDir, "diff-tree.tsx"), "utf8");
const composerAttachmentsSource = readFileSync(
  resolve(currentDir, "composer-attachments.tsx"),
  "utf8",
);
const sessionOverviewCardSource = readFileSync(
  resolve(currentDir, "session-overview-card.tsx"),
  "utf8",
);

test("mission worktree locks outer scroll while edge zones handle mobile paging", () => {
  assert.match(worktreeSource, /mission-mobile-edge-pager/);
  assert.doesNotMatch(worktreeSource, /onPointerDown=\{startMissionMobileSwipe\}/);
  assert.doesNotMatch(worktreeSource, /onPointerMove=\{trackMissionMobileSwipe\}/);
  assert.match(shellStylesSource, /body\s*{[^}]*overscroll-behavior-x:\s*contain;/s);
  assert.match(shellStylesSource, /overscroll-behavior-x:\s*contain/);
  assert.match(shellStylesSource, /touch-action:\s*pan-y/);
  assert.match(shellStylesSource, /\.shell\.view-sessions\s*{[^}]*overflow:\s*hidden;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode\s*{[^}]*height:\s*100%;/s);
  assert.match(shellStylesSource, /overflow-y:\s*auto/);
  assert.match(shellStylesSource, /\.chat-main,\s*\.mission-responsive-mode \[data-mission-mobile-pane="chat"\]\s*{[^}]*scrollbar-gutter:\s*stable;/s);
  assert.match(plainMessagesSource, /data-mission-swipe-lock="true"/);
  assert.match(logbookPanelSource, /data-mission-swipe-lock="true"/);
  assert.match(diffPanelSource, /data-mission-swipe-lock="true"/);
});

test("mission composer is sticky and swipe-locked on mobile", () => {
  assert.match(composerSource, /mission-composer/);
  assert.match(composerSource, /data-mission-swipe-lock="true"/);
  assert.match(composerSource, /rows=\{3\}/);
  assert.match(composerSource, /mission-image-upload-input/);
  assert.match(composerSource, /accept="image\/\*"/);
  assert.match(composerSource, /onAddPromptImages\(event\.currentTarget\.files\)/);
  assert.doesNotMatch(composerSource, /imagePasteNotice=\{imagePasteNotice\}/);
  assert.doesNotMatch(composerAttachmentsSource, /mission-composer-notice/);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-pane-chat\s*{[^}]*overflow:\s*hidden;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-composer/);
  assert.match(shellStylesSource, /bottom:\s*0;/);
  assert.match(shellStylesSource, /#mission-prompt-input\s*{[^}]*caret-color:\s*var\(--primary\);/s);
  assert.match(shellStylesSource, /#mission-prompt-input\s*{[^}]*scroll-padding-block:\s*10px;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode #mission-prompt-input\s*{[^}]*field-sizing:\s*content;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode #mission-prompt-input\s*{[^}]*min-height:\s*1\.5rem;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode #mission-prompt-input\s*{[^}]*padding:\s*2px 2px 10px;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode #mission-prompt-input\s*{[^}]*caret-color:\s*var\(--primary\);/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-composer-deck\s*{[^}]*padding:\s*8px;/s);
  assert.match(composerSource, /mission-composer-deck[^\n]+wb-pane-sunken/);
  assert.doesNotMatch(composerSource, /mission-order-editor[^\n]+bg-surface-sunken/);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-permission-drawer/);
  assert.match(shellStylesSource, /\.mission-mobile-mode \.mission-sidebar-toggle\s*{[^}]*display:\s*none;/s);
});

test("mission wide headers truncate long titles instead of consuming layout", () => {
  assert.match(shellStylesSource, /\.mission-panel-head > div,\s*\.mission-inspector-section-head > div\s*{[^}]*min-width:\s*0;/s);
  assert.match(shellStylesSource, /\.mission-panel-head h3,\s*\.mission-inspector-section-head h3\s*{[^}]*text-overflow:\s*ellipsis;/s);
});

test("mission display and logbook headers stay compact on mobile", () => {
  assert.match(sessionOverviewCardSource, /mission-session-overview/);
  assert.match(sessionOverviewCardSource, /rounded-\[8px\]/);
  assert.doesNotMatch(sessionOverviewCardSource, /mission-session-metrics/);
  assert.match(sessionOverviewCardSource, /mission-session-preview/);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-panel-head,\s*\.mission-responsive-mode \.mission-inspector-section-head\s*{/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-panel-head \.eyebrow,\s*\.mission-responsive-mode \.mission-inspector-section-head \.eyebrow\s*{[^}]*display:\s*none;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-panel-tree\s*{[^}]*padding:\s*4px;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-panel-content\s*{[^}]*padding:\s*8px;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-session-overview\s*{[^}]*padding:\s*8px;/s);
  assert.doesNotMatch(shellStylesSource, /\.mission-responsive-mode \.mission-session-preview\s*{[^}]*display:\s*none;/s);
});

test("mission inspector diff rows stay compact on mobile", () => {
  assert.match(diffPanelSource, /mission-change-tree grid min-h-0 gap-0\.5/);
  assert.match(diffPanelSource, /mission-file-row-compact[^\"]*grid w-full grid-cols-\[auto_minmax\(0,1fr\)_auto\][^\"]*gap-1[^\"]*px-1[^\"]*py-0\.5[^\"]*text-meta/);
  assert.match(diffPanelSource, /mission-file-status[^\"]*px-1[^\"]*py-0\.5[^\"]*text-2xs/);
  assert.match(diffPanelSource, /mission-change-group-title[^\"]*grid w-full grid-cols-\[16px_minmax\(0,1fr\)_auto\][^\"]*gap-1[^\"]*px-1[^\"]*py-0\.5[^\"]*text-meta/);
  assert.match(diffTreeSource, /diff-meta-split[^\"]*gap-1[^\"]*text-xs/);
  assert.doesNotMatch(diffPanelSource, /<strong className="min-w-0 truncate">\{node\.name\}<\/strong>/);
});
