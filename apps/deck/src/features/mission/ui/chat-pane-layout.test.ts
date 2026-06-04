import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

const currentDir = dirname(fileURLToPath(import.meta.url));
const worktreeSource = readFileSync(resolve(currentDir, "../workspace/controller.tsx"), "utf8");
const shellStylesSource = readFileSync(
  resolve(currentDir, "../../../app/shell/styles.css"),
  "utf8",
);
const sidebarSource = readFileSync(resolve(currentDir, "../navigation/sidebar.tsx"), "utf8");
const sidebarProjectNodeSource = readFileSync(
  resolve(currentDir, "../navigation/sidebar-project-node.tsx"),
  "utf8",
);
const sessionRowSource = readFileSync(resolve(currentDir, "../navigation/session-row.tsx"), "utf8");
const displayPanelSource = readFileSync(resolve(currentDir, "../display/panel.tsx"), "utf8");
const diffPanelSource = readFileSync(resolve(currentDir, "../display/diff-panel.tsx"), "utf8");
const diffTreeSource = readFileSync(resolve(currentDir, "../display/diff-tree.tsx"), "utf8");
const mobilePagerSource = readFileSync(resolve(currentDir, "../workspace/mobile-pager.tsx"), "utf8");
const worktreeModelSource = readFileSync(resolve(currentDir, "../workspace/model.ts"), "utf8");
const workspaceChatCompositionSource = readFileSync(
  resolve(currentDir, "../workspace/chat-composition.ts"),
  "utf8",
);
const sessionStreamsSource = readFileSync(resolve(currentDir, "../workspace/session-streams.ts"), "utf8");
const openSessionStreamsSource = readFileSync(resolve(currentDir, "../workspace/open-session-streams.ts"), "utf8");
const chatWindowActionsSource = readFileSync(resolve(currentDir, "../workspace/chat-window-actions.ts"), "utf8");
const runtimeOverviewActionsSource = readFileSync(resolve(currentDir, "../workspace/runtime-overview-actions.ts"), "utf8");
const runtimeOverviewSource = readFileSync(resolve(currentDir, "../workspace/runtime-overview.ts"), "utf8");
const missionViewModelSource = readFileSync(
  resolve(currentDir, "../orchestration/mission-view-model.ts"),
  "utf8",
);
const missionSelectionEffectsSource = readFileSync(
  resolve(currentDir, "../orchestration/mission-selection-effects.ts"),
  "utf8",
);
const appRootSource = readFileSync(resolve(currentDir, "../../../app/shell/root.tsx"), "utf8");
const missionRouteSource = readFileSync(
  resolve(currentDir, "../../../app/routing/mission-route.tsx"),
  "utf8",
);
const inspectorSource = readFileSync(resolve(currentDir, "../inspector/panel.tsx"), "utf8");
const panelHeaderSource = readFileSync(resolve(currentDir, "../inspector/panel-header.tsx"), "utf8");
const logbookPanelSource = readFileSync(resolve(currentDir, "../display/logbook-panel.tsx"), "utf8");
const cleanupDialogSource = readFileSync(
  resolve(currentDir, "session-cleanup-confirm-dialog.tsx"),
  "utf8",
);
const chatPaneComponentSource = readFileSync(resolve(currentDir, "../conversation/chat-pane.tsx"), "utf8");
const chatPaneSource = [
  chatPaneComponentSource,
  readFileSync(resolve(currentDir, "../conversation/session-cards.tsx"), "utf8"),
  readFileSync(resolve(currentDir, "../conversation/chat-pane-layout-model.ts"), "utf8"),
].join("\n");
const composerSource = readFileSync(resolve(currentDir, "../composer/form.tsx"), "utf8");
const sessionCommandActionsSource = readFileSync(
  resolve(currentDir, "../actions/session-command-actions.ts"),
  "utf8",
);
const messageTimelineSource = readFileSync(
  resolve(currentDir, "../conversation/message-timeline.tsx"),
  "utf8",
);
const plainMessagesSource = [
  readFileSync(resolve(currentDir, "../conversation/plain-messages.tsx"), "utf8"),
  readFileSync(resolve(currentDir, "../conversation/plain-message-items.tsx"), "utf8"),
].join("\n");
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
  assert.match(messageTimelineSource, /messageHistoryState\?\.hasMore && messageHistoryState\.nextCursor/);
  assert.match(messageTimelineSource, /messageHistoryState\?\.timelineHasMore && messageHistoryState\.timelineNextCursor/);
  assert.match(messageTimelineSource, /activityHistoryState\?\.hasMore && activityHistoryState\.nextCursor/);
});

test("mission chat renders permission drawers inside matching session cards", () => {
  const permissionDrawerSource = readFileSync(resolve(currentDir, "../conversation/permission-drawer.tsx"), "utf8");

  assert.match(chatPaneSource, /sessionPendingApprovals/);
  assert.match(chatPaneSource, /approval\.sessionId === session\.id/);
  assert.match(chatPaneSource, /<MissionPermissionDrawer/);
  assert.match(permissionDrawerSource, /sticky/);
  assert.match(permissionDrawerSource, /top-2/);
  assert.doesNotMatch(permissionDrawerSource, /bottom-2/);
  assert.doesNotMatch(permissionDrawerSource, /bottom-\[calc\(var\(--mission-permission-composer-offset,190px\)\+24px\]\]/);
  assert.doesNotMatch(shellStylesSource, /mission-responsive-mode \.mission-permission-drawer/);
  assert.doesNotMatch(permissionDrawerSource, /left-1\/2/);
  assert.doesNotMatch(permissionDrawerSource, /-translate-x-1\/2/);
  assert.doesNotMatch(permissionDrawerSource, /w-\[min\(720px/);
  assert.doesNotMatch(chatPaneSource, /padding-bottom:\s*170px/);
});

test("mission chat renders ACP plan drawer outside normal tool calls", () => {
  assert.match(chatPaneSource, /MissionPlanDrawer/);
  assert.match(chatPaneSource, /sessionPlansById/);
    assert.match(chatPaneSource, /activeSessionPlan/);
    assert.match(chatPaneSource, /plan=\{resolveSessionPlan\(singleSession\)\}/);
    assert.match(chatPaneSource, /plan=\{resolveSessionPlan\(session\)\}/);
    assert.match(chatPaneSource, /dismissedCompletedSessionPlanKeys/);
    assert.match(chatPaneSource, /createAgentPlanDismissalKey\(plan\)/);
    assert.match(chatPaneSource, /data-plan-dock="session"/);
  assert.match(chatPaneSource, /data-plan-session-id=\{session\.id\}/);
  assert.match(chatPaneSource, /placement="floating"/);
  assert.doesNotMatch(chatPaneSource, /focusedPlanSession/);
  assert.doesNotMatch(chatPaneSource, /data-plan-dock="bottom"/);
  assert.doesNotMatch(chatPaneSource, /<MissionPlanDrawer plan=\{sessionPlan\}/);
  assert.doesNotMatch(chatPaneSource, /planCount/);
  assert.doesNotMatch(chatPaneSource, /todowrite|update_plan|isPlanLikeToolCall/);
});

test("mission message timeline keeps chat list props stable for unchanged messages", () => {
  assert.match(messageTimelineSource, /memo\(function MissionMessageTimeline/);
  assert.match(messageTimelineSource, /useCallback/);
  assert.doesNotMatch(messageTimelineSource, /onLoadOlderMessages=\{\(\) => \{/);
});

test("markdown table wrapper keeps horizontal scrolling without generic overflow CSS", () => {
  assert.match(plainMessagesSource, /plain-message-list conversation-timeline mx-auto grid w-full max-w-\[min\(1120px,calc\(100%_-_16px\)\)\]/);
  assert.match(plainMessagesSource, /mr-auto grid w-full max-w-full/);
  assert.match(plainMessagesSource, /ml-auto grid w-full justify-items-end/);
  assert.match(plainMessagesSource, /message\.role === "user" && "max-w-\[min\(680px,61\.8%\)\]/);
  assert.match(plainMessagesSource, /plain-thinking-row[^\n]+max-w-full/);
  assert.match(plainMessagesSource, /plain-tool-row[^\n]+max-w-full/);
  assert.match(plainMessagesSource, /message\.role === "user" && "max-w-\[min\(680px,61\.8%\)\] rounded-\[14px\] border border-primary\/20 bg-primary-soft\/25 px-3 py-2/);
  assert.doesNotMatch(plainMessagesSource, /rounded-2xl border border-border-ghost bg-surface-elevated/);
  assert.doesNotMatch(plainMessagesSource, /border border-border-ghost\/70/);
  assert.doesNotMatch(plainMessagesSource, /rounded-md bg-surface-emphasis\/45/);
  assert.match(plainMessagesSource, /message\.role === "user" && message\.attachments\?\.length \?/);
  assert.match(plainMessagesSource, /mission-message-attachments[\s\S]*?\) : null\}\s*<div\s*className=\{cn\(/);
  assert.match(plainMessagesSource, /message\.role !== "user" && message\.attachments\?\.length \?/);
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
  assert.match(markdownSource, /markdown-message space-y-1\.5 text-\[12\.5px\] leading-\[1\.5\]/);
  assert.match(markdownSource, /markdown-heading my-1\.5 text-\[15px\]/);
  assert.match(markdownSource, /className="my-1\.5 list-disc space-y-0\.5 pl-4/);
  assert.match(markdownSource, /markdown-table-cell border-t border-border-ghost px-2\.5 py-1\.5 align-top text-\[12\.5px\]/);
  assert.match(markdownSource, /className="markdown-code-block overflow-hidden/);
  assert.match(markdownSource, /className="overflow-x-auto/);
  assert.match(markdownSource, /className="not-prose flex items-center justify-between/);
});

test("plain conversation text uses compact small-pane typography", () => {
  assert.match(plainMessagesSource, /messageBodyClassName\} min-w-0 text-\[12\.5px\] leading-\[1\.5\]/);
  assert.match(plainMessagesSource, /plain-thinking-content[^\n]+text-\[12\.5px\] leading-\[1\.5\]/);
  assert.match(plainMessagesSource, /plain-tool-group-content[^\n]+text-\[12\.5px\]/);
  assert.match(chatPaneSource, /flat \? "px-4 pb-9 pt-3" : "px-3 pb-9 pt-2\.5"/);
  assert.match(chatPaneSource, /overflow-auto px-3 pb-9 pt-2\.5/);
});

test("markdown normalizes text only when the source changes", () => {
  assert.match(markdownSource, /useMemo\(\(\) => normalizeMarkdownMessageText\(text\), \[text\]\)/);
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
  assert.match(worktreeSource, /const shouldShowComposer = Boolean\(helmConnected && \(activeSession \|\| draftChatWindow\)\)/);
  assert.match(worktreeSource, /const shouldShowDraftPreparing = Boolean\(helmConnected && !activeSession/);
  assert.match(worktreeSource, /helmConnected && activeSession && !activeSessionRestoreGate\.canChat/);
  assert.match(worktreeSource, /helmConnected=\{helmConnected\}/);
});

test("mission restore gate is rendered inside the active session card", () => {
  assert.match(chatPaneSource, /restoreNotice\?: SessionRestoreNotice/);
  assert.match(chatPaneSource, /restoreNotice=\{session\.id === selectedSessionId \? restoreNotice : undefined\}/);
  assert.match(chatPaneSource, /function SessionRestoreNotice/);
  assert.match(chatPaneSource, /data-session-restore-notice/);
  assert.doesNotMatch(worktreeSource, /mission-restore-gate m-3[\s\S]*<MissionComposer/);
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
  assert.match(worktreeSource, /useRuntimeOverviewActions\(\{/);
  assert.match(runtimeOverviewActionsSource, /pendingAcpReconnects/);
  assert.match(runtimeOverviewActionsSource, /setPendingAcpReconnects/);
  assert.match(runtimeOverviewActionsSource, /dispatch\?\.\(client, runtime\.canReconnect \? "agent\/reconnect" : "agent\/connect"/);
  assert.match(runtimeOverviewSource, /status: reconnectPending \? "未连接" : formatAcpConnectionStatus/);
  assert.match(runtimeOverviewSource, /canReconnect: !reconnectPending/);
  assert.match(runtimeOverviewSource, /canConnect: reconnectPending/);
  assert.match(runtimeOverviewSource, /agentOrder/);
  assert.match(runtimeOverviewSource, /return dedupeRuntimeOverviewItems\(items\)\.sort/);
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
  assert.match(chatPaneSource, /chat-main flex-1 w-full overflow-x-hidden min-h-0 relative/);
  assert.match(chatPaneSource, /shouldLockChatMainScroll: \(sessionCount > 0 \|\| hasDraftWindow\) && parallelGridFillsContainer/);
  assert.match(chatPaneSource, /shouldLockChatMainScroll \? "overflow-y-clip" : "overflow-y-auto"/);
  assert.match(worktreeSource, /mission-pane-chat[^\n]+flex h-full min-h-0 min-w-0 flex-col/);
  assert.match(sidebarSource, /mission-pane-sidebar[^\n]+flex h-full min-h-0 min-w-0 flex-col/);
  assert.match(displayPanelSource, /mission-pane-display[^\n]+flex h-full min-h-0 min-w-0 flex-col/);
  assert.match(inspectorSource, /mission-pane-inspector[^\n]+flex h-full min-h-0 min-w-0 flex-col/);
  assert.match(chatPaneSource, /SessionCard/);
  assert.match(
    chatPaneSource,
    /const cardCount = sessionCount \+ \(hasDraftWindow \? 1 : 0\)/,
  );
  assert.match(
    chatPaneSource,
    /const parallelGridCompact = cardCount <= 2/,
  );
  assert.match(chatPaneSource, /const parallelGridFillsContainer = parallelGridCompact \|\| singleRow/);
  assert.match(
    chatPaneSource,
    /shouldAnchorActiveParallelCard: cardCount > 2/,
  );
  assert.match(chatPaneSource, /\[contain:layout_paint\]/);
  assert.match(chatPaneSource, /!shouldAnchorActiveParallelCard \|\| !activeSession\?\.id/);
  assert.match(chatPaneSource, /gridAutoRows: parallelGridFillsContainer \? "minmax\(0, 1fr\)" : "minmax\(360px, min\(52vh, 560px\)\)"/);
  assert.match(chatPaneSource, /parallelGridFillsContainer \? "h-full min-h-0 overflow-hidden" : "min-h-full"/);
  assert.match(chatPaneSource, /ResizeObserverCtor/);
  assert.match(chatPaneSource, /mission-session-grid grid box-border gap-2 p-2/);
  assert.match(chatPaneSource, /gridTemplateColumns: "repeat\(auto-fit, minmax\(min\(100%, 360px\), 1fr\)\)"/);
  assert.match(chatPaneSource, /"h-full min-h-0 cursor-default rounded-\[8px\] border bg-surface transition-all"/);
  assert.match(chatPaneSource, /active \? "border-primary" : "border-border-ghost"/);
  assert.doesNotMatch(chatPaneSource, /boxShadow: active\s*\?\s*"inset 0 0 0 1px var\(--primary\)/);
  assert.match(chatPaneSource, /sessionMessagesById\[session\.id\]/);
  assert.match(chatPaneSource, /sessionToolCallsById\[session\.id\]/);
  assert.match(chatPaneSource, /renderSessionStream\(session\)/);
  assert.match(chatPaneSource, /data-session-card-body=\{session\.id\}/);
  assert.match(chatPaneSource, /changedSessionIds\.forEach/);
  assert.match(chatPaneSource, /if \(messageCount > 0 \|\| timelineCount > 0 \|\| toolCallCount > 0\)/);
  assert.match(chatPaneSource, /sessionBodyScrollPositionRef/);
  assert.match(chatPaneSource, /bodyScrollSnapshot\.scrollTop/);
  assert.doesNotMatch(chatPaneSource, /scrollBottom/);
  assert.match(chatPaneSource, /ResizeObserverCtor/);
  assert.match(chatPaneSource, /onBodyScroll=\{\(event\) => \{/);
  assert.match(chatPaneSource, /useLayoutEffect\(\(\) => \{/);
  assert.match(chatPaneSource, /selectedSessionId: string \| null/);
  assert.match(chatPaneSource, /active=\{session\.id === selectedSessionId\}/);
  assert.match(chatPaneSource, /data-active-session-card=\{active \? "true" : undefined\}/);
  assert.match(chatPaneSource, /chatMain\.scrollTop \+= activeCardTop - chatMainTop/);
  assert.match(chatPaneSource, /requestAnimationFrame\(anchorActiveCard\)/);
  assert.match(chatPaneSource, /setTimeout\(anchorActiveCard, 160\)/);
  assert.match(chatPaneSource, /setTimeout\(anchorActiveCard, 800\)/);
  assert.match(chatPaneSource, /AgentIcon name=\{session\.agentName\}/);
  assert.match(chatPaneSource, /MissionToolLoadingTitle/);
  assert.match(chatPaneSource, /<MissionToolLoadingTitle \{\.\.\.toolLoading\} \/>/);
  assert.match(chatPaneSource, /toolLoading=\{resolveSessionToolLoading\(singleSession\)\}/);
  assert.match(chatPaneSource, /toolLoading=\{resolveSessionToolLoading\(session\)\}/);
  assert.match(chatPaneSource, /<StatusDot tone=\{statusTone\} \/>/);
  // 普通状态走与工具执行中同款的状态框（pill），而非裸文字
  assert.match(chatPaneSource, /<SessionStatusPill status=\{session\.status\} \/>/);
  assert.match(chatPaneSource, /mission-session-status-pill/);
  assert.match(chatPaneSource, /data-session-status-label/);
  assert.match(chatPaneSource, /onRename=\{onRenameSession\}/);
  assert.match(chatPaneSource, /onClear=\{onClearSession\}/);
  assert.doesNotMatch(chatPaneSource, /isSingleSession && isActiveSession && activityLoading/);
  assert.doesNotMatch(chatPaneSource, /<MissionToolLoading\s/);
  assert.doesNotMatch(chatPaneSource, /聚焦会话/);
  assert.match(chatPaneSource, /关闭窗口/);
  assert.match(chatPaneSource, /title="关闭此 session"/);
  assert.match(chatPaneSource, /Icon name="more"/);
  assert.doesNotMatch(chatPaneSource, /rounded-md bg-surface-sunken\/70 p-3/);
});


test("mission chat pane exposes the v6 session grid and more menu actions", () => {
  assert.match(chatPaneSource, /mission-session-grid/);
  assert.match(chatPaneSource, /openSessions/);
  assert.match(chatPaneSource, /onCloseSessionView/);
  assert.match(chatPaneSource, /role="menu"/);
  assert.match(chatPaneSource, /w-\[200px\]/);
  assert.match(chatPaneSource, /Icon name="check"/);
  assert.match(chatPaneSource, /onDragOver/);
  assert.match(chatPaneSource, /onDragLeave/);
  assert.match(chatPaneSource, /onDrop=\{handleDrop\}/);
  assert.match(chatPaneSource, /application\/x-tiller-session-id/);
  assert.match(chatPaneSource, /dragOver \? "inset 0 0 0 2px var\(--primary\)" : "none"/);
  assert.match(chatPaneSource, /aria-label="新建任务"/);
  assert.match(chatPaneComponentSource, /projectOptions\.map\(\(project\) =>/);
  assert.match(chatPaneComponentSource, /onCreateTask\(project\.id\)/);
  assert.match(chatPaneComponentSource, /展示栏/);
  assert.match(chatPaneComponentSource, /Inspector 面板/);
  assert.match(chatPaneComponentSource, />\s*Thinking\s*<\/MenuItem>/);
  assert.doesNotMatch(chatPaneComponentSource, />\s*重命名\s*<\/MenuItem>/);
  assert.doesNotMatch(chatPaneComponentSource, />\s*生成摘要\s*<\/MenuItem>/);
  assert.doesNotMatch(chatPaneComponentSource, />\s*导出对话\s*<\/MenuItem>/);
  assert.doesNotMatch(chatPaneComponentSource, />\s*清理会话\s*<\/MenuItem>/);
  assert.doesNotMatch(chatPaneSource, /DropdownMenuContent/);
});

test("mission sidebar exposes search while task creation lives in the workbench header", () => {
  assert.match(sidebarSource, /aria-label="搜索任务"/);
  assert.doesNotMatch(sidebarSource, /aria-label="新建任务"/);
  assert.doesNotMatch(sidebarProjectNodeSource, /aria-label=\{`在 \$\{project\.name\} 下新建任务`\}/);
  assert.match(sidebarSource, /wb-pane-head-eyebrow whitespace-nowrap">Helm · 任务/);
  // 新建任务只弹出草稿小窗口，不再打开侧边栏 Agent 下拉框
  assert.doesNotMatch(sidebarSource, /setAgentPickerOpen\(true\)/);
  assert.match(worktreeSource, /const workbenchProjectOptions = \(projects as any\[\]\)\.map/);
  assert.match(worktreeSource, /const openNewTaskFromWorkbench = \(projectId: string\) =>/);
  assert.match(worktreeSource, /projectOptions=\{workbenchProjectOptions\}/);
  assert.match(worktreeSource, /onCreateTask=\{openNewTaskFromWorkbench\}/);
  assert.match(sidebarSource, /runtimeOverviewItems\.length/);
  assert.match(sidebarSource, /暂无 ACP 连接。/);
  assert.match(sidebarSource, /<span className="font-medium">ACP<\/span>/);
  assert.doesNotMatch(sidebarSource, /formatConnectionStatus\(connection\)/);
  assert.doesNotMatch(sidebarSource, /Icon name="branch"/);
  assert.doesNotMatch(sidebarSource, /dirty<\/span>/);
});

test("mission workspace wires session grid toggles into the chat pane", () => {
  assert.match(worktreeSource, /openChatSessionIds/);
  assert.match(worktreeSource, /useChatWindowActions\(\{/);
  assert.match(chatWindowActionsSource, /const openChatSession = \(sessionId: string\) =>/);
  assert.match(chatWindowActionsSource, /const closeChatSession = \(session: SessionSummary\) =>/);
  assert.match(worktreeSource, /openSession=\{openChatSession\}/);
  assert.match(worktreeSource, /focusedChatWindowId/);
  assert.match(worktreeSource, /buildChatWindowModel\(\{/);
  assert.match(worktreeSource, /focusedRealSessionId,/);
  assert.match(chatWindowActionsSource, /const selectChatSession = \(sessionId: string\) =>/);
  assert.match(chatWindowActionsSource, /setFocusedChatWindowId\(`session:\$\{sessionId\}`\)/);
  assert.doesNotMatch(chatWindowActionsSource, /const selectChatSession = \(sessionId: string\) => \{[\s\S]*?setActiveSessionId\(sessionId\)/);
  assert.match(worktreeSource, /useOpenSessionStreams\(\{/);
  assert.match(openSessionStreamsSource, /const hydrateOpenSessionStreams = \(sessionIds: string\[\]\) =>/);
  assert.match(openSessionStreamsSource, /openSessionTopicSubscriptionsRef/);
  assert.match(openSessionStreamsSource, /subscribeToSessionTopic\(client, sessionId, dispatch\)/);
  assert.match(openSessionStreamsSource, /unsubscribeFromSessionTopic\(client, sessionId, dispatch\)/);
  assert.match(openSessionStreamsSource, /dispatch\(client, "session\/list_messages"/);
  assert.match(openSessionStreamsSource, /dispatch\(client, "session\/get_artifacts"/);
  assert.match(openSessionStreamsSource, /openSessionResumeCheckRef/);
  assert.match(openSessionStreamsSource, /resumeCheckSessionIds/);
  assert.match(openSessionStreamsSource, /openSessionResumeCheckRef\.current\.add\(sessionId\)/);
  assert.match(openSessionStreamsSource, /dispatch\(client, "session\/check_resume", \{ sessionId \}\)/);
  assert.match(sessionStreamsSource, /session\.status !== "running"/);
  assert.match(sessionStreamsSource, /session\.resume\?\.state !== "resume-unavailable"/);
  assert.match(worktreeSource, /sessions: sessions as SessionSummary\[\]/);
  assert.match(openSessionStreamsSource, /setMessageHistoryState\(\(current: any\) =>/);
  assert.match(openSessionStreamsSource, /setActivityHistoryState\(\(current: any\) =>/);
  assert.match(chatWindowActionsSource, /hydrateOpenSessionStreams\(\[sessionId\]\)/);
  assert.match(openSessionStreamsSource, /hydrateOpenSessionStreams\(openSessions\.map\(\(session\) => session\.id\)\)/);
  assert.match(worktreeSource, /focusedDraftWindow,/);
  assert.match(worktreeSource, /selectedComposerSession,/);
  assert.match(worktreeSource, /contextSession=\{selectedComposerSession\}/);
  assert.match(worktreeSource, /highlightedSessionId=\{focusedRealSessionId \?\? activeSessionId\}/);
  assert.match(worktreeSource, /onFocusSession=\{openChatSession\}/);
  assert.match(worktreeSource, /onSelectSessionView=\{selectChatSession\}/);
  assert.match(worktreeSource, /onCloseSessionView=\{closeChatSession\}/);
  assert.match(worktreeSource, /openSessions=/);
  assert.match(worktreeSource, /sidebarCollapsed=\{effectiveSidebarCollapsed\}/);
  assert.match(worktreeSource, /onExpandSidebar=\{\(\) => setMissionSidebarCollapsed\(false\)\}/);
  assert.match(worktreeSource, /onCollapse=\{onToggleDisplay\}/);
  assert.match(worktreeSource, /onCollapse=\{onToggleInspector\}/);
  assert.match(worktreeSource, /setMissionDisplayCollapsed/);
  assert.match(worktreeSource, /setMissionInspectorCollapsed/);
  assert.match(missionLayoutHookSource, /sidebar: \{ min: 0 \}/);
  assert.match(missionLayoutHookSource, /chat: \{ min: MISSION_MIN_CHAT_WIDTH \}/);
  assert.match(missionLayoutHookSource, /display: \{ min: 0 \}/);
  assert.match(missionLayoutHookSource, /inspector: \{ min: 0 \}/);
  assert.match(worktreeSource, /ResizablePanelGroup/);
  assert.match(worktreeSource, /resizeTargetMinimumSize=\{\{ fine: 4, coarse: 16 \}\}/);
  assert.match(worktreeSource, /resizer=\{null\}/);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-resizable-group,[\s\S]*display:\s*contents !important;/);
});

test("mission chat window state is provided by deck store instead of local useState", () => {
  assert.match(missionRouteSource, /draftChatWindow=\{draftChatWindow\}/);
  assert.match(missionRouteSource, /setDraftChatWindow=\{setDraftChatWindow\}/);
  assert.match(missionRouteSource, /openChatSessionIds=\{openChatSessionIds\}/);
  assert.match(missionRouteSource, /setOpenChatSessionIds=\{setOpenChatSessionIds\}/);
  assert.match(missionRouteSource, /focusedChatWindowId=\{focusedChatWindowId\}/);
  assert.match(missionRouteSource, /setFocusedChatWindowId=\{setFocusedChatWindowId\}/);
  assert.doesNotMatch(worktreeSource, /const \[openChatSessionIds, setOpenChatSessionIds\] = useState/);
  assert.doesNotMatch(worktreeSource, /const \[focusedChatSessionId, setFocusedChatSessionId\] = useState/);
});

test("mission chat pane renders draft windows as first-class cards", () => {
  assert.match(chatPaneSource, /type MissionDraftChatWindow/);
  assert.match(chatPaneSource, /draftWindow\?: MissionDraftChatWindow \| null/);
  assert.match(chatPaneSource, /function DraftSessionCard/);
  assert.match(chatPaneSource, /data-draft-session-card/);
  assert.match(chatPaneSource, /data-draft-agent-options/);
  assert.match(chatPaneSource, /onSelectAgent\?\.\(agent\.id\)/);
  assert.match(worktreeSource, /draftWindow=\{visibleDraftChatWindow\}/);
  assert.match(worktreeSource, /draftAgentOptions=\{visibleDraftAgentOptions\}/);
  assert.match(worktreeSource, /onSelectDraftAgent=\{selectAgentForDraftWindow\}/);
  assert.match(chatWindowActionsSource, /const openDraftChatWindow = \(\{/);
  assert.match(chatWindowActionsSource, /setFocusedChatWindowId\(draftWindow\.id\)/);
  assert.match(chatWindowActionsSource, /setActiveSessionId\(null\)/);
  assert.match(worktreeSource, /selectedSessionId=\{missionChatSelectedSessionId\}/);
  assert.match(workspaceChatCompositionSource, /return focusedDraftWindow \? null : focusedRealSessionId \?\? activeSessionId \?\? null/);
  assert.match(worktreeSource, /onSelectDraftWindow=\{\(draftWindowId\) => \{[\s\S]*?setActiveSessionId\(null\);/);
  assert.match(worktreeSource, /onSelectDraftAgent=\{selectAgentForDraftWindow\}/);
  assert.match(worktreeSource, /submitPrompt=\{submitPromptFromFocusedWindow\}/);
  assert.match(worktreeSource, /const effectiveSelectedAgentId = focusedDraftWindow\?\.agentId \?\? selectedAgentId/);
  assert.match(worktreeSource, /const effectiveSelectedCwd = focusedDraftWindow\?\.cwd \?\? selectedCwd/);
  assert.match(worktreeSource, /const selectDraftWorktreeForFocusedWindow = \(worktreePath: string\) =>/);
  assert.match(worktreeSource, /selectDraftWorktree\(worktreePath\)/);
  assert.match(worktreeSource, /current\?\.id === focusedDraftWindow\.id[\s\S]*cwd: worktreePath/);
  assert.match(missionRouteSource, /selectProject=\{selectProject\}/);
  assert.match(worktreeSource, /const selectDraftProjectForFocusedWindow = \(projectId: string\) =>/);
  assert.match(worktreeSource, /selectProject\(projectId\)/);
  assert.match(worktreeSource, /id: nextDraftWindowId, projectId, cwd: nextCwd, agentId: null/);
  assert.match(worktreeSource, /setFocusedChatWindowId\(nextDraftWindowId\)/);
  assert.match(worktreeSource, /draftProjectOptions=\{missionProjects\}/);
  assert.match(worktreeSource, /selectDraftProject=\{selectDraftProjectForFocusedWindow\}/);
  assert.match(composerSource, /draftProjectOptions\.map\(\(project\) =>/);
  assert.match(composerSource, /aria-label=\{projectPickerAvailable \? "选择项目" : undefined\}/);
  assert.match(worktreeSource, /selectedWorktreeName=\{effectiveSelectedWorktreeName\}/);
  assert.match(worktreeSource, /selectedProjectName=\{effectiveSelectedProjectName\}/);
  assert.match(worktreeSource, /selectedProjectId=\{effectiveSelectedProjectId\}/);
  assert.match(worktreeSource, /selectedCwd=\{effectiveSelectedCwd\}/);
  assert.match(worktreeSource, /selectDraftWorktree=\{selectDraftWorktreeForFocusedWindow\}/);
  assert.match(worktreeSource, /selectedDraftAgent=\{effectiveSelectedDraftAgent\}/);
  assert.match(worktreeSource, /selectedAgentId=\{effectiveSelectedAgentId\}/);
  assert.match(chatWindowActionsSource, /setSelectedAgentId\(focusedDraftWindow\.agentId\)/);
  assert.match(chatWindowActionsSource, /pendingDraftWindowRef/);
  assert.match(chatWindowActionsSource, /setDraftChatWindow\?\.\(null\)/);
});

test("mission composer mirrors the v6 sunken command deck", () => {
  assert.match(composerSource, /border-t border-border-ghost px-2 py-1\.5 bg-surface/);
  assert.match(composerSource, /wb-pane-sunken px-2 py-1\.5 w-full max-w-\[min\(1120px,calc\(100%_-_32px\)\)\] mx-auto/);
  assert.match(composerSource, /rows=\{2\}/);
  assert.match(composerSource, /const composerSession = contextSession \?\? activeSession/);
  assert.match(composerSource, /composerSession\?\.agentName/);
  assert.match(composerSource, /composerSession\?\.title/);
  assert.match(composerSource, /onSubmit=\{\(event\) => submitPrompt\(event, composerSession\)\}/);
  assert.match(composerSource, /aria-label="选择 Worktree"/);
  assert.match(composerSource, /draftWorktreeOptions\.map\(\(worktree\) =>/);
  assert.match(composerSource, /selectDraftWorktree\(worktree\.path\)/);
  assert.match(sessionCommandActionsSource, /function submitPrompt\(event: FormEvent<HTMLFormElement>, targetSession\?: SessionSummary \| null\)/);
  assert.match(sessionCommandActionsSource, /const promptSession = targetSession === undefined \? activeSession : targetSession/);
  assert.match(sessionCommandActionsSource, /targetSession === undefined[\s\S]*\? promptSession\?\.id \?\? activeSessionId[\s\S]*: promptSession\?\.id \?\? null/);
  assert.match(sessionCommandActionsSource, /activeSessionId: promptSessionId/);
  assert.match(composerSource, /MissionStatusBar[\s\S]*col-start-2 self-center justify-self-center/);
  assert.doesNotMatch(composerSource, /esc 取消 · ↑ 历史/);
  assert.match(composerSource, /Icon name="send"/);
  assert.doesNotMatch(composerSource, /mission-order-editor grid gap-3 rounded-md border/);
});

test("mission shell fills the viewport so the project pane stays visible on desktop", () => {
  assert.match(shellStylesSource, /\.shell\.v6-radial-shell\s*{[^}]*width:\s*100vw;/s);
  assert.match(shellStylesSource, /\.shell\.view-sessions\.v6-radial-shell\s*{[^}]*padding:\s*8px;/s);
  assert.match(shellStylesSource, /\.shell\.v6-radial-shell \.page-content\s*{[^}]*height:\s*100%;/s);
  assert.doesNotMatch(shellStylesSource, /\.shell\.view-sessions\s*{[^}]*padding:\s*96px 12px 12px;/s);
});

test("mission project sidebar uses shared primitives and explicit Tailwind tree rows", () => {
  assert.match(sidebarSource, /Badge/);
  assert.match(sidebarSource, /wb-pane-head/);
  assert.match(sidebarSource, /bg-surface-sunken border-r border-border-ghost/);
  assert.match(sidebarSource, /mission-tree-switcher flex-1 overflow-auto p-1/);
  assert.doesNotMatch(sidebarSource, /Helm → Project → Session/);
  assert.doesNotMatch(sidebarProjectNodeSource, /mission-tree-new-inline/);
  assert.match(sidebarProjectNodeSource, /grid-cols-\[12px_14px_minmax\(0,1fr\)_auto\]/);
  assert.doesNotMatch(sidebarProjectNodeSource, />Project<\/span>/);
  assert.match(sessionRowSource, /grid-cols-\[14px_minmax\(0,1fr\)_auto\]/);
});

test("mission sidebar rows stay compact and session actions open below rows", () => {
  assert.match(sidebarSource, /sidebar-section mission-tree-switcher flex-1 overflow-auto p-1/);
  assert.match(sidebarSource, /mission-tree grid gap-1/);
  assert.match(sidebarProjectNodeSource, /px-1\.5 h-5/);
  assert.match(sidebarProjectNodeSource, /ml-1 grid gap-1 pl-0/);
  assert.doesNotMatch(sidebarProjectNodeSource, /border-l border-border-ghost pl-1\.5/);
  assert.doesNotMatch(sidebarProjectNodeSource, /ml-4 grid gap-1 border-l border-border-ghost pl-2/);
  assert.match(sessionRowSource, /px-1\.5 h-5/);
  assert.match(sessionRowSource, /DropdownMenuContent/);
  assert.doesNotMatch(sessionRowSource, /mission-tree-session-menu absolute/);
});

test("mission session rows stay tree-like instead of selected card pills", () => {
  assert.match(sessionRowSource, /grid-cols-\[14px_minmax\(0,1fr\)_auto\]/);
  assert.match(sessionRowSource, /highlightedSessionId: string \| null/);
  assert.match(sessionRowSource, /const isOpenSession = openSessionIds\.has\(session\.id\)/);
  assert.match(sessionRowSource, /const isHighlighted = isFocused \|\| isOpenSession/);
  assert.match(sessionRowSource, /before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0\.5 before:rounded-full before:bg-primary/);
  assert.doesNotMatch(sessionRowSource, /mission-tree-caret/);
  assert.doesNotMatch(sessionRowSource, /mission-tree-session-meta/);
  assert.doesNotMatch(sessionRowSource, /\{session\.agentName\}<\/span>/);
  assert.match(sessionRowSource, /mission-tree-cleanup/);
  assert.doesNotMatch(sessionRowSource, /session\.id === activeSessionId && "text-primary"/);
  assert.doesNotMatch(sessionRowSource, /rounded-xl/);
  assert.doesNotMatch(sessionRowSource, /border-l border-transparent/);
  assert.doesNotMatch(sessionRowSource, /border-l border-current/);
});

test("mission pane resizing keeps only chat width constrained", () => {
  assert.match(missionLayoutHookSource, /const MISSION_MIN_CHAT_WIDTH = 360/);
  assert.match(missionLayoutHookSource, /sidebar: \{ min: 0 \}/);
  assert.match(missionLayoutHookSource, /display: \{ min: 0 \}/);
  assert.match(missionLayoutHookSource, /inspector: \{ min: 0 \}/);
  assert.doesNotMatch(missionLayoutHookSource, /max: 360/);
  assert.doesNotMatch(missionLayoutHookSource, /max: 560/);
  assert.doesNotMatch(missionLayoutHookSource, /max: 440/);
  assert.match(worktreeSource, /minSize=\"0px\"/);
  assert.match(worktreeSource, /minSize=\"360px\"/);
});

test("mission compact chrome avoids wrapping and over-indentation", () => {
  assert.match(sidebarSource, /wb-pane-head-eyebrow[^\n]+whitespace-nowrap/);
  assert.match(sidebarProjectNodeSource, /mission-tree-children-sessions ml-1/);
  assert.doesNotMatch(sidebarProjectNodeSource, /mission-tree-children-sessions ml-3/);
  assert.match(composerSource, /composerProjectLabel/);
  assert.match(composerSource, /composerAgentLabel/);
  assert.match(composerSource, /composerSession\?\.projectName/);
  assert.match(composerSource, /composerSession\?\.agentName/);
});

test("mission diff and inspector commit controls support full-row review", () => {
  assert.match(diffTreeSource, /mission-diff-patch grid max-w-full min-w-0 grid-cols-\[max-content\]/);
  assert.match(diffTreeSource, /mission-diff-line grid min-w-full/);
  assert.match(diffTreeSource, /grid-cols-\[2\.5rem_max-content\]/);
  assert.match(diffTreeSource, /style=\{\{ display: "grid" \}\}/);
  assert.match(diffTreeSource, /visibleLines = patch\.split/);
  assert.match(diffTreeSource, /isDiffHeaderLine/);
  assert.match(diffPanelSource, /selectedCommitDiffPaths/);
  assert.match(diffPanelSource, /onToggleCommitDiffDirectory/);
  assert.match(diffPanelSource, /collectDiffFilePaths/);
  assert.match(diffPanelSource, /\[scrollbar-width:none\]/);
  assert.match(inspectorSource, /\[scrollbar-width:none\]/);
  assert.match(inspectorSource, /msOverflowStyle: \"none\"/);
  assert.match(shellStylesSource, /\.mission-inspector-diff\s*\{[^}]*scrollbar-width:\s*none;/s);
  assert.match(inspectorSource, /生成描述/);
  assert.match(inspectorSource, /selectedDiffCount/);
});

test("mission tool call rows stay compact", () => {
  assert.match(plainMessagesSource, /plain-assistant-segment-dot size-1\.5 rounded-full ring-2/);
  assert.match(plainMessagesSource, /plain-thinking[^\n]+rounded-\[8px\][^\n]+bg-surface-sunken\/55/);
  assert.match(plainMessagesSource, /plain-tool-group[^\n]+rounded-\[8px\][^\n]+bg-surface-sunken\/55/);
  assert.match(plainMessagesSource, /plain-tool-call grid gap-0\.5 py-0\.5/);
  assert.match(plainMessagesSource, /resolveToolCallIconName/);
  assert.match(plainMessagesSource, /plain-tool-group-content[^\n]+max-h-36/);
  assert.doesNotMatch(plainMessagesSource, />混合</);
  assert.doesNotMatch(plainMessagesSource, /BUILT-IN/);
  assert.match(plainMessagesSource, /mission-message-attachments ml-auto flex w-fit max-w-full flex-wrap justify-end gap-2 justify-self-end/);
  assert.match(plainMessagesSource, /mission-message-image w-24 max-w-\[28vw\] shrink-0/);
  assert.match(plainMessagesSource, /mission-message-image-preview-trigger/);
  assert.match(plainMessagesSource, /mission-message-image-lightbox/);
  assert.match(plainMessagesSource, /createPortal\(/);
  assert.match(plainMessagesSource, /document\.body/);
  assert.match(plainMessagesSource, /className="h-14 w-full object-cover"/);
  assert.match(plainMessagesSource, /message\.role !== "user" && message\.attachments\?\.length \?[\s\S]*mission-message-attachments flex max-w-full flex-wrap justify-start gap-2/);
  assert.doesNotMatch(plainMessagesSource, /mission-message-attachments[^\n]+overflow-x-auto/);
  assert.doesNotMatch(plainMessagesSource, /mission-message-attachments[^\n]+flex-nowrap/);
});

test("mission display keeps v6 diff viewer chrome as the primary display surface", () => {
  assert.match(displayPanelSource, /mission-diff-detail grid min-h-0 overflow-hidden/);
  assert.doesNotMatch(displayPanelSource, /mission-diff-detail grid min-h-0 gap-2 overflow-hidden/);
  assert.match(displayPanelSource, /mission-diff-file min-w-0 overflow-hidden bg-transparent/);
  assert.doesNotMatch(displayPanelSource, /mission-diff-file min-w-0 overflow-hidden rounded-\[8px\]/);
  assert.doesNotMatch(displayPanelSource, /mission-diff-file min-w-0 overflow-hidden border-l border-border-ghost/);
  assert.doesNotMatch(displayPanelSource, /mission-file-row mission-diff-file-summary[^\n]+border-b border-border-ghost/);
  assert.doesNotMatch(diffTreeSource, /mission-diff-patch[^\n]+rounded-b-md border-t border-border-ghost/);
  assert.doesNotMatch(displayPanelSource, /mission-logbook-page/);
  assert.match(logbookPanelSource, /mission-logbook-layout grid h-full min-h-0 grid-rows-\[auto_minmax\(0,1fr\)\]/);
  assert.match(logbookPanelSource, /mission-logbook-scroll min-h-0 overflow-auto/);
});

test("mission display page navigation is placed above the content", () => {
  assert.match(displayPanelSource, /mission-display-tab-strip/);
  assert.match(displayPanelSource, /mission-panel-content min-h-0 flex-1 overflow-auto p-0/);
  assert.doesNotMatch(displayPanelSource, /MissionPanelNav/);
  assert.doesNotMatch(displayPanelSource, /mission-panel-body grid min-h-0 flex-1 grid-rows-\[auto_minmax\(0,1fr\)\]/);
});

test("mission display pane mirrors the v6 viewer chrome", () => {
  assert.match(displayPanelSource, /wb-pane-head-eyebrow">展示栏/);
  assert.match(displayPanelSource, /aria-label="收起展示栏"/);
  assert.match(displayPanelSource, /onClick=\{onCollapse\}/);
  assert.match(displayPanelSource, /mission-display-tab-strip/);
  assert.match(displayPanelSource, /rounded\b/);
  assert.match(displayPanelSource, /mission-display-status-bar/);
  assert.doesNotMatch(displayPanelSource, /MissionPanelNav/);
  assert.doesNotMatch(displayPanelSource, /MissionPanelHeader title="任务展示" bordered \/>/);
});

test("mission inspector mirrors the v6 worktree chrome", () => {
  assert.match(inspectorSource, /wb-pane-head/);
  assert.match(inspectorSource, /工作区/);
  assert.match(inspectorSource, /aria-label="收起检视器"/);
  assert.match(inspectorSource, /onClick=\{onCollapse\}/);
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

test("mission display no longer renders overview/runtime blocks in the v6 viewer", () => {
  assert.doesNotMatch(displayPanelSource, /parseOverviewItem/);
  assert.doesNotMatch(displayPanelSource, /mission-overview-card/);
  assert.doesNotMatch(displayPanelSource, /mission-runtime-overview/);
  assert.doesNotMatch(displayPanelSource, /<InfoList/);
});

test("mission avoids fetching or rendering every project file by default", () => {
  assert.doesNotMatch(missionSelectionEffectsSource, /project\/list_files/);
  assert.match(worktreeModelSource, /const projectFiles = \[\]/);
  assert.match(worktreeModelSource, /const visibleProjectFiles = \[\]/);
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
  assert.match(missionLayoutHookSource, /MISSION_RESIZER_WIDTH = 4/);
  assert.match(missionLayoutHookSource, /MISSION_MIN_CHAT_WIDTH = 360/);
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
  assert.match(worktreeSource, /displayPaneCollapsed && "mission-display-collapsed"/);
  assert.match(worktreeSource, /<MissionDisplaySection/);
  assert.doesNotMatch(worktreeSource, /!effectiveDisplayCollapsed \? \(\s*<MissionDisplaySection/s);
  assert.match(worktreeSource, /<ResizablePanelGroup[\s\S]*direction="horizontal"/);
  assert.match(worktreeSource, /!displayPaneCollapsed \? \(\s*<ResizableHandle[\s\S]*调整任务展示宽度/s);
  assert.match(worktreeSource, /mission-pane-chat[^\"]*col-start-3 col-end-4/);
  assert.doesNotMatch(worktreeSource, /max-\[860px\]:h-auto/);
  assert.doesNotMatch(worktreeSource, /max-\[860px\]:flex-col/);
  assert.match(sidebarSource, /mission-pane-sidebar col-start-1 col-end-2/);
  assert.match(displayPanelSource, /mission-pane-display col-start-5 col-end-6/);
  assert.match(inspectorSource, /mission-pane-inspector col-start-7 col-end-8/);
  assert.match(worktreeSource, /ResizablePanel/);
  assert.match(worktreeSource, /ResizableHandle/);
  assert.match(worktreeSource, /id="mission-sidebar"/);
  assert.match(worktreeSource, /id="mission-chat"/);
  assert.match(worktreeSource, /id="mission-display"/);
  assert.match(worktreeSource, /id="mission-inspector"/);
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
  assert.match(worktreeSource, /isMissionMobile \|\| !displayPaneCollapsed \? \(/);
  assert.match(worktreeSource, /!isMissionMobile && !effectiveInspectorCollapsed \? \(\s*<ResizableHandle[\s\S]*调整检视器宽度/s);
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

const composerAttachmentsSource = readFileSync(
  resolve(currentDir, "../composer/attachments.tsx"),
  "utf8",
);
const sessionOverviewCardSource = readFileSync(
  resolve(currentDir, "../display/session-overview-card.tsx"),
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
  assert.doesNotMatch(shellStylesSource, /scrollbar-gutter:\s*stable/);
  assert.match(plainMessagesSource, /data-mission-swipe-lock="true"/);
  assert.match(logbookPanelSource, /data-mission-swipe-lock="true"/);
  assert.match(diffPanelSource, /data-mission-swipe-lock="true"/);
});

test("session scroll-to-bottom button stays absolute inside responsive panes", () => {
    assert.match(
      shellStylesSource,
      /\.mission-responsive-mode \[data-mission-mobile-pane\] \[data-session-scroll-bottom\]\s*{[^}]*position:\s*absolute;/s,
    );
    assert.match(
      shellStylesSource,
      /\[data-session-scroll-bottom\]\s*{[^}]*position:\s*absolute;[^}]*right:\s*0\.75rem;/s,
    );
    assert.match(
      shellStylesSource,
      /\[data-session-scroll-bottom-position="bottom"\]\s*{[^}]*bottom:\s*0\.75rem;/s,
    );
    assert.match(
      shellStylesSource,
      /\[data-session-scroll-bottom-position="above-plan"\]\s*{[^}]*bottom:\s*3\.5rem;/s,
    );
  });

test("mission composer is sticky and swipe-locked on mobile", () => {
  assert.match(composerSource, /mission-composer/);
  assert.match(composerSource, /data-mission-swipe-lock="true"/);
  assert.match(composerSource, /rows=\{2\}/);
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
  assert.doesNotMatch(shellStylesSource, /\.mission-responsive-mode \.mission-permission-drawer/);
  assert.match(shellStylesSource, /\.mission-mobile-mode \.mission-sidebar-toggle\s*{[^}]*display:\s*none;/s);
});

test("mission wide headers truncate long titles instead of consuming layout", () => {
  assert.match(shellStylesSource, /\.mission-panel-head > div,\s*\.mission-inspector-section-head > div\s*{[^}]*min-width:\s*0;/s);
  assert.match(shellStylesSource, /\.mission-panel-head h3,\s*\.mission-inspector-section-head h3\s*{[^}]*text-overflow:\s*ellipsis;/s);
});

test("mission display and logbook headers stay compact on mobile", () => {
  assert.match(sessionOverviewCardSource, /mission-session-overview/);
  assert.match(sessionOverviewCardSource, /rounded\b/);
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
  assert.match(diffPanelSource, /mission-file-row-compact[^\"]*grid w-full grid-cols-\[16px_minmax\(0,1fr\)_auto_auto\][^\"]*gap-1[^\"]*px-1[^\"]*py-0\.5[^\"]*text-meta/);
  assert.match(diffPanelSource, /mission-file-status[^\"]*grid size-3 place-items-center/);
  assert.match(diffPanelSource, /mission-change-group-title[^\"]*grid w-full grid-cols-\[16px_minmax\(0,1fr\)_auto_auto\][^\"]*gap-1[^\"]*px-1[^\"]*py-0\.5[^\"]*text-meta/);
  assert.match(diffTreeSource, /diff-meta-split[^\"]*gap-1[^\"]*text-xs/);
});

test("mission worktree uses default-closed display pane behavior", () => {
  assert.match(worktreeSource, /const hasSelectedDisplayDiff = activeDiffs\.some/);
  assert.match(worktreeSource, /file\.path === selectedMissionDiffFilePath/);
  assert.match(worktreeSource, /\(openedMissionDiffFilePaths \?\? \[\]\)\.includes\(file\.path\)/);
  assert.match(worktreeSource, /const displayPaneCollapsed = effectiveDisplayCollapsed \|\| !hasSelectedDisplayDiff/);
  assert.match(worktreeSource, /displayCollapsed=\{displayPaneCollapsed\}/);
  assert.match(worktreeSource, /canToggleDisplay=\{hasSelectedDisplayDiff\}/);
  assert.match(chatPaneComponentSource, /disabled=\{!canToggleDisplay\}/);
  assert.match(worktreeSource, /!isMissionMobile && !displayPaneCollapsed/);
});
