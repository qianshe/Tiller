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
const sectionsSource = readFileSync(resolve(currentDir, "settings-sections.ts"), "utf8");

const technicalPanels: TechnicalPanelPreferences = {
  logbookDefaultOpen: false,
  diffDefaultOpen: true,
  showSessionRuntimeMeta: true,
  showPermissionWorktree: true,
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
  assert.match(html, /settings-section-frame/);
  assert.doesNotMatch(html, /settings-section-frame[^\"]*wb-pane/);
  assert.match(html, /flex items-start justify-between gap-6 border-b border-border-ghost py-3 last:border-b-0/);
  assert.match(html, /max-w-\[640px\]/);
  assert.match(html, /外观/);
  assert.match(html, /面板/);
  assert.match(html, /关于/);
  assert.match(html, /语言/);
  assert.match(html, /主题/);
  assert.match(html, /技术面板/);
  assert.match(html, /Prompt 增强/);
  assert.doesNotMatch(html, /LLM 增强器/);
  assert.doesNotMatch(html, /增强器 System Prompt/);
  assert.doesNotMatch(html, /增强器指令模板/);
  assert.doesNotMatch(html, /恢复默认模板/);

  assert.match(sectionsSource, /desc: "减少动效偏好"/);
  assert.match(sectionsSource, /desc: "Logbook \/ Diff \/ 调试"/);
  assert.match(sectionsSource, /desc: "LLM 接入 · 模型"/);
  assert.match(sectionsSource, /desc: "数据保留策略"/);
  assert.match(sectionsSource, /desc: "版本 · 许可证"/);
  assert.match(pageSource, /<SettingsRow label=\{settingsCopy\.languageLabel\} desc="切换会即时生效">/);
  assert.match(pageSource, /<SettingsRow label="时间格式" desc="影响 mission 时间戳 \/ activity timeline">/);
  assert.match(pageSource, /<SettingsRow label="减少动效" desc="禁用 streaming pulse \/ drawer slide \/ fade transitions">/);
  assert.match(pageSource, /<SettingsRow label=\{settingsCopy\.connectionDebug\} desc="WebSocket \/ RPC raw 帧">/);
  assert.match(pageSource, /className="flex h-12 w-full items-center gap-2\.5 rounded px-2 text-left transition-colors hover:bg-surface-sunken active:bg-surface-emphasis"/);
  assert.doesNotMatch(pageSource, /wb-pane-sunken flex items-center gap-3 p-3/);
  assert.doesNotMatch(pageSource, /TechnicalSwitch/);
  assert.doesNotMatch(pageSource, /sm:grid-cols-2/);
  assert.match(pageSource, /<SettingsRow label="数据目录" desc="所有会话 \/ 配置 \/ 设备凭据保存路径">/);
  assert.match(pageSource, /<SettingsRow label="版本" desc="release channel · preview">/);
  assert.match(pageSource, /@qianshe\/tiller@preview/);
  assert.doesNotMatch(pageSource, /重置偏好与数据/);
  assert.doesNotMatch(pageSource, /开源与社区/);
});
