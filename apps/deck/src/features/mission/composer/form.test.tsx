import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionComposer } from "./form.js";

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    activeSession: null,
    contextSession: null,
    worktreePickerRef: { current: null },
    worktreePickerOpen: false,
    setWorktreePickerOpen: () => undefined,
    agentPickerRef: { current: null },
    agentPickerOpen: false,
    setAgentPickerOpen: () => undefined,
    selectedProjectId: "tiller",
    selectedProjectName: "Tiller",
    draftProjectOptions: [],
    selectDraftProject: () => undefined,
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
    draftModelConfigReady: true,
    modelSettingsLocked: false,
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

  assert.match(html, /chat-input-area[^\"]*border-t[^\"]*px-2 py-1\.5/);
  assert.match(html, /mission-composer[^\"]*px-2 py-1\.5/);
  assert.match(html, /mission-composer-deck[^\"]*max-w-\[min\(1120px,calc\(100%_-_32px\)\)\]/);
  assert.match(html, /min-h-\[48px\][^\"]*rounded-none border-0 bg-transparent px-1 py-0/);
});

test("composer follows the focused session context labels", () => {
  const html = renderToStaticMarkup(createElement(MissionComposer, baseProps({
    activeSession: { id: "active", title: "活动会话", projectName: "Project A", agentName: "Codex" },
    contextSession: { id: "focused", title: "聚焦会话", projectName: "Project B", agentName: "ClaudeCode" },
  })));

  assert.match(html, /Project B/);
  assert.match(html, /ClaudeCode/);
  assert.match(html, /→ 聚焦会话/);
  assert.doesNotMatch(html, /Project A/);
  assert.doesNotMatch(html, /→ 活动会话/);
});

test("composer hides the session title hint in mobile mode", () => {
  const html = renderToStaticMarkup(createElement(MissionComposer, baseProps({
    isMobile: true,
    activeSession: { id: "mobile-session", title: "移动端会话", projectName: "Project A", agentName: "Codex" },
  })));

  assert.match(html, /Project A/);
  assert.doesNotMatch(html, /Codex/);
  assert.doesNotMatch(html, /→ 移动端会话/);
});

test("composer shows project in folder chip and switches worktree from branch chip", () => {
  const html = renderToStaticMarkup(createElement(MissionComposer, baseProps({
    activeSession: null,
    contextSession: null,
    selectedProjectId: "tiller",
    selectedProjectName: "Tiller",
    draftProjectOptions: [
      { id: "tiller", name: "Tiller", path: "D:/myProject/tools/Tiller" },
      { id: "sandbox", name: "Sandbox", path: "D:/myProject/tools/tiller-test-sandbox" },
    ],
    selectedWorktreeName: "feature/0.1.6",
    currentGitBranch: "feature/0.1.6",
    worktreePickerOpen: true,
    draftWorktreeOptions: [
      { name: "feature/0.1.6", path: "D:/myProject/tools/Tiller" },
      { name: "feature/menu", path: "D:/myProject/tools/Tiller/.worktrees/menu" },
    ],
  })));

  assert.match(html, /title="选择项目"/);
  assert.match(html, /aria-label="选择项目"/);
  assert.match(html, /title="选择 Worktree"/);
  assert.match(html, /aria-label="选择 Worktree"/);
  assert.match(html, /feature\/menu/);
  assert.ok(
    html.indexOf('title="选择项目"') < html.indexOf('title="选择 Worktree"'),
    "project chip should render before the branch worktree picker",
  );
});

test("composer uses compact sidecar and action button sizing", () => {
  const html = renderToStaticMarkup(createElement(MissionComposer, baseProps()));

  // Workbench Void §5.2 — composer action buttons run at icon-sm (22px),
  // which Tailwind emits as h-[var(--control-h-sm)]; see DESIGN.md v2.
  // cn() puts cva variant classes BEFORE the trailing className prop, so
  // assert each token independently rather than chaining via [^"]*.
  assert.match(html, /mission-composer-sidecar[^\"]*min-h-7[^\"]*gap-1\.5/);
  for (const label of [
    "mission-tools-trigger",
    "mission-slash-trigger",
    "mission-image-upload-trigger",
    "mission-enhance-prompt-button",
    "mission-send-prompt-button",
  ]) {
    assert.match(html, new RegExp(label), `${label} not rendered`);
  }
  assert.match(html, /h-\[var\(--control-h-sm\)\] w-\[var\(--control-h-sm\)\]/);
  // No leftover hand-coded size-7 (28px) or !important text overrides.
  assert.doesNotMatch(html, /size-7/);
  assert.doesNotMatch(html, /!text-sm/);
});

test("composer keeps model settings locked until active session config is ready", () => {
  const html = renderToStaticMarkup(createElement(MissionComposer, baseProps({
    activeSession: { id: "session-1" },
    draftModelLoading: false,
    draftModelConfigReady: false,
    draftConfigOptions: [{ id: "cached", label: "cached", type: "text" }],
  })));

  assert.match(html, /aria-label="打开任务设置"[^>]*disabled=""/);
  assert.match(html, /模型加载中/);
});

test("composer locks model settings while new-session config is loading", () => {
  const html = renderToStaticMarkup(createElement(MissionComposer, baseProps({
    activeSession: null,
    draftModelLoading: true,
    draftModelConfigReady: false,
    draftConfigOptions: [{ id: "cached", label: "cached", type: "text" }],
  })));

  assert.match(html, /aria-label="打开任务设置"[^>]*disabled=""/);
  assert.match(html, /模型加载中/);
});

test("composer shows model loading while an active session is restoring", () => {
  const html = renderToStaticMarkup(createElement(MissionComposer, baseProps({
    activeSession: { id: "session-1", model: "claude-haiku-4-5" },
    draftModelLoading: false,
    draftModelConfigReady: true,
    modelSettingsLocked: true,
  })));

  assert.match(html, /aria-label="打开任务设置"[^>]*disabled=""/);
  assert.match(html, /模型加载中/);
});

test("composer hides model loading for active sessions that already know the model", () => {
  const html = renderToStaticMarkup(createElement(MissionComposer, baseProps({
    activeSession: { id: "session-1", model: "claude-sonnet-4" },
    draftModelLoading: true,
    draftModelConfigReady: false,
  })));

  assert.doesNotMatch(html, /aria-label="打开任务设置"[^>]*disabled=""/);
  assert.doesNotMatch(html, /模型加载中/);
});

test("composer ignores stale draft loading when active session config is ready", () => {
  const html = renderToStaticMarkup(createElement(MissionComposer, baseProps({
    activeSession: { id: "session-1", model: "claude-sonnet-4" },
    draftModelLoading: true,
    draftModelConfigReady: true,
  })));

  assert.doesNotMatch(html, /aria-label="打开任务设置"[^>]*disabled=""/);
  assert.doesNotMatch(html, /模型加载中/);
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
  // 22px icon-sm height (Workbench Void §5.2). cva variant classes precede
  // the trailing className prop, so the height token lives separately on
  // the same button; check both fragments exist rather than chaining.
  assert.match(html, /mission-cancel-session-button/);
  assert.match(html, /h-\[var\(--control-h-sm\)\] w-\[var\(--control-h-sm\)\]/);
  assert.doesNotMatch(html, /size-12/);
  assert.doesNotMatch(html, /size-7/);
  assert.match(html, /mission-cancel-session-stop-icon[^\"]*size-1\.5/);
  assert.doesNotMatch(html, /aria-label="增强提示词"/);
  assert.doesNotMatch(html, /aria-label="发送"/);
});
