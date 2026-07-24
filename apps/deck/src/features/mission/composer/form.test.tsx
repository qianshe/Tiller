import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { insertTextAtSelection, MissionComposer } from "./form.js";

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
    sessionRestoring: false,
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
  assert.match(html, /mission-composer-deck[^\"]*max-w-\[min\(1120px,calc\(100%_-_32px\)\)\][^\"]*gap-0\.5/);
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
    draftPromptPlaceholder: "输入消息",
  })));

  assert.match(html, /Project A/);
  assert.match(html, /placeholder="输入消息"/);
  assert.match(html, /rows="1"/);
  assert.match(html, /enterKeyHint="enter"/);
  assert.doesNotMatch(html, /Codex/);
  assert.doesNotMatch(html, /→ 移动端会话/);
});

test("composer applies tighter mobile-only spacing and textarea sizing", () => {
  const html = renderToStaticMarkup(createElement(MissionComposer, baseProps({
    isMobile: true,
    activeSession: { id: "mobile-session", title: "移动端会话", projectName: "Project A", agentName: "Codex" },
    draftPromptPlaceholder: "输入消息",
  })));

  assert.match(html, /chat-input-area[^\"]*py-1/);
  assert.match(html, /mission-composer-deck[^\"]*px-1\.5 py-1[^\"]*gap-0/);
  assert.match(html, /min-h-8[^\"]*px-0\.5 py-0/);
  assert.match(html, /mission-composer-sidecar[^\"]*min-h-6[^\"]*gap-1/);
  assert.match(html, /mission-send-prompt-button[^\"]*h-\[var\(--control-h-sm\)\][^\"]*px-2\.5/);
});

test("insertTextAtSelection inserts a newline at the caret", () => {
  assert.deepEqual(
    insertTextAtSelection("继续", 2, 2, "\n"),
    {
      nextValue: "继续\n",
      nextCaret: 3,
    },
  );
});

test("insertTextAtSelection replaces the selected range", () => {
  assert.deepEqual(
    insertTextAtSelection("abc", 1, 3, "\n"),
    {
      nextValue: "a\n",
      nextCaret: 2,
    },
  );
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

test("composer labels active session restoration separately from model loading", () => {
  const html = renderToStaticMarkup(createElement(MissionComposer, baseProps({
    activeSession: { id: "session-1", model: "claude-haiku-4-5" },
    draftModelLoading: false,
    draftModelConfigReady: true,
    modelSettingsLocked: true,
    sessionRestoring: true,
  })));

  assert.match(html, /aria-label="打开任务设置"[^>]*disabled=""/);
  assert.match(html, /会话恢复中/);
  assert.doesNotMatch(html, /模型加载中/);
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

test("composer renders context usage indicator at row tail", () => {
  const html = renderToStaticMarkup(createElement(MissionComposer, baseProps({
    activeSession: { id: "active", title: "活动会话", projectName: "Project A", agentName: "Codex" },
  })));

  // composerSession = activeSession (无 contextSession);无 store usage 注入 → 空态 dash
  assert.match(html, /–/u);
  // 圆环在 → 标题 之后:标题在前,dash 在后
  assert.ok(
    html.lastIndexOf("→ 活动会话") < html.indexOf("–"),
    "context usage indicator should render after the session title hint",
  );
});

test("composer renders review context chips beside image chips and shows the retention notice", () => {
  const html = renderToStaticMarkup(createElement(MissionComposer, baseProps({
    reviewContext: {
      draftContexts: [{
        id: "ctx-1",
        kind: "diff",
        label: "panel.tsx:44-46",
        comment: "这里需要 review",
        excerpt: "+ new line",
        source: { kind: "diff", filePath: "panel.tsx", startLine: 44, endLine: 46 },
      }],
      commandRetentionNotice: "已仅发送命令，评论上下文仍保留。",
      removeDraftContext: () => undefined,
    },
    promptImages: [{ type: "image", mimeType: "image/png", data: "AAA", name: "screen.png" }],
  })));

  assert.match(html, /待发送图片/);
  assert.match(html, /待发送评论上下文/);
  assert.match(html, /panel\.tsx:44-46/);
  assert.match(html, /已仅发送命令/);
  assert.match(html, /mission-composer-notice/);
});
