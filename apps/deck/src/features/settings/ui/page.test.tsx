import { test } from "node:test";
import assert from "node:assert/strict";
import { createRef } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DeckPreferences, TechnicalPanelPreferences } from "../../preferences";
import { SettingsPage } from "./page";

const currentDir = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(resolve(currentDir, "page.tsx"), "utf8");
const promptEnhancerSource = readFileSync(resolve(currentDir, "prompt-enhancer-card.tsx"), "utf8");
const sectionsSource = readFileSync(resolve(currentDir, "settings-sections.ts"), "utf8");
const workspaceSource = readFileSync(resolve(currentDir, "settings-workspace-shell.tsx"), "utf8");
const navigationSource = readFileSync(resolve(currentDir, "settings-navigation.tsx"), "utf8");

const technicalPanels: TechnicalPanelPreferences = {
  diffDefaultOpen: true,
  showSessionRuntimeMeta: true,
  showPermissionWorktree: true,
  showMissionThinking: true,
  showConnectionDebug: false,
};

const deckPreferences: DeckPreferences = {
  language: "zh-CN",
  theme: "system",
  density: "default",
  timeFormat: "relative",
  reduceMotion: false,
  technicalPanels,
  promptEnhancer: {
    enabled: true,
    instruction: "",
    modelProfile: "",
    responseContract: "",
    llm: {
      enabled: true,
      baseUrl: "http://localhost:8317",
      apiKey: "",
      model: "gpt-4.1-mini",
      systemPrompt: "system",
      instructionTemplate: "template",
    },
  },
};

test("SettingsPage renders preference and prompt enhancer sections", () => {
  const noop = () => undefined;
  const html = renderToString(
    <SettingsPage
      deckPreferences={deckPreferences}
      technicalPanels={technicalPanels}
      promptModelPickerRef={createRef<HTMLDivElement>()}
      promptEnhancerBusy={false}
      promptEnhancerModelPickerOpen={false}
      promptEnhancerModelFilter=""
      promptEnhancerModels={[]}
      promptEnhancerStatus=""
      resetDeckPreferences={noop}
      updateDeckPreference={noop}
      updateTechnicalPanelPreference={noop}
      updatePromptEnhancerPreference={noop}
      updatePromptEnhancerLlmPreference={noop}
      updatePromptEnhancerModelInput={noop}
      setPromptEnhancerModelPickerOpen={noop}
      refreshPromptEnhancerModels={noop}
      setPromptEnhancerModelFilter={noop}
      selectPromptEnhancerModel={noop}
      testPromptEnhancerSelectedModel={noop}
    />,
  );

  assert.match(html, /设置/);
  assert.match(html, /settings-section-nav/);
  assert.match(html, /settings-workspace-shell/);
  assert.match(html, /settings-section-frame/);
  assert.doesNotMatch(html, /settings-section-frame[^\"]*wb-pane/);
  assert.match(html, /flex flex-col gap-2 border-b border-border-ghost px-4 py-4 last:border-b-0 sm:flex-row/);
  assert.match(html, /重置全部/);
  assert.match(html, /外观/);
  assert.match(html, /面板/);
  assert.match(html, /关于/);
  assert.match(html, /语言/);
  assert.match(html, /主题/);
  assert.doesNotMatch(html, />更改</);
  assert.match(html, /技术面板/);
  assert.match(html, /Prompt 增强/);
  assert.doesNotMatch(html, /LLM 增强器/);
  assert.doesNotMatch(html, /增强器 System Prompt/);
  assert.doesNotMatch(html, /增强器指令模板/);
  assert.doesNotMatch(html, /恢复默认模板/);

  assert.match(sectionsSource, /desc: "减少动效偏好"/);
  assert.match(sectionsSource, /desc: "Git \/ Diff \/ 调试"/);
  assert.match(sectionsSource, /desc: "LLM 接入 · 模型"/);
  assert.match(sectionsSource, /desc: "数据保留策略"/);
  assert.match(sectionsSource, /desc: "版本 · 许可证"/);
  assert.match(pageSource, /<SettingsRow label=\{settingsCopy\.languageLabel\} desc="切换会即时生效">/);
  assert.match(pageSource, /<SettingsRow label="时间格式" desc="影响 mission 时间戳 \/ activity timeline">/);
  assert.match(pageSource, /<SettingsRow label="减少动效" desc="禁用 streaming pulse \/ drawer slide \/ fade transitions">/);
  assert.match(pageSource, /<SettingsRow label="Mission Thinking" desc="只控制会话小窗口中的 Thinking 展示">/);
  assert.match(pageSource, /<SettingsRow label=\{settingsCopy\.connectionDebug\} desc="WebSocket \/ RPC raw 帧">/);
  assert.match(workspaceSource, /className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left transition-colors hover:bg-surface-sunken active:bg-surface-emphasis"/);
  assert.doesNotMatch(pageSource, /wb-pane-sunken flex items-center gap-3 p-3/);
  assert.doesNotMatch(pageSource, /TechnicalSwitch/);
  assert.match(pageSource, /SettingsSwitch/);
  assert.match(workspaceSource, /title="重置所有 Deck 前端偏好"/);
  assert.doesNotMatch(pageSource, /\{settingsCopy\.reset\}/);
  assert.doesNotMatch(pageSource, />\s*更改\s*</);
  assert.match(pageSource, /mode\?: SettingsPageMode/);
  assert.match(pageSource, /mode = "standalone"/);
  assert.match(pageSource, /mode=\{mode\}/);
  assert.match(workspaceSource, /mode\?: SettingsPageMode/);
  assert.match(workspaceSource, /showHeading=\{mode !== "dashboard"\}/);
  assert.match(navigationSource, /showHeading\?: boolean/);
  assert.doesNotMatch(pageSource, /sm:grid-cols-2/);
  assert.doesNotMatch(pageSource, /h-\[46px\]/);
  assert.match(pageSource, /updatePreference=\{updatePromptEnhancerPreference\}/);
  assert.match(promptEnhancerSource, /max-w-\[720px\]/);
  assert.match(promptEnhancerSource, /Prompt 增强状态/);
  assert.match(promptEnhancerSource, /border-b border-border-ghost px-4 py-4/);
  assert.match(promptEnhancerSource, /控制会话输入框中的增强按钮是否可用/);
  assert.match(promptEnhancerSource, /PromptEnhancerChip/);
  assert.match(promptEnhancerSource, /SettingsSwitch/);
  assert.match(promptEnhancerSource, /先填写 Base URL 和模型/);
  assert.match(promptEnhancerSource, /已启用/);
  assert.match(promptEnhancerSource, /可测试/);
  assert.match(pageSource, /<SettingsRow label="数据目录" desc="所有会话 \/ 配置 \/ 设备凭据保存路径">/);
  assert.match(pageSource, /<SettingsRow label="日志级别" desc="保存后当前 Helm 进程立即生效">/);
  assert.match(pageSource, /<SettingsRow label="不记录 assistant 正文" desc="Helm 固定行为 · 排查时直接读 sessions.sqlite">/);
  assert.match(pageSource, />\s*固定\s*</);
  assert.match(pageSource, /<SettingsRow label="检查更新" desc="启动时检查 npm latest 通道">/);
  assert.match(pageSource, /自动检查已关闭，可手动检查/);
  assert.doesNotMatch(pageSource, /handleOpenLogDir/);
  assert.doesNotMatch(pageSource, /handleCheckUpdates/);
  assert.doesNotMatch(pageSource, /打开日志目录/);
  assert.doesNotMatch(pageSource, /立即检查/);
  assert.doesNotMatch(pageSource, /noRecordAssistant/);
  assert.match(pageSource, /<select/);
  assert.match(workspaceSource, /md:grid-cols-\[220px_minmax\(0,1fr\)\]/);
  assert.match(workspaceSource, /h-full min-h-0/);
  assert.match(workspaceSource, /h-full min-h-0 w-full/);
  assert.match(workspaceSource, /<div className="w-full">\{children\}<\/div>/);
  assert.doesNotMatch(workspaceSource, /max-w-\[760px\]/);
  assert.doesNotMatch(workspaceSource, /h-screen/);
  assert.doesNotMatch(workspaceSource, /TILLER \/ SETTINGS/);
  assert.doesNotMatch(navigationSource, /TILLER \/ SETTINGS/);
  assert.doesNotMatch(pageSource, /settings-v6-page/);
  assert.match(pageSource, /const \[loggingDraftLevel, setLoggingDraftLevel\] = useState<LoggingLevel \| "">\(""\);/);
  assert.match(pageSource, /setLoggingDraftLevel\(loggingSettings\?\.level \?\? ""\);/);
  assert.match(pageSource, /value=\{loggingDraftLevel\}/);
  assert.match(pageSource, /const visibleLoggingStatus =/);
  assert.match(pageSource, /loggingClientAvailable \|\| loggingConnectionKnownConnected/);
  assert.doesNotMatch(pageSource, /当前配置：/);
  assert.doesNotMatch(pageSource, /待保存：/);
  assert.match(pageSource, /onChange=\{\(event\) => setLoggingDraftLevel\(event\.target\.value as LoggingLevel\)\}/);
  assert.match(pageSource, /onClick=\{\(\) => \{\s*if \(loggingDraftLevel\) \{\s*onSaveLoggingLevel\?\.\(loggingDraftLevel\);/);
  assert.match(pageSource, />\s*保存\s*</);
  assert.match(pageSource, /disabled=\{!loggingDraftLevel \|\| loggingDraftLevel === loggingSettings\?\.level \|\| !onSaveLoggingLevel \|\| !loggingClientAvailable\}/);
  assert.match(pageSource, /<SettingsRow label="版本" desc="release channel · preview">/);
  assert.match(pageSource, /<div>当前 \{helmUpdate\?\.currentVersion \?\? "未知"\}<\/div>/);
  assert.match(pageSource, /<div>最新 \{helmUpdate\?\.latestVersion \?\? "未检查"\}<\/div>/);
  assert.doesNotMatch(pageSource, /重置偏好与数据/);
  assert.doesNotMatch(pageSource, /开源与社区/);
});
