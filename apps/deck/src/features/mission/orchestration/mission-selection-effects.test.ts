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

test("mission draft composer stays empty until an ACP session exists", () => {
  assert.match(workspaceSourceText, /const shouldShowComposer = Boolean\(activeSession\)/);
  assert.doesNotMatch(workspaceSourceText, /selectedAgentId && !draftAgentPreparing/);
  assert.match(workspaceSourceText, /\{shouldShowComposer \? \(/);
  assert.match(selectionSourceText, /setSelectedAgentId\(null\)/);
});

test("mission draft agent selection resets model before creating an ACP session", () => {
  assert.match(selectionSourceText, /setSelectedModel: Dispatch<SetStateAction<string>>/);
  assert.match(selectionSourceText, /setSelectedModel\("provider-default"\)/);
  assert.match(sidebarSourceText, /createDraftSessionForAgent\(agent\.id\)/);
  assert.doesNotMatch(sourceText, /dispatch\(rpcClientRef\.current, "session\/prewarm"/);
});

test("mission project plus owns the ACP picker and selected agent creates a real session", () => {
  assert.match(sidebarSourceText, /mission-tree-agent-menu/);
  assert.match(sidebarSourceText, /selectDraftAgent\(agent\.id\)/);
  assert.match(sidebarSourceText, /createDraftSessionForAgent\(agent\.id\)/);
  assert.match(workspaceSourceText, /const shouldShowDraftPreparing = Boolean/);
  assert.match(workspaceSourceText, /正在创建 ACP 会话/);
});

test("mission selection effects reads setAgentModelOptions from source context", () => {
  const destructuredSource = sourceText.match(
    /const\s*\{([\s\S]*?)\}\s*=\s*source;/,
  )?.[1];

  assert.ok(destructuredSource, "source destructuring block should exist");
  assert.match(destructuredSource, /\bsetAgentModelOptions\b/);
});

test("mission selection effects leaves ACP startup to session/new", () => {
  assert.doesNotMatch(sourceText, /session\/prewarm/);
  assert.match(sourceText, /agent\/get_model_options/);
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
  assert.match(composerSourceText, /正在加载模型列表/);
  assert.match(composerShellSourceText, /modelLoading=\{/);
  assert.match(composerShellSourceText, /selectedDraftAgent\?\.id === "opencode"/);
  assert.match(composerShellSourceText, /draftConfigOptions\.length === 0/);
  assert.match(viewModelSourceText, /draftLoadingAgentModelOptions/);
  assert.match(viewModelSourceText, /key\.startsWith\(`\$\{draftAgentModelOptionsPrefix\}::`\)/);
  assert.match(viewModelSourceText, /draftHasLoadedModelOptions/);
  assert.match(viewModelSourceText, /awaitingDraftAgentModelOptions/);
  assert.match(viewModelSourceText, /!draftHasLoadedModelOptions/);
});
