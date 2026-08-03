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
const displaySectionSource = readFileSync(resolve(currentDir, "../display/section.tsx"), "utf8");
const promptSubmissionSource = readFileSync(
  resolve(currentDir, "../orchestration/prompt-submission.ts"),
  "utf8",
);
const sessionActionsSource = readFileSync(
  resolve(currentDir, "../actions/session-actions.ts"),
  "utf8",
);
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
const gitSyncSource = readFileSync(resolve(currentDir, "../workspace/git-sync.ts"), "utf8");
const gitOperationsSource = readFileSync(resolve(currentDir, "../workspace/git-operations.ts"), "utf8");
const inventoryEventsSource = readFileSync(
  resolve(currentDir, "../../server-events/inventory-events.ts"),
  "utf8",
);
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
const worktreeListSource = readFileSync(resolve(currentDir, "../workspace/worktree-list.tsx"), "utf8");
const inspectorSource = readFileSync(resolve(currentDir, "../inspector/panel.tsx"), "utf8");
const panelHeaderSource = readFileSync(resolve(currentDir, "../inspector/panel-header.tsx"), "utf8");
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
const promptAutosizeSource = readFileSync(resolve(currentDir, "../hooks/prompt-autosize.ts"), "utf8");
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

test("mission message history loading keeps artifact pagination outside chat pagination", () => {
  const historyPaginationSource = readFileSync(resolve(currentDir, "../hooks/history-pagination.ts"), "utf8");

  assert.match(historyPaginationSource, /function loadOlderActivities/);
  assert.match(historyPaginationSource, /buildConversationPaginationPlan/);
  assert.match(historyPaginationSource, /if \(!client \|\| !plan\.listTimeline\)/);
  assert.doesNotMatch(historyPaginationSource, /plan\.getArtifacts/u);
});

test("mission chat history state no longer depends on activity history pages", () => {
  assert.match(worktreeSource, /messageHistoryState=\{messageHistoryState\}/);
  assert.match(messageTimelineSource, /resolveConversationHistoryState/);
  assert.match(messageTimelineSource, /resolveConversationHistoryFlags/);
  assert.doesNotMatch(chatPaneSource, /activityHistoryState: Record<string, HistoryState \| undefined>/u);
  assert.doesNotMatch(chatPaneSource, /activityHistoryStateBySession/u);
});

test("mission chat renders permission drawers inside matching session cards", () => {
  const permissionDrawerSource = readFileSync(resolve(currentDir, "../conversation/permission-drawer.tsx"), "utf8");

  assert.match(chatPaneSource, /pendingApprovalsBySession/);
  assert.match(chatPaneSource, /pendingApprovals=\{pendingApprovalsBySession\[session\.id\]/);
  assert.match(chatPaneSource, /<MissionPermissionDrawer/);
  assert.match(chatPaneSource, /blockingOverlay=\{approvalStack\}/);
  assert.match(chatPaneSource, /data-session-blocking-overlay/);
  assert.match(chatPaneSource, /top-1\/2/);
  assert.match(chatPaneSource, /-translate-y-1\/2/);
  assert.doesNotMatch(permissionDrawerSource, /sticky/);
  assert.doesNotMatch(permissionDrawerSource, /top-2/);
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
    assert.match(chatPaneSource, /<MissionChatSessionCard/);
    assert.match(chatPaneSource, /const visiblePlan =/);
    assert.match(chatPaneSource, /dismissedCompletedSessionPlanKeys/);
    assert.match(chatPaneSource, /createAgentPlanDismissalKey\(plan\)/);
    assert.match(chatPaneSource, /plan=\{visiblePlan\}/);
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
  assert.match(chatPaneComponentSource, /memo\(function MissionChatSessionCard/);
  assert.doesNotMatch(chatPaneComponentSource, /renderSessionStream\(session\)/);
  assert.match(messageTimelineSource, /useCallback/);
  assert.doesNotMatch(messageTimelineSource, /onLoadOlderMessages=\{\(\) => \{/);
});

test("markdown table wrapper keeps horizontal scrolling without generic overflow CSS", () => {
  assert.match(plainMessagesSource, /plain-message-list conversation-timeline mx-auto grid w-full max-w-\[min\(1120px,calc\(100%_-_8px\)\)\]/);
  assert.match(plainMessagesSource, /const ASSISTANT_MESSAGE_FRAME_CLASS = "mr-auto w-\[calc\(100%-0\.625rem\)\] max-w-\[calc\(100%-0\.625rem\)\]"/);
  assert.match(plainMessagesSource, /\$\{ASSISTANT_MESSAGE_FRAME_CLASS\} grid \$\{ASSISTANT_MESSAGE_RAIL_CLASS\} items-start/);
  assert.match(plainMessagesSource, /ml-auto grid w-full justify-items-end/);
  assert.match(plainMessagesSource, /plain-message-user-row flex w-full min-w-0 max-w-full items-start justify-end gap-1\.5/);
  assert.match(plainMessagesSource, /plain-thinking-row \${ASSISTANT_MESSAGE_FRAME_CLASS} grid \${ASSISTANT_MESSAGE_RAIL_CLASS} items-start text-muted-foreground/);
  assert.match(plainMessagesSource, /plain-tool-row \${ASSISTANT_MESSAGE_FRAME_CLASS} grid \${ASSISTANT_MESSAGE_RAIL_CLASS} items-start text-muted-foreground/);
  assert.match(plainMessagesSource, /USER_MESSAGE_RAIL_CLASS = "w-fit max-w-\[min\(56rem,76%\)\]"/);
  assert.match(plainMessagesSource, /\$\{messageBodyClassName\} \$\{USER_MESSAGE_RAIL_CLASS\} min-w-0 break-words/);
  assert.match(plainMessagesSource, /"rounded-\[14px\] border border-primary\/30 bg-primary-soft\/35 px-3 py-2/);
  assert.doesNotMatch(plainMessagesSource, /rounded-2xl border border-border-ghost bg-surface-elevated/);
  assert.doesNotMatch(plainMessagesSource, /border border-border-ghost\/70/);
  assert.doesNotMatch(plainMessagesSource, /rounded-md bg-surface-emphasis\/45/);
  assert.match(plainMessagesSource, /message\.role === "user" && message\.attachments\?\.length \?/);
  assert.match(plainMessagesSource, /mission-message-attachments[\s\S]*?\) : null\}\s*\{isSystem \? \(/);
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
  assert.match(markdownSource, /markdown-message space-y-4 text-\[12px\] leading-\[1\.5\]/);
  assert.match(markdownSource, /markdown-heading pb-2 text-\[14\.5px\]/);
  assert.match(shellStylesSource, /\.markdown-message > \.markdown-paragraph\s*{[^}]*padding-bottom:\s*calc\(var\(--spacing\) \* 4\);/s);
  assert.match(shellStylesSource, /\.markdown-message > \.markdown-paragraph:last-child,\s*\.markdown-message > \.markdown-heading:last-child\s*{[^}]*padding-bottom:\s*0;/s);
  assert.doesNotMatch(markdownSource, /markdown-heading my-/);
  assert.match(markdownSource, /className="list-disc space-y-1 pl-4 marker:text-primary"/);
  assert.doesNotMatch(markdownSource, /className="my-1\.5 list-disc/);
  assert.doesNotMatch(markdownSource, /className="my-1\.5 list-decimal/);
  assert.doesNotMatch(markdownSource, /className="my-1\.5 border-l-2/);
  assert.match(markdownSource, /markdown-table-cell border-t border-border-ghost px-2\.5 py-1\.5 align-top text-\[12px\] text-foreground/);
  assert.match(markdownSource, /className="markdown-code-block overflow-hidden/);
  assert.match(markdownSource, /className="overflow-x-auto/);
  assert.match(markdownSource, /className="not-prose flex items-center justify-between/);
});

test("plain conversation text uses compact small-pane typography", () => {
  assert.match(plainMessagesSource, /grid-cols-\[0\.375rem_minmax\(0,1fr\)\][^\n]+gap-x-1/);
  assert.doesNotMatch(plainMessagesSource, /grid-cols-\[0\.75rem_minmax\(0,1fr\)\][^\n]+gap-x-2\.5/);
  assert.match(plainMessagesSource, /messageBodyClassName\} min-w-0 max-w-full overflow-hidden text-\[12\.5px\] leading-\[1\.5\]/);
  assert.match(plainMessagesSource, /plain-thinking-content[^\n]+text-\[12\.5px\] leading-\[1\.5\]/);
  assert.match(plainMessagesSource, /plain-tool-group-content[^\n]+text-\[12\.5px\]/);
  assert.match(chatPaneSource, /reserveFloatingDockSpace \? "pb-0" : "pb-8"/);
  assert.match(chatPaneSource, /hasFloatingDock \? "pb-16" : noDockBottomPaddingClass/);
  assert.match(chatPaneSource, /paddingBottom: floatingDockPadding/);
  assert.match(chatPaneSource, /data-session-bottom-spacer/);
  assert.match(chatPaneSource, /reserveFloatingDockSpace=\{hasSessionContent\}/);
  assert.match(chatPaneSource, /data-session-floating-dock-spacer/);
  assert.match(chatPaneSource, /position="dock-top"/);
  assert.match(chatPaneSource, /overflow-y-auto overflow-x-hidden px-2\.5 pb-9 pt-2\.5/);
});

test("markdown normalizes text only when the source text or repair mode changes", () => {
  assert.match(
    markdownSource,
    /useMemo\(\s*\(\) => normalizeMarkdownMessageText\(text, \{ repairMalformedTables \}\),\s*\[text, repairMalformedTables\],\s*\)/,
  );
});

test("completed assistant markdown can opt into malformed table repair without affecting streaming renders", () => {
  assert.match(markdownSource, /repairMalformedTables = false/);
  assert.match(markdownSource, /normalizeMarkdownMessageText\(text, \{ repairMalformedTables \}\)/);
  assert.match(plainMessagesSource, /<MarkdownMessage text=\{message\.text\} repairMalformedTables \/>/);
  assert.doesNotMatch(
    plainMessagesSource,
    /<MarkdownMessage text=\{segmented\.markdown\} renderMermaid=\{false\} repairMalformedTables/u,
  );
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

test("mission composer keeps model loading separate from restore state", () => {
  assert.match(worktreeModelSource, /const composerModelLoading = Boolean\(draftModelLoading\)/);
  assert.match(worktreeModelSource, /const composerSessionRestoring =/);
  assert.match(worktreeSource, /draftModelLoading=\{composerModelLoading\}/);
  assert.match(worktreeSource, /sessionRestoring=\{composerSessionRestoring\}/);
  assert.match(worktreeSource, /modelSettingsLocked=\{Boolean\(composerSession && !composerSessionRestoreGate\.canChat\)\}/);
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
  assert.match(appRootSource, /const composerSlashSession = missionView\.selectedComposerSession \?\? missionView\.activeSession;/);
  assert.match(appRootSource, /composerSlashSession\?\.availableCommands/);
  assert.match(appRootSource, /\[composerSlashSession\.id\]: activeSessionSlashCommands/);
});

test("ACP runtime overview refreshes after restore and does not stay connected during reconnect", () => {
  assert.match(sessionEventsSource, /"agent\/connections"/);
  assert.match(worktreeSource, /useRuntimeOverviewActions\(\{/);
  assert.match(runtimeOverviewActionsSource, /pendingAcpReconnects/);
  assert.match(runtimeOverviewActionsSource, /setPendingAcpReconnects/);
  assert.match(runtimeOverviewActionsSource, /dispatch\?\.\(client, runtime\.canReconnect \? "agent\/reconnect" : "agent\/connect"/);
  assert.match(
    runtimeOverviewSource,
    /status: reconnectPending \|\| activeSessionRestoreMissing\s*\? "未连接"\s*:\s*formatAcpConnectionStatus/,
  );
  assert.match(runtimeOverviewSource, /canReconnect: !reconnectPending/);
  assert.match(runtimeOverviewSource, /canConnect: reconnectPending/);
  assert.match(runtimeOverviewSource, /agentOrder/);
  assert.match(runtimeOverviewSource, /return mergeRuntimeOverviewItemsByAgent\(items\)\.sort/);
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
  assert.match(inspectorSource, /mission-pane-inspector[^\n]+flex h-full min-h-0 min-w-0 w-full flex-col/);
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
  assert.match(chatPaneSource, /!shouldAnchorActiveParallelCard \|\| !activeSessionId/);
  assert.match(chatPaneSource, /gridAutoRows: parallelGridFillsContainer \? "minmax\(0, 1fr\)" : "minmax\(360px, min\(52vh, 560px\)\)"/);
  assert.match(chatPaneSource, /parallelGridFillsContainer \? "h-full min-h-0 overflow-hidden" : "min-h-full"/);
  assert.match(chatPaneSource, /ResizeObserverCtor/);
  assert.match(chatPaneSource, /\}, \[chatMainRef, openSessions\.length, shouldLockChatMainScroll\]\);/);
  assert.match(chatPaneSource, /mission-session-grid grid box-border/);
  assert.match(chatPaneSource, /gridTemplateColumns: "repeat\(auto-fit, minmax\(min\(100%, 360px\), 1fr\)\)"/);
  assert.match(chatPaneSource, /"h-full min-h-0 cursor-default rounded-\[8px\] border bg-surface transition-all"/);
  assert.match(chatPaneSource, /active \? "border-primary" : "border-border-ghost"/);
  assert.doesNotMatch(chatPaneSource, /boxShadow: active\s*\?\s*"inset 0 0 0 1px var\(--primary\)/);
  assert.match(chatPaneSource, /sessionMessagesById\[session\.id\]/);
  assert.match(chatPaneSource, /sessionToolCallsById\[session\.id\]/);
  assert.match(chatPaneSource, /sessionMessages=\{/);
  assert.match(chatPaneSource, /sessionToolCalls=\{/);
  assert.match(chatPaneSource, /memo\(function MissionChatSessionCard/);
  assert.match(chatPaneSource, /data-session-card-body=\{session\.id\}/);
  assert.match(chatPaneSource, /scrollSessionBodiesToBottom\(changedSessionIds, nextSnapshot, previousSnapshot\);/);
  assert.match(chatPaneSource, /if \(messageCount > 0 \|\| timelineCount > 0 \|\| toolCallCount > 0\)/);
  assert.match(chatPaneSource, /scrollSessionBodiesToBottom/);
  assert.match(chatPaneSource, /if \(isPaneResizing\) \{\s*return;\s*\}/);
  assert.match(chatPaneSource, /sessionBodyScrollPositionRef/);
  assert.match(chatPaneSource, /bodyScrollSnapshot\.scrollTop/);
  assert.doesNotMatch(chatPaneSource, /scrollBottom/);
  assert.match(chatPaneSource, /ResizeObserverCtor/);
  assert.match(chatPaneSource, /MutationObserverCtor/);
  assert.match(chatPaneSource, /characterData: true/);
  assert.match(chatPaneSource, /childList: true/);
  assert.match(chatPaneSource, /subtree: true/);
  assert.match(chatPaneSource, /changedSessionIds\.forEach\(followSessionBody\)/);
  assert.match(chatPaneSource, /messageHistoryStateRef\.current = messageHistoryState/);
  assert.match(chatPaneSource, /const observedSessionIdsKey = openSessions\.map\(\(session\) => session\.id\)\.join/);
  assert.match(chatPaneSource, /const historyLoading = Boolean\(messageHistoryStateRef\.current\[sessionId\]\?\.loading\)/);
  assert.match(chatPaneSource, /paneResizeVersion/);
  assert.match(chatPaneSource, /\}, \[chatMainRef, isPaneResizing, observedSessionIdsKey, paneResizeVersion\]\);/);
  assert.match(chatPaneSource, /const handleBodyScroll = useCallback/);
  assert.match(chatPaneSource, /onBodyScroll=\{handleBodyScroll\}/);
  assert.match(chatPaneSource, /useLayoutEffect\(\(\) => \{/);
  // 消息到达时同步(paint 前)滚到底,避免"先顶后底"跳动与顶部 prime 误触加载历史
  assert.match(chatPaneSource, /useLayoutEffect\(\(\) => \{\s*const chatMain = chatMainRef\.current;\s*if \(!chatMain\)/);
  assert.match(chatPaneSource, /selectedSessionId: string \| null/);
  assert.match(chatPaneSource, /active=\{session\.id === selectedSessionId\}/);
  assert.match(chatPaneSource, /data-active-session-card=\{active \? "true" : undefined\}/);
  assert.match(chatPaneSource, /const activeCardRect = activeCard\.getBoundingClientRect\(\)/);
  assert.match(chatPaneSource, /const cardFullyVisible =/);
  assert.match(chatPaneSource, /if \(cardFullyVisible\) \{/);
  assert.match(chatPaneSource, /chatMain\.scrollTop \+= activeCardRect\.top - chatMainRect\.top/);
  assert.match(chatPaneSource, /requestAnimationFrame\(anchorActiveCard\)/);
  assert.match(chatPaneSource, /setTimeout\(anchorActiveCard, 160\)/);
  assert.match(chatPaneSource, /setTimeout\(anchorActiveCard, 800\)/);
  assert.match(chatPaneSource, /AgentIcon name=\{session\.agentName\}/);
  assert.match(chatPaneSource, /MissionToolLoadingTitle/);
  assert.match(chatPaneSource, /<MissionToolLoadingTitle \{\.\.\.toolLoading\} \/>/);
  assert.match(chatPaneSource, /const toolLoading = resolveChatSessionToolLoading/);
  assert.match(chatPaneSource, /pendingToolPresent=\{session\.id === activeSessionId \? pendingToolPresent : false\}/);
  assert.match(chatPaneSource, /<StatusDot tone=\{statusTone\} \/>/);
  // 普通状态走与工具执行中同款的状态框（pill），而非裸文字
  assert.match(chatPaneSource, /<SessionStatusPill status=\{session\.status\} \/>/);
  assert.match(chatPaneSource, /mission-session-status-pill/);
  assert.match(chatPaneSource, /data-session-status-label/);
  assert.match(chatPaneSource, /onRename=\{handleRenameSession\}/);
  assert.match(chatPaneSource, /onClear=\{handleClearSession\}/);
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
  assert.match(chatPaneSource, /aria-label="新建任务"[\s\S]*?<SquarePen size=\{12\} strokeWidth=\{1\.75\} \/>/);
  assert.match(chatPaneComponentSource, /aria-label="新建会话"/);
  assert.match(chatPaneComponentSource, /选择项目创建会话/);
  assert.match(chatPaneComponentSource, /projectOptions\.map\(\(project\) =>/);
  assert.match(chatPaneComponentSource, /onCreateTask\(project\.id\)/);
  assert.match(chatPaneComponentSource, /展示栏/);
  assert.match(chatPaneComponentSource, /Inspector 面板/);
  assert.match(chatPaneComponentSource, />\s*Thinking\s*<\/MenuItem>/);
  assert.match(chatPaneSource, /showCreateTaskAction=\{isMissionMobile\}/);
  assert.match(chatPaneSource, /title="当前项目下新建会话"/);
  assert.doesNotMatch(chatPaneComponentSource, />\s*重命名\s*<\/MenuItem>/);
  assert.doesNotMatch(chatPaneComponentSource, />\s*生成摘要\s*<\/MenuItem>/);
  assert.doesNotMatch(chatPaneComponentSource, />\s*导出对话\s*<\/MenuItem>/);
  assert.doesNotMatch(chatPaneComponentSource, />\s*清理会话\s*<\/MenuItem>/);
  assert.doesNotMatch(chatPaneSource, /DropdownMenuContent/);
});

test("mission sidebar keeps search while mobile create-session entry lives in chat pane", () => {
  assert.match(sidebarSource, /aria-label="搜索任务"/);
  assert.doesNotMatch(sidebarSource, /aria-label="新建任务"/);
  assert.doesNotMatch(sidebarSource, /onCreateTask: \(projectId: string\) => void;/);
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
  assert.match(chatWindowActionsSource, /current\.includes\(sessionId\) \? current : addChatSessionIdToFront\(current, sessionId\)/);
  assert.match(chatWindowActionsSource, /addChatSessionIdToFront\(current, attachedSessionId\)/);
  assert.doesNotMatch(chatWindowActionsSource, /const selectChatSession = \(sessionId: string\) => \{[\s\S]*?setActiveSessionId\(sessionId\)/);
  assert.match(worktreeSource, /useOpenSessionStreams\(\{/);
  assert.match(openSessionStreamsSource, /const hydrateOpenSessionStreams = \(sessionIds: string\[\]\) =>/);
  assert.match(openSessionStreamsSource, /openSessionTopicSubscriptionsRef/);
  assert.match(openSessionStreamsSource, /subscribeToSessionTopic\(client, sessionId, dispatch\)/);
  assert.match(openSessionStreamsSource, /unsubscribeFromSessionTopic\(client, sessionId, dispatch\)/);
  assert.match(openSessionStreamsSource, /dispatch\(client, "session\/list_timeline"/);
  assert.doesNotMatch(openSessionStreamsSource, /session\/get_artifacts/u);
  assert.match(openSessionStreamsSource, /openSessionResumeCheckRef/);
  assert.match(openSessionStreamsSource, /resumeCheckSessionIds/);
  assert.match(openSessionStreamsSource, /openSessionResumeCheckRef\.current\.add\(sessionId\)/);
  assert.match(openSessionStreamsSource, /dispatch\(client, "session\/check_resume", \{ sessionId \}\)/);
  assert.match(sessionStreamsSource, /session\.status !== "running"/);
  assert.match(sessionStreamsSource, /session\.resume\?\.state !== "resume-unavailable"/);
  assert.match(worktreeSource, /sessions: sessions as SessionSummary\[\]/);
  assert.match(openSessionStreamsSource, /setMessageHistoryState\(\(current: any\) =>/);
  assert.doesNotMatch(openSessionStreamsSource, /setActivityHistoryState\(\(current: any\) =>/u);
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
  assert.match(composerSource, /wb-pane-sunken px-2 py-1\.5 w-full max-w-\[min\(1120px,calc\(100%_-_32px\)\)\] mx-auto grid gap-0\.5/);
  assert.match(composerSource, /const composerShellClassName = isMobile/);
  assert.match(composerSource, /const composerDeckClassName = isMobile/);
  assert.match(composerSource, /const composerContextClassName = isMobile/);
  assert.match(composerSource, /const composerPromptClassName = isMobile/);
  assert.match(composerSource, /const composerSidecarClassName = isMobile/);
  assert.match(composerSource, /const composerStatusClassName = isMobile/);
  assert.match(composerSource, /const composerActionsClassName = isMobile/);
  assert.match(composerSource, /const composerToolsClassName = isMobile/);
  assert.match(composerSource, /const promptRows = isMobile \? 1 : 2/);
  assert.match(composerSource, /rows=\{promptRows\}/);
  assert.match(composerSource, /enterKeyHint=\{isMobile \? "enter" : undefined\}/);
  assert.match(composerSource, /const skipNextMobileLineBreakInputRef = useRef\(false\)/);
  assert.match(composerSource, /onBeforeInput=\{handleComposerPromptBeforeInput\}/);
  assert.match(composerSource, /inputType === "insertLineBreak" \|\| inputType === "insertParagraph"/);
  assert.match(composerSource, /const explicitMobileSubmitRef = useRef\(false\)/);
  assert.match(composerSource, /if \(isMobile && !explicitMobileSubmitRef\.current\) \{\s*event\.preventDefault\(\);\s*return;\s*\}/);
  assert.match(composerSource, /explicitMobileSubmitRef\.current = true/);
  assert.match(composerSource, /const composerSession = contextSession \?\? activeSession/);
  assert.match(composerSource, /composerSession\?\.agentName/);
  assert.match(composerSource, /composerSession\?\.title/);
  assert.match(composerSource, /onSubmit=\{\(event\) => \{/);
  assert.match(composerSource, /submitPrompt\(event, composerSession\);/);
  assert.match(composerSource, /aria-label="选择 Worktree"/);
  assert.match(composerSource, /draftWorktreeOptions\.map\(\(worktree\) =>/);
  assert.match(composerSource, /selectDraftWorktree\(worktree\.path\)/);
  assert.match(sessionCommandActionsSource, /function submitPrompt\(event: FormEvent<HTMLFormElement>, targetSession\?: SessionSummary \| null\)/);
  assert.match(sessionCommandActionsSource, /if \(isMobile\) \{\s*return;\s*\}/);
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
  assert.match(sessionRowSource, /grid-cols-\[minmax\(0,1fr\)_24px\]/);
  assert.match(sessionRowSource, /grid-cols-\[14px_minmax\(0,1fr\)_14px_auto\]/);
  assert.match(sidebarSource, /border-success\/50 bg-success\/20 text-success/);
});

test("mission sidebar rows stay compact and session actions open below rows", () => {
  assert.match(sidebarSource, /sidebar-section mission-tree-switcher flex-1 overflow-auto p-1/);
  assert.match(sidebarSource, /mission-tree grid gap-1/);
  assert.match(sidebarProjectNodeSource, /px-1\.5 h-5/);
  assert.match(sidebarProjectNodeSource, /ml-3 grid gap-1 border-l border-border-ghost\/70 pl-2/);
  assert.doesNotMatch(sidebarProjectNodeSource, /mission-tree-children-sessions ml-1/);
  assert.doesNotMatch(sidebarProjectNodeSource, /ml-4 grid gap-1 border-l border-border-ghost pl-2/);
  assert.match(sessionRowSource, /px-1\.5 h-5/);
  assert.match(sessionRowSource, /DropdownMenuContent/);
  assert.doesNotMatch(sessionRowSource, /mission-tree-session-menu absolute/);
});

test("mission session rows stay tree-like instead of selected card pills", () => {
  assert.match(sessionRowSource, /grid-cols-\[minmax\(0,1fr\)_24px\]/);
  assert.match(sessionRowSource, /grid-cols-\[14px_minmax\(0,1fr\)_14px_auto\]/);
  assert.match(sessionRowSource, /highlightedSessionId: string \| null/);
  assert.match(sessionRowSource, /const isOpenSession = openSessionIds\.has\(session\.id\)/);
  assert.match(sessionRowSource, /const isHighlighted = isFocused \|\| isOpenSession/);
  assert.doesNotMatch(sessionRowSource, /cursor-grab|active:cursor-grabbing|draggable/);
  assert.match(sessionRowSource, /cursor-default/);
  assert.match(sessionRowSource, /bg-primary-soft[^\n]+before:absolute before:left-0 before:top-0\.5 before:bottom-0\.5 before:w-1 before:rounded-full before:bg-primary-strong/);
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
  assert.match(sidebarProjectNodeSource, /mission-tree-children-sessions ml-3/);
  assert.doesNotMatch(sidebarProjectNodeSource, /mission-tree-children-sessions ml-5/);
  assert.match(composerSource, /composerProjectLabel/);
  assert.match(composerSource, /composerAgentLabel/);
  assert.match(composerSource, /composerSession\?\.projectName/);
  assert.match(composerSource, /composerSession\?\.agentName/);
});

test("mission diff and inspector commit controls support full-row review", () => {
  assert.match(diffTreeSource, /parseDiffPatchLines|visibleLines = patch\.split/);
  assert.match(diffTreeSource, /parseDiffPatchLines|isDiffHeaderLine/);
  assert.match(diffPanelSource, /selectedCommitDiffPaths/);
  assert.match(diffPanelSource, /onToggleCommitDiffDirectory/);
  assert.match(diffPanelSource, /collectDiffFilePaths/);
  assert.match(diffPanelSource, /\[scrollbar-width:none\]/);
  assert.match(inspectorSource, /\[scrollbar-width:none\]/);
  assert.match(inspectorSource, /msOverflowStyle: \"none\"/);
  assert.match(shellStylesSource, /\.mission-inspector-diff\s*\{[^}]*scrollbar-width:\s*none;/s);
  assert.match(inspectorSource, /生成提交描述/);
  assert.match(inspectorSource, /selectedDiffCount/);
  assert.match(inspectorSource, /取消全选/);
  assert.match(inspectorSource, /全选/);
  assert.match(inspectorSource, /mission-inspector-commit-editor wb-pane-sunken grid min-w-0 w-full/);
  assert.match(inspectorSource, /mission-inspector-commit-submit flex h-\[var\(--control-h-sm\)\]/);
  assert.doesNotMatch(shellStylesSource, /\.mission-responsive-mode \[data-mission-mobile-pane\] \.mission-inspector-commit-editor \.mission-inspector-commit-submit/);
  assert.match(inspectorSource, /border-0 bg-transparent px-1 py-0/);
  assert.doesNotMatch(inspectorSource, /pr-\[7\.5rem\]/);
  assert.doesNotMatch(inspectorSource, /grid grid-cols-\[minmax\(0,1fr\)_auto\] items-end gap-2 md:block/);
  assert.match(inspectorSource, /mission-worktree-picker relative flex min-w-0 items-center gap-1/);
  assert.match(inspectorSource, /aria-label=\{generating \? "正在生成提交描述" : "生成提交描述"\}/);
  assert.match(inspectorSource, /aria-label="刷新 Git"/);
  assert.doesNotMatch(inspectorSource, /grid grid-cols-4 gap-1/);
  assert.match(inspectorSource, /min-h-\[48px\]/);
  assert.match(inspectorSource, /h-\[var\(--control-h-sm\)\] min-w-\[88px\]/);
  assert.match(inspectorSource, /<GitCommitHorizontal size=\{11\}/);
  assert.match(worktreeSource, /const toggleSelectAllCommitDiffs = \(\) =>/);
  assert.match(worktreeSource, /onToggleSelectAllDiffs=\{toggleSelectAllCommitDiffs\}/);
});

test("mission tool call rows stay compact", () => {
  assert.match(plainMessagesSource, /plain-assistant-segment-dot size-1\.5 rounded-full ring-2/);
  assert.match(plainMessagesSource, /plain-thinking[^\n]+rounded-\[8px\][^\n]+bg-surface-sunken\/55/);
  assert.match(plainMessagesSource, /plain-tool-group[^\n]+rounded-\[8px\][^\n]+bg-surface-sunken\/55/);
  assert.match(plainMessagesSource, /plain-tool-call min-w-0 text-muted-foreground/);
  assert.match(plainMessagesSource, /<summary className=\"flex min-w-0 cursor-pointer list-none items-center gap-1\.5/);
  assert.match(plainMessagesSource, /const TOOL_CATEGORY_SLOT_CLASS_NAME = \"min-w-\[3\.25rem\]\"/);
  assert.match(plainMessagesSource, /cn\(\"inline-flex shrink-0 items-center\", TOOL_CATEGORY_SLOT_CLASS_NAME\)/);
  assert.doesNotMatch(plainMessagesSource, /maxGroupLabelLength/);
  assert.match(plainMessagesSource, /<pre className=\"mt-0\.5 min-w-0 w-full max-w-full max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-snug text-muted-foreground\/85\"/);
  assert.doesNotMatch(plainMessagesSource, /grid-cols-subgrid|col-span-/);
  assert.match(plainMessagesSource, /resolveToolCallIconName/);
  assert.match(plainMessagesSource, /plain-tool-group-content[^\n]+max-h-\[min\(22rem,55vh\)\]/);
  assert.match(plainMessagesSource, /plain-tool-group-content[^\n]+\[&::-webkit-scrollbar-button\]:hidden/);
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
  assert.match(inspectorSource, /刷新 Git/);
  assert.match(inspectorSource, />\s*查看历史\s*<\/DropdownMenuItem>/);
});

test("mission graph panel shows a loading state while fetching commits", () => {
  assert.match(displayPanelSource, /gitGraph=\{gitGraph\}/);
  assert.match(readFileSync(resolve(currentDir, "../display/git-graph-panel.tsx"), "utf8"), /if \(gitGraph\?\.loading\)/);
  assert.match(readFileSync(resolve(currentDir, "../display/git-graph-panel.tsx"), "utf8"), /正在加载提交历史/);
});

test("mission display page navigation is placed above the content", () => {
  assert.match(displayPanelSource, /mission-display-tab-strip/);
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

test("mobile display diff content keeps the desktop edge-to-edge viewer", () => {
  assert.match(
    shellStylesSource,
    /\.mission-responsive-mode \.mission-pane-display \.mission-panel-content\s*\{[\s\S]*padding:\s*0;/,
  );
});

test("mission inspector mirrors the v6 worktree chrome", () => {
  assert.match(inspectorSource, /wb-pane-head/);
  assert.match(inspectorSource, /工作区/);
  assert.match(inspectorSource, /aria-label="收起检视器"/);
  assert.match(inspectorSource, /onClick=\{onCollapse\}/);
  assert.match(inspectorSource, /mission-worktree-picker/);
  assert.match(inspectorSource, /mission-inspector-commit/);
  assert.match(inspectorSource, /cloneElement/);
  assert.match(inspectorSource, /useEffect/);
  assert.match(inspectorSource, /useRef<HTMLDivElement \| null>/);
  assert.match(inspectorSource, /onClose: \(\) => setPickerOpen\(false\)/);
  assert.match(inspectorSource, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(inspectorSource, /!pickerRef\.current\?\.contains\(target\)/);
  assert.match(inspectorSource, /rows=\{2\}/);
  assert.match(inspectorSource, /min-h-\[48px\]/);
  assert.match(inspectorSource, /mission-inspector-commit grid gap-0\.5/);
  assert.doesNotMatch(inspectorSource, /DropdownMenuItem onSelect=\{onCollapse\}/);
  assert.doesNotMatch(inspectorSource, /aria-label="调试会话更新"/);
  assert.match(inspectorSource, /min-w-0 w-full flex-col/);
  assert.doesNotMatch(inspectorSource, /border-l border-border-ghost/);
  assert.doesNotMatch(inspectorSource, /TabsList/);
  assert.doesNotMatch(inspectorSource, /TabsTrigger/);
  assert.doesNotMatch(inspectorSource, /<MissionPanelHeader/);
});

test("mission inspector worktree list is driven by the current project worktrees", () => {
  assert.match(worktreeSource, /selectedSessionWorktreeItems=\{\[\]\}/);
  assert.match(worktreeSource, /worktreeOptions=\{worktreeOptions\}/);
  assert.doesNotMatch(worktreeSource, /selectedSessionWorktreeItems=\{selectedSessionWorktreeItems\}/);
  assert.match(worktreeModelSource, /const worktreeScopeProject = activeSessionProject \?\? draftProject;/);
  assert.match(worktreeModelSource, /const filteredWorktrees =/);
  assert.match(worktreeSource, /filteredWorktrees\.length/);
  assert.doesNotMatch(worktreeSource, /rawWorktreeOptions\.filter\(isManagedWorktreeWorktree\)/);
  assert.match(worktreeListSource, /onClick=\{\(\) => \{\s*onSelectCwd\(worktree\.path\);\s*onClose\?\.\(\);\s*\}\}/s);
  assert.doesNotMatch(worktreeSource, /"project\/git\/create_worktree"/);
  assert.doesNotMatch(worktreeSource, /onCreateWorktree/);
  assert.doesNotMatch(worktreeListSource, /filterAvailableWorktreeBranches|打开分支/);
  assert.doesNotMatch(missionSelectionEffectsSource, /project\/git\/list_branches/);
  assert.match(inspectorSource, /absolute left-0 right-0 bottom-\[calc\(100%\+4px\)\]/);
  assert.doesNotMatch(inspectorSource, /absolute left-0 right-0 top-\[calc\(100%\+4px\)\]/);
  assert.doesNotMatch(worktreeListSource, /连接/);
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
  assert.match(missionLayoutHookSource, /const \[missionInspectorCollapsed, setMissionInspectorCollapsed\] =\s*useState\(true\);/);
  assert.match(missionLayoutHookSource, /MISSION_RESIZER_WIDTH = 4/);
  assert.match(missionLayoutHookSource, /MISSION_MIN_CHAT_WIDTH = 360/);
  assert.match(missionLayoutHookSource, /MISSION_AUTO_COLLAPSE_SIDEBAR_WIDTH = 1081/);
  assert.match(missionLayoutHookSource, /MISSION_AUTO_COLLAPSE_DISPLAY_WIDTH = 1081/);
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
  assert.match(missionLayoutHookSource, /const \[isMissionPaneResizing, setIsMissionPaneResizing\] = useState\(false\);/);
  assert.match(missionLayoutHookSource, /const \[missionPaneResizeVersion, setMissionPaneResizeVersion\] = useState\(0\);/);
  assert.match(missionLayoutHookSource, /hasActiveConversation \? "chat" : "project"/);
  assert.match(appRootSource, /hasActiveConversation: Boolean\(missionView\.activeSession \|\| deckData\.draftChatWindow\)/);
  assert.match(missionLayoutHookSource, /window\.innerWidth/);
  assert.match(missionLayoutHookSource, /matchMedia\("\(max-width: 1080px\)"\)/);
  assert.match(missionLayoutHookSource, /Math\.min\(layoutWidth, documentWidth\)/);
  assert.match(missionLayoutHookSource, /const missionLayoutMeasureFrameRef = useRef<number \| null>\(null\);/);
  assert.match(missionLayoutHookSource, /if \(missionLayoutMeasureFrameRef\.current !== null\) \{\s*return;\s*\}/);
  assert.match(missionLayoutHookSource, /missionLayoutMeasureFrameRef\.current = window\.requestAnimationFrame\(\(\) => \{/);
  assert.match(
    missionLayoutHookSource,
    /setMissionViewportWidth\(\(currentWidth\) =>[\s\S]*currentWidth === nextWidth \? currentWidth : nextWidth[\s\S]*\);/,
  );
  assert.match(missionLayoutHookSource, /window\.cancelAnimationFrame\(missionLayoutMeasureFrameRef\.current\);/);
  assert.match(missionLayoutHookSource, /setIsMissionPaneResizing\(true\);/);
  assert.match(missionLayoutHookSource, /setIsMissionPaneResizing\(false\);/);
  assert.match(missionLayoutHookSource, /setMissionPaneResizeVersion\(\(currentVersion\) => currentVersion \+ 1\);/);
  assert.match(missionLayoutHookSource, /isMissionPaneResizing,/);
  assert.match(missionLayoutHookSource, /missionPaneResizeVersion,/);
  assert.doesNotMatch(missionLayoutHookSource, /MISSION_OUTER_GUTTER/);
});

test("mission pane drag state is threaded into the chat pane resize guards", () => {
  assert.match(missionRouteSource, /isMissionPaneResizing=\{isMissionPaneResizing\}/);
  assert.match(missionRouteSource, /missionPaneResizeVersion=\{missionPaneResizeVersion\}/);
  assert.match(worktreeSource, /isPaneResizing=\{isMissionPaneResizing\}/);
  assert.match(worktreeSource, /paneResizeVersion=\{missionPaneResizeVersion\}/);
  assert.match(chatPaneComponentSource, /isPaneResizing\?: boolean;/);
  assert.match(chatPaneComponentSource, /paneResizeVersion\?: number;/);
  assert.match(chatPaneComponentSource, /isPaneResizing = false,/);
  assert.match(chatPaneComponentSource, /paneResizeVersion = 0,/);
  assert.match(chatPaneComponentSource, /if \(isPaneResizing\) \{\s*return;\s*\}/);
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
  assert.match(mobilePagerSource, /工作区/);
  assert.match(mobilePagerSource, /展示/);
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

test("mission mobile session selection routes back to chat and keeps desktop thinking in the top menu", () => {
  assert.match(chatWindowActionsSource, /isMissionMobile/);
  assert.match(chatWindowActionsSource, /if \(isMissionMobile\) \{\s*setSelectedMissionMobilePane\("chat"\);\s*\}/s);
  assert.match(chatPaneComponentSource, /isMissionMobile: boolean;/);
  assert.match(chatPaneComponentSource, /!isMissionMobile \? \(\s*<div className=\"wb-pane-head\"/s);
  assert.match(chatPaneComponentSource, /showThinkingToggle=\{isMissionMobile\}/);
  assert.match(chatPaneComponentSource, /onToggleThinking=\{onToggleThinking\}/);
  assert.match(workspaceChatCompositionSource, /return isMobile \? "输入消息" : draftPromptPlaceholder/);
});

test("mission ACP overview keeps the foldout without the extra bubble wrapper", () => {
  assert.doesNotMatch(
    sidebarSource,
    /<details open className=\"group rounded border border-border-ghost bg-surface-sunken\/60 px-2 py-1\">/,
  );
  assert.match(sidebarSource, /<details open className=\"group[^\"]*\">/);
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
  assert.match(worktreeSource, /resolvedMissionMobilePane = selectedMissionMobilePane \?\? \(\(activeSession \|\| draftChatWindow\) \? "chat" : "project"\)/);
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
  assert.match(diffPanelSource, /data-mission-swipe-lock="true"/);
});

test("session scroll-to-bottom button stays absolute inside responsive panes", () => {
  assert.match(chatPaneSource, /data-session-scroll-bottom-position=\{position\}/);
  assert.match(chatPaneSource, /position === "dock-top" \? "-top-8 right-1" : "bottom-3 right-3"/);
  assert.match(chatPaneSource, /pointer-events-auto absolute z-30/);
  assert.match(chatPaneSource, /position="bottom"/);
  assert.match(chatPaneSource, /position="dock-top"/);
});

test("mission composer is sticky and swipe-locked on mobile", () => {
  assert.match(composerSource, /mission-composer/);
  assert.match(composerSource, /data-mission-swipe-lock="true"/);
  assert.match(composerSource, /rows=\{promptRows\}/);
  assert.match(composerSource, /py-1 bg-surface/);
  assert.match(composerSource, /px-1\.5 py-1 w-full max-w-\[min\(1120px,calc\(100%_-_32px\)\)\] mx-auto grid gap-0/);
  assert.match(composerSource, /min-h-8 w-full resize-none rounded-none border-0 bg-transparent px-0\.5 py-0/);
  assert.match(composerSource, /mission-composer-sidecar grid min-h-6/);
  assert.match(composerSource, /mission-send-prompt-button h-\[var\(--control-h-sm\)\] px-2\.5 text-action font-medium/);
  assert.match(composerSource, /mission-image-upload-input/);
  assert.match(composerSource, /accept="image\/\*"/);
  assert.match(composerSource, /onAddPromptImages\(event\.currentTarget\.files\)/);
  assert.doesNotMatch(composerSource, /imagePasteNotice=\{imagePasteNotice\}/);
  assert.doesNotMatch(composerAttachmentsSource, /mission-composer-notice/);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-pane-chat\s*{[^}]*overflow:\s*hidden;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-composer/);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-composer\s*{[^}]*padding:\s*4px 8px max\(4px, env\(safe-area-inset-bottom\)\);/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-composer-deck\s*{[^}]*gap:\s*2px;/s);
  assert.match(shellStylesSource, /bottom:\s*0;/);
  assert.match(shellStylesSource, /#mission-prompt-input\s*{[^}]*caret-color:\s*var\(--primary\);/s);
  assert.match(shellStylesSource, /#mission-prompt-input\s*{[^}]*scroll-padding-block:\s*4px;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode #mission-prompt-input\s*{[^}]*field-sizing:\s*content;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode #mission-prompt-input\s*{[^}]*min-height:\s*1\.25rem;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode #mission-prompt-input\s*{[^}]*padding:\s*3px 2px;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode #mission-prompt-input\s*{[^}]*caret-color:\s*var\(--primary\);/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-composer-deck\s*{[^}]*padding:\s*0;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-composer-deck\s*{[^}]*box-shadow:\s*none;/s);
  assert.match(shellStylesSource, /\.mission-responsive-mode \.mission-composer-deck\s*{[^}]*background:\s*transparent;/s);
  assert.match(composerSource, /mission-composer-deck[^\n]+wb-pane-sunken/);
  assert.doesNotMatch(composerSource, /mission-order-editor[^\n]+bg-surface-sunken/);
  assert.doesNotMatch(shellStylesSource, /\.mission-responsive-mode \.mission-permission-drawer/);
  assert.match(shellStylesSource, /\.mission-mobile-mode \.mission-sidebar-toggle\s*{[^}]*display:\s*none;/s);
});

test("mission prompt autosize respects the textarea CSS max height", () => {
  assert.match(promptAutosizeSource, /const textareaStyles = window\.getComputedStyle\(textarea\)/);
  assert.match(promptAutosizeSource, /Number\.parseFloat\(textareaStyles\.maxHeight/);
  assert.match(promptAutosizeSource, /maxHeight = Math\.min\(maxHeight, cssMaxHeight\)/);
  assert.match(promptAutosizeSource, /textarea\.scrollHeight > maxHeight \? "auto" : "hidden"/);
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

test("mission worktree keeps the display pane independently toggleable", () => {
  assert.match(worktreeSource, /const displayPaneCollapsed = effectiveDisplayCollapsed;/);
  assert.match(worktreeSource, /displayCollapsed=\{displayPaneCollapsed\}/);
  assert.match(worktreeSource, /canToggleDisplay=\{canToggleDisplay\}/);
  assert.match(chatPaneComponentSource, /disabled=\{!canToggleDisplay\}/);
  assert.match(worktreeSource, /!isMissionMobile && !displayPaneCollapsed/);
});

test("mission inspector git scope follows the explicitly selected worktree", () => {
  assert.match(
    worktreeSource,
    /const activeGitCwd = selectedCwd \?\? activeSession\?\.cwd;/,
  );
  assert.match(
    worktreeSource,
    /const activeGitProjectId = activeSessionProjectId \?\? selectedProjectId;/,
  );
  assert.match(worktreeSource, /const selectedWorktreeSummaryItem = selectedCwd/);
  assert.match(worktreeSource, /gitStatusByWorktree\?\.\[selectedWorktreeSummaryItem\.path\]\?\.branch/);
  assert.match(worktreeSource, /selectedWorktreeSummaryItem\.branch/);
  // Git scope derivation lives solely in the workspace controller now; the
  // selection-effects module no longer keeps its own (dead) copies.
  assert.doesNotMatch(missionSelectionEffectsSource, /effectiveGitProjectId|effectiveGitCwd/);
});

test("mission comment context plan keeps the full prompt-context wiring chain", () => {
  assert.match(promptSubmissionSource, /buildMissionPromptPayload|buildMissionPromptText/);
  assert.match(promptSubmissionSource, /mode === "slash"|mode: "slash"/);
  assert.match(promptSubmissionSource, /clearDraftContexts/);
  assert.match(promptSubmissionSource, /setCommandRetentionNotice/);
  assert.match(sessionActionsSource, /draftContexts/);
  assert.match(displaySectionSource, /onAddDraftContext/);
  assert.match(plainMessagesSource, /onAddDraftContext/);
  assert.match(composerAttachmentsSource, /待发送评论上下文/);
  assert.match(composerSource, /reviewContext/);
});

test("mission inspector header keeps primary actions visible on one line", () => {
  assert.match(
    inspectorSource,
    /className="wb-pane-head mission-inspector-section-head flex-nowrap/,
  );
  assert.match(
    inspectorSource,
    /className="wb-pane-head-eyebrow shrink-0 whitespace-nowrap"/,
  );
  assert.match(
    inspectorSource,
    /className="shrink-0 whitespace-nowrap text-2xs text-muted-foreground"/,
  );
  assert.match(
    inspectorSource,
    /className="shrink-0 whitespace-nowrap rounded-none bg-transparent px-1\.5 py-0\.5 text-2xs text-muted-foreground/,
  );
  assert.match(
    inspectorSource,
    /className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground/,
  );
});

test("mission commit refreshes git graph after success and no longer auto-dispatches status", () => {
  // Commit orchestration lives in git-operations runners.
  assert.match(gitOperationsSource, /context\.dispatch\("project\/git\/commit"/);
  assert.match(gitOperationsSource, /onCommitSuccess: \(\) => setSelectedCommitDiffPaths\(new Set\(\)\)/);
  // Status dispatch after commit was removed (explicit refresh only).
  // Failed commits return before clearing selection; graph refresh follows success only.
  assert.match(gitOperationsSource, /if \(!result\?\.ok\) \{[\s\S]*return result;/);
  assert.match(gitOperationsSource, /if \(hasGraph\) \{[\s\S]*context\.dispatch\("project\/git\/graph"/);
  // Automatic status hydration on project/cwd change was removed.
  assert.match(missionSelectionEffectsSource, /REMOVED: automatic git status hydration/);
});

test("mission inspector keeps Git actions inside a compact upward menu", () => {
  assert.match(inspectorSource, /<DropdownMenuContent[\s\S]*align="end"[\s\S]*side="top"[\s\S]*sideOffset=\{6\}/);
  assert.match(inspectorSource, /rounded-lg border border-border-ghost\/80 bg-surface-elevated/);
  assert.match(inspectorSource, /shadow-\[0_14px_36px_rgb\(0_0_0\/0\.34\)\] ring-1 ring-white\/5/);
  assert.match(inspectorSource, /rounded-md px-2 py-1 text-xs/);
  assert.match(
    inspectorSource,
    />\s*查看历史\s*<\/DropdownMenuItem>[\s\S]*>\s*查看错误\s*<\/DropdownMenuItem>[\s\S]*<DropdownMenuSeparator \/>[\s\S]*Fetch[\s\S]*Pull[\s\S]*Push[\s\S]*<DropdownMenuSeparator \/>[\s\S]*>\s*丢弃选中改动\s*<\/DropdownMenuItem>/,
  );
  assert.match(inspectorSource, /onSelect=\{\(\) => void handleFetch\(\)\}/);
  assert.match(inspectorSource, />\s*查看错误\s*<\/DropdownMenuItem>/);
  assert.match(inspectorSource, /const pullDisabled = !onPull \|\| gitOperationBusy;/);
  assert.match(inspectorSource, /const pushDisabled = !onPush \|\| gitOperationBusy;/);
  assert.doesNotMatch(inspectorSource, /!status\.clean|!status\.upstreamBranch|!status\.pushTarget/);
  assert.doesNotMatch(inspectorSource, /DropdownMenuItem disabled>Push/);
  assert.doesNotMatch(inspectorSource, /DropdownMenuItem disabled>Pull/);
  assert.doesNotMatch(inspectorSource, /gitSummaryParts|gitSummary|Git 未刷新|无 Git 状态|aria-live="polite"/);
  assert.match(worktreeSource, /onFetch=\{handleFetch\}/);
  assert.match(worktreeSource, /onOpenGitError=\{handleOpenGitError\}/);
});

test("mission inspector commit editor follows the compact composer layout", () => {
  assert.match(inspectorSource, /mission-inspector-commit[^\n]+gap-0\.5[^\n]+px-2 py-1/);
  assert.match(inspectorSource, /wb-focus-ring flex h-5/);
  assert.match(inspectorSource, /title="选择 Worktree"/);
  assert.equal((inspectorSource.match(/grid h-5 w-5 shrink-0 place-items-center rounded-none/g) ?? []).length, 3);
  assert.match(inspectorSource, /mission-inspector-commit-editor[^\n]+wb-pane-sunken[^\n]+px-2 py-1\.5/);
  assert.match(inspectorSource, /rows=\{2\}/);
  assert.match(inspectorSource, /min-h-\[48px\][^\n]+border-0 bg-transparent px-1 py-0/);
  assert.match(inspectorSource, /mission-inspector-commit-sidecar[^\n]+min-h-7[^\n]+justify-end/);
  assert.doesNotMatch(inspectorSource, /min-h-\[96px\]|pb-10/);
});

test("mission diff patches load on demand instead of riding the status payload", () => {
  // 打开的 diff 文件缺 patch 时按需批量拉取,并以 lastUpdated 指纹防重复请求
  assert.match(gitOperationsSource, /"project\/git\/file_diff"/);
  assert.match(worktreeSource, /handleFetchFileDiffs\(\[selectedMissionDiffFilePath\]\)/);
  assert.match(worktreeSource, /requestedDiffPathsRef\.current\.get\(selectedMissionDiffFilePath\) === fingerprint/);
  // 生成提交描述前补齐缺失 patch,直接消费返回值
  assert.match(worktreeSource, /handleFetchFileDiffs\(missingPaths\)/);
  // 结果事件把 patch 合并回 status 条目
  assert.match(
    inventoryEventsSource,
    /case "project\/git\/file_diff":[\s\S]*applyGitFileDiffResult\(current, payload, payload\.cwd\)/,
  );
});

test("mission Git actions notify success and refresh tracking after remote changes", () => {
  assert.match(gitOperationsSource, /import \{ toast \} from "\.\.\/\.\.\/toast";/);
  assert.match(gitOperationsSource, /notify\.success\("提交成功"\)/);
  assert.match(gitOperationsSource, /notify\.success\("已丢弃选中改动"\)/);
  // Fetch success only fires when the remote refresh actually succeeded.
  assert.match(
    gitOperationsSource,
    /runGitRefresh\(context, \{ refreshRemote: true \}\)[\s\S]*resolveFetchOutcome\(result\)[\s\S]*notify\.success\("Fetch 成功"\)/,
  );
  // Push/Pull share one runner: dispatch → refresh → success/warning notification.
  assert.match(
    gitOperationsSource,
    /if \(result\?\.ok\) \{[\s\S]*runGitRefresh\(context, \{ refreshRemote: false \}\)[\s\S]*notify\.success\(`\$\{op\.verb\} 成功`\)/,
  );
  assert.match(gitOperationsSource, /method: "project\/git\/push"/);
  assert.match(gitOperationsSource, /method: "project\/git\/pull"/);
});

test("mission inspector only exposes confirmed selected Git discard", () => {
  assert.match(inspectorSource, /GitDiscardConfirmDialog/);
  assert.match(inspectorSource, />\s*丢弃选中改动\s*<\/DropdownMenuItem>/);
  assert.doesNotMatch(inspectorSource, /丢弃全部改动/);
  assert.match(gitOperationsSource, /context\.dispatch\("project\/git\/discard"/);
  assert.match(worktreeSource, /onDiscard=\{handleDiscard\}/);
});

test("mission graph auto-load does not loop after a completed fetch", () => {
  assert.match(
    gitSyncSource,
    /return !currentGraph\?\.loading &&\s*!currentGraph\?\.lastUpdated &&\s*\(currentGraph\?\.commits\?\.length \?\? 0\) === 0;/,
  );
});

test("mission inspector avoids an extra right gutter when the viewport shrinks", () => {
  assert.doesNotMatch(inspectorSource, /border-l border-border-ghost/);
  assert.match(shellStylesSource, /grid-template-columns:[\s\S]*var\(--mission-inspector-resizer-width, 4px\)[\s\S]*var\(--mission-inspector-width, 280px\);/);
});
