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
const workspaceSourceText = readFileSync(
  new URL("../ui/workspace.tsx", import.meta.url),
  "utf8",
);
const workspaceModelSourceText = readFileSync(
  new URL("../ui/workspace-model.ts", import.meta.url),
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

test("mission draft composer waits for ACP connection before creating a session", () => {
  assert.match(workspaceSourceText, /const selectedDraftConnection = !activeSession && selectedAgentId && selectedWorkspaceId/);
  assert.match(workspaceSourceText, /const shouldShowComposer = Boolean\(activeSession \|\| selectedDraftConnection\)/);
  assert.match(workspaceSourceText, /const shouldShowDraftPreparing = Boolean\(!activeSession && selectedAgentId && !selectedDraftConnection\)/);
  assert.match(selectionSourceText, /setSelectedAgentId\(null\)/);
});

test("mission draft agent selection resets model before creating an ACP session", () => {
  assert.match(selectionSourceText, /setSelectedModel: Dispatch<SetStateAction<string>>/);
  assert.match(selectionSourceText, /setSelectedModel\("provider-default"\)/);
  assert.match(sidebarSourceText, /createDraftSessionForAgent\(agent\.id\)/);
  assert.match(sourceText, /dispatch\(rpcClientRef\.current, "agent\/connect"/);
  assert.doesNotMatch(sourceText, /dispatch\(rpcClientRef\.current, "session\/prewarm"/);
});

test("mission project plus owns the ACP picker and selected agent connects before showing composer", () => {
  assert.match(sidebarSourceText, /mission-tree-agent-menu/);
  assert.match(sidebarSourceText, />\s*＋\s*<\/Button>/);
  assert.match(composerShellSourceText, /aria-label="打开任务设置"/);
  assert.match(composerShellSourceText, />\s*⋯\s*<\/Button>/);
  assert.doesNotMatch(sidebarSourceText, /selectDraftAgent\(agent\.id\)/);
  assert.match(sidebarSourceText, /createDraftSessionForAgent\(agent\.id\)/);
  assert.match(sidebarSourceText, /setAgentPickerOpen\(false\)/);
  assert.match(workspaceSourceText, /const shouldShowDraftPreparing = Boolean/);
  assert.match(workspaceSourceText, /正在连接 ACP/);
});

test("mission ACP overview uses connection inventory instead of inferring status from sessions", () => {
  assert.match(workspaceSourceText, /agentConnectionInventory as any\[\]/);
  assert.match(workspaceSourceText, /formatAcpConnectionStatus\(connection\.status\)/);
  assert.match(workspaceSourceText, /canReconnect: true/);
  assert.match(workspaceSourceText, /canConnect: Boolean/);
  assert.match(workspaceSourceText, /canReconnect: false/);
  assert.doesNotMatch(workspaceSourceText, /status: "未连接",\s*runtimeSessionId: "暂无会话"/);
});

test("mission starting sessions disable send without showing cancel", () => {
  assert.match(workspaceSourceText, /sessionCanCancel=\{sessionExecutionPending && activeSessionStatus !== "starting"\}/);
  assert.match(composerShellSourceText, /activeSession && sessionCanCancel/);
  assert.match(composerShellSourceText, /disabled=\{!canSend\}/);
  assert.match(workspaceModelSourceText, /activeSessionStatus !== "starting" &&/);
});

test("mission selection effects does not auto-select the first project", () => {
  assert.doesNotMatch(sourceText, /setSelectedProjectId\(nextProject\.id\)/);
  assert.doesNotMatch(sourceText, /!selectedProjectId && missionProjects\.length/);
});

test("mission worktree panel only lists project-scoped worktrees", () => {
  assert.doesNotMatch(workspaceSourceText, /const projectWorktreeOptions = \(workspaces \?\? \[\]\)\.filter/);
  assert.match(workspaceSourceText, /const hasWorktreeScope = Boolean\(activeSession \|\| selectedProjectId\)/);
  assert.match(
    workspaceSourceText,
    /const worktreeOptions = workspaceOptions\.filter\(isManagedWorktreeWorkspace\)/,
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

test("mission selection effects connects the selected ACP runtime", () => {
  assert.match(sourceText, /agent\/connect/);
  assert.doesNotMatch(sourceText, /session\/prewarm/);
  assert.doesNotMatch(sourceText, /agent\/get_model_options/);
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

test("mission model picker surfaces loading state without hiding cached options", () => {
  assert.match(composerSourceText, /modelLoading:\s*boolean/);
  assert.match(composerSourceText, /mission-config-loading-badge/);
  assert.doesNotMatch(composerSourceText, /正在加载模型列表/);
  assert.match(sourceText, /正在连接 ACP/);
  assert.match(composerShellSourceText, /modelLoading=\{/);
  assert.match(composerShellSourceText, /selectedDraftAgent\?\.id === "opencode"/);
  assert.match(composerShellSourceText, /draftConfigOptions\.length === 0/);
  assert.match(viewModelSourceText, /draftLoadingAgentModelOptions/);
  assert.match(viewModelSourceText, /key\.startsWith\(`\$\{draftAgentModelOptionsPrefix\}::`\)/);
  assert.match(viewModelSourceText, /draftHasLoadedModelOptions/);
  assert.match(viewModelSourceText, /awaitingDraftAgentModelOptions/);
  assert.match(viewModelSourceText, /!draftHasLoadedModelOptions/);
});

test("mission model picker shows current agent mode even before full mode options arrive", () => {
  assert.match(viewModelSourceText, /visibleDraftAgentModeOptions/);
  assert.match(viewModelSourceText, /formatAgentModeLabel\(effectiveDraftAgentMode\)/);
  assert.match(viewModelSourceText, /draftAgentModeOptions: visibleDraftAgentModeOptions/);
});
