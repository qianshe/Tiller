import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionComposer } from "./composer.js";

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    activeSession: null,
    worktreePickerRef: { current: null },
    worktreePickerOpen: false,
    setWorktreePickerOpen: () => undefined,
    agentPickerRef: { current: null },
    agentPickerOpen: false,
    setAgentPickerOpen: () => undefined,
    selectedWorktreeName: "main",
    draftWorktreeOptions: [],
    selectedCwd: "D:/repo",
    selectDraftWorktree: () => undefined,
    currentGitBranch: "main",
    copy: { cancelSession: "取消任务" },
    agentLocked: false,
    selectedDraftAgent: { id: "codex", name: "Codex", protocol: "acp" },
    filteredAgents: [{ id: "codex", name: "Codex", protocol: "acp" }],
    selectedAgentId: "codex",
    selectDraftAgent: () => undefined,
    submitPrompt: () => undefined,
    slashWrapperRef: { current: null },
    promptImages: [],
    removePromptImage: () => undefined,
    imagePasteNotice: "",
    missionPromptRef: { current: null },
    prompt: "继续",
    setPrompt: () => undefined,
    handleMissionPromptKeyDown: () => undefined,
    handleMissionPromptPaste: () => undefined,
    onAddPromptImages: () => undefined,
    draftPromptPlaceholder: "输入指令",
    slashPopupOpen: false,
    filteredSlashCommands: [],
    slashSelectedIndex: 0,
    applySlashCommand: () => undefined,
    setSlashSelectedIndex: () => undefined,
    openSlashCommands: () => undefined,
    showDraftAgentModeSelect: false,
    missionConfigPicker: null,
    setMissionConfigPicker: () => undefined,
    draftAgentModePickerLabel: "默认",
    draftAgentModeOptions: [],
    effectiveDraftAgentMode: undefined,
    updateSessionDraftPreferences: () => undefined,
    draftModelPlaceholder: "模型",
    draftModelPickerDisabled: false,
    draftModelPickerLabel: "模型",
    draftModelLoading: false,
    draftModelBaseOptions: [],
    resolveReasoningOptionsForModel: () => [],
    draftAllModelOptions: [],
    draftConfigOptions: [{ id: "ready", label: "ready", type: "text" }],
    effectiveDraftReasoningEffort: "medium",
    effectiveDraftModelBase: "provider-default",
    resolveCombinedModelValue: (model: string) => model,
    showDraftReasoningSelect: false,
    resolveReasoningLabel: (value: string) => value,
    draftReasoningOptions: [],
    deckPreferences: { promptEnhancer: { enabled: true } },
    enhancePromptDraft: () => undefined,
    promptEnhancerBusy: false,
    sessionCanCancel: false,
    cancelSession: () => undefined,
    canSend: true,
    ...overrides,
  } as any;
}

test("composer enables send for a typed new-session prompt", () => {
  const html = renderToStaticMarkup(createElement(MissionComposer, baseProps()));

  assert.match(html, /aria-label="发送"/);
  assert.doesNotMatch(html, /aria-label="发送"[^>]*disabled=""/);
});

test("composer uses a tighter frame and padded square textarea", () => {
  const html = renderToStaticMarkup(createElement(MissionComposer, baseProps()));

  assert.match(html, /rounded-md border border-border-ghost\/70 bg-surface px-3 py-2\.5/);
  assert.match(html, /rounded-none border-0 bg-transparent px-1 py-0/);
});

test("composer uses compact sidecar and action button sizing", () => {
  const html = renderToStaticMarkup(createElement(MissionComposer, baseProps()));

  assert.match(html, /mission-composer-sidecar[^\"]*min-h-7[^\"]*gap-1\.5/);
  assert.match(html, /mission-tools-trigger[^\"]*size-7/);
  assert.match(html, /mission-slash-trigger[^\"]*size-7[^\"]*text-sm/);
  assert.match(html, /mission-image-upload-trigger[^\"]*size-7[^\"]*text-sm/);
  assert.match(html, /mission-enhance-prompt-button[^\"]*size-7/);
  assert.match(html, /mission-send-prompt-button[^\"]*size-7/);
});

test("composer shows only the interrupt action while a session can be cancelled", () => {
  const html = renderToStaticMarkup(
    createElement(MissionComposer, baseProps({
      activeSession: { id: "session-1" },
      sessionCanCancel: true,
      canSend: false,
    })),
  );

  assert.match(html, /aria-label="取消任务"/);
  assert.match(html, /mission-cancel-session-button/);
  assert.doesNotMatch(html, /aria-label="增强提示词"/);
  assert.doesNotMatch(html, /aria-label="发送"/);
});
