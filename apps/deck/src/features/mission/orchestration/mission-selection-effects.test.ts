import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sourceText = readFileSync(
  new URL("./mission-selection-effects.ts", import.meta.url),
  "utf8",
);
const composerSourceText = readFileSync(
  new URL("../ui/composer-config-controls.tsx", import.meta.url),
  "utf8",
);
const composerShellSourceText = readFileSync(
  new URL("../ui/composer.tsx", import.meta.url),
  "utf8",
);
const worktreeSourceText = readFileSync(
  new URL("../workspace/workspace.tsx", import.meta.url),
  "utf8",
);
const worktreeModelSourceText = readFileSync(
  new URL("../workspace/workspace-model.ts", import.meta.url),
  "utf8",
);
const selectionSourceText = readFileSync(
  new URL("../hooks/selection.ts", import.meta.url),
  "utf8",
);
const sidebarSourceText = readFileSync(
  new URL("../ui/sidebar-project-node.tsx", import.meta.url),
  "utf8",
);
const viewModelSourceText = readFileSync(
  new URL("./mission-view-model.ts", import.meta.url),
  "utf8",
);
const rootSourceText = readFileSync(
  new URL("../../../app/shell/root.tsx", import.meta.url),
  "utf8",
);

test("mission draft composer waits for ACP connection before creating a session", () => {
  assert.match(worktreeSourceText, /const selectedDraftConnection = !activeSession && effectiveSelectedAgentId && effectiveSelectedCwd/);
  assert.match(worktreeSourceText, /const helmConnected = pairingState === "paired"/);
  assert.match(worktreeSourceText, /const shouldShowComposer = Boolean\(helmConnected && \(activeSession \|\| draftChatWindow\)\)/);
  assert.match(worktreeSourceText, /const shouldShowDraftPreparing = Boolean\(\s*helmConnected && !activeSession && selectedAgentId && !selectedDraftConnection/s);
  assert.match(selectionSourceText, /setSelectedAgentId\(null\)/);
  assert.doesNotMatch(selectionSourceText, /const selectedCwd = selectedWorktree/);
});

test("mission draft agent selection resets model before creating an ACP session", () => {
  assert.match(selectionSourceText, /setSelectedModel: Dispatch<SetStateAction<string>>/);
  assert.match(selectionSourceText, /setSelectedModel\("provider-default"\)/);
  assert.match(sidebarSourceText, /selectDraftAgent\(agent\.id\)/);
  assert.doesNotMatch(sidebarSourceText, /createDraftSessionForAgent\(agent\.id\)/);
  assert.match(sourceText, /dispatch\(rpcClientRef\.current, "agent\/connect"/);
  assert.match(sourceText, /dispatch\(rpcClientRef\.current, "session\/draft"/);
});

test("mission project plus owns the ACP picker and selected agent connects before showing composer", () => {
  assert.match(sidebarSourceText, /mission-tree-agent-menu/);
  assert.match(sidebarSourceText, />\s*＋\s*<\/Button>/);
  assert.match(composerShellSourceText, /aria-label="打开任务设置"/);
  assert.match(composerShellSourceText, />\s*⋯\s*<\/Button>/);
  assert.match(sidebarSourceText, /selectDraftAgent\(agent\.id\)/);
  assert.doesNotMatch(sidebarSourceText, /createDraftSessionForAgent\(agent\.id\)/);
  assert.match(sidebarSourceText, /setAgentPickerOpen\(false\)/);
  assert.match(worktreeSourceText, /const shouldShowDraftPreparing = Boolean/);
  assert.match(worktreeSourceText, /正在连接 ACP/);
});

test("mission mobile jumps to chat after selecting an ACP agent from project new task", () => {
  assert.match(sidebarSourceText, /setSelectedMissionMobilePane: Dispatch<SetStateAction<MissionMobilePane>>/);
  assert.match(sidebarSourceText, /setSelectedMissionMobilePane\("chat"\)/);
  assert.match(worktreeSourceText, /setSelectedMissionMobilePane=\{setSelectedMissionMobilePane\}/);
});

test("mission ACP overview uses connection inventory instead of inferring status from sessions", () => {
  assert.match(worktreeSourceText, /agentConnectionInventory as any\[\]/);
  assert.match(worktreeSourceText, /formatAcpConnectionStatus\(connection\.status\)/);
  assert.match(worktreeSourceText, /canReconnect: true/);
  assert.match(worktreeSourceText, /canConnect: Boolean/);
  assert.match(worktreeSourceText, /canReconnect: false/);
  assert.doesNotMatch(worktreeSourceText, /status: "未连接",\s*runtimeSessionId: "暂无会话"/);
});

test("mission ACP overview can connect inactive agents while a session is active", () => {
  assert.match(worktreeSourceText, /const overviewConnectCwd = selectedCwd \?\? activeSession\?\.cwd/);
  assert.match(worktreeSourceText, /cwd: overviewConnectCwd \?\? undefined/);
  assert.match(worktreeSourceText, /canConnect: Boolean\(agent\.id && overviewConnectCwd\)/);
});

test("mission starting sessions disable send without showing cancel", () => {
  assert.match(worktreeSourceText, /sessionCanCancel=\{sessionExecutionPending && activeSessionStatus !== "starting"\}/);
  assert.match(composerShellSourceText, /activeSession && sessionCanCancel/);
  assert.match(composerShellSourceText, /disabled=\{!canSend\}/);
  assert.match(worktreeModelSourceText, /activeSessionStatus !== "starting" &&/);
});

test("mission selection effects does not auto-select the first project", () => {
  assert.doesNotMatch(sourceText, /setSelectedProjectId\(nextProject\.id\)/);
  assert.doesNotMatch(sourceText, /!selectedProjectId && missionProjects\.length/);
});

test("mission worktree panel only lists project-scoped worktrees", () => {
  assert.doesNotMatch(worktreeSourceText, /const projectWorktreeOptions = \(worktrees \?\? \[\]\)\.filter/);
  assert.match(worktreeSourceText, /const hasWorktreeScope = Boolean\(activeSession \|\| selectedProjectId\)/);
  assert.match(
    worktreeSourceText,
    /const worktreeOptions = rawWorktreeOptions\.filter\(isManagedWorktreeWorktree\)/,
  );
  assert.match(viewModelSourceText, /if \(!draftProject\) \{\s*return \[\];\s*\}/);
});

test("mission selection effects can auto-open the preferred running session", () => {
  assert.match(sourceText, /resolveDefaultMissionSessionId/);
  assert.match(sourceText, /setActiveSessionId\(nextActiveSessionId\)/);
});

test("mission selection effects reads setAgentModelOptions from source context", () => {
  const destructuredSource = sourceText.match(
    /const\s*\{([\s\S]*?)\}\s*=\s*source;/,
  )?.[1];

  assert.ok(destructuredSource, "source destructuring block should exist");
  assert.match(destructuredSource, /\bsetAgentModelOptions\b/);
});

test("mission selection effects creates a draft session without a separate model probe", () => {
  assert.match(sourceText, /agent\/connect/);
  assert.match(sourceText, /session\/draft/);
  assert.doesNotMatch(sourceText, /agent\/get_model_options/);
  assert.match(sourceText, /正在创建 ACP 草稿会话并加载模型/);
});

test("mission selection effects refreshes cached model options when no draft is ready", () => {
  assert.match(sourceText, /if \(cached\.draftId\) \{\s*return;\s*\}/);
  assert.match(sourceText, /const shouldProbeModelOptions =\s*!cached\?\.draftId \|\|/);
});

test("mission selection effects preserves available model options while probing", () => {
  assert.match(
    sourceText,
    /modelOptions:\s*cached\?\.modelOptions\s*\?\?\s*\[\]/,
  );
  assert.match(
    sourceText,
    /configOptions:\s*cached\?\.configOptions\s*\?\?\s*\[\]/,
  );
  assert.match(
    sourceText,
    /state:\s*cached\?\.state\s*\?\?\s*\{\}/,
  );
});

test("mission config changes dispatch through embedded Helm clients", () => {
  assert.match(rootSourceText, /runtimeState\.helmRpcClientRefs\.current\.get\(helmId\)/);
  assert.match(rootSourceText, /runtimeState\.selectedMissionHelmId/);
  assert.match(rootSourceText, /runtimeState\.primaryHelmKeyRef\.current/);
  assert.match(rootSourceText, /function readConfigSelectionState/);
  assert.match(rootSourceText, /function toConfigPatchState/);
  assert.match(rootSourceText, /directConfigPatch \? \{ \.\.\.directConfigPatch, \.\.\.activeConfigState \}/);
  assert.match(rootSourceText, /directConfigPatch \? \{ \.\.\.directConfigPatch, \.\.\.draftConfigPatchState \}/);
  assert.doesNotMatch(rootSourceText, /function omitReasoningOnModelChange/);
  assert.doesNotMatch(rootSourceText, /function omitReasoningConfigOptionsOnModelChange/);
  assert.doesNotMatch(rootSourceText, /modelChangedWithoutReasoning/);
  assert.match(rootSourceText, /resolveConfigClient\(activeSession\.helmId\)/);
  assert.match(rootSourceText, /const draftClient = resolveConfigClient\(null\)/);
});

test("mission model picker surfaces loading state without hiding cached options", () => {
  assert.match(composerSourceText, /modelLoading:\s*boolean/);
  assert.match(composerSourceText, /mission-config-loading-badge/);
  assert.doesNotMatch(composerSourceText, /正在加载模型列表/);
  assert.match(sourceText, /正在连接 ACP/);
  assert.match(composerShellSourceText, /modelLoading=\{/);
  assert.match(composerShellSourceText, /selectedDraftAgent\?\.protocol === "acp"/);
  assert.match(composerShellSourceText, /draftConfigOptions\.length === 0/);
  assert.match(viewModelSourceText, /draftLoadingAgentModelOptions/);
  assert.match(viewModelSourceText, /key\.startsWith\(`\$\{draftAgentModelOptionsPrefix\}::`\)/);
  assert.match(viewModelSourceText, /draftHasLoadedModelOptions/);
  assert.match(viewModelSourceText, /draftLoadingAgentModelOptions\?\.loading/);
  assert.match(viewModelSourceText, /awaitingDraftAgentModelOptions/);
  assert.match(viewModelSourceText, /!draftHasLoadedModelOptions/);
});

test("mission model picker only shows ACP-provided mode options", () => {
  assert.match(viewModelSourceText, /const visibleDraftAgentModeOptions = draftAgentModeOptions/);
  assert.doesNotMatch(viewModelSourceText, /formatAgentModeLabel\(effectiveDraftAgentMode\)/);
  assert.match(viewModelSourceText, /draftAgentModeOptions: visibleDraftAgentModeOptions/);
});
