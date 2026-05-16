import { test } from "node:test";
import assert from "node:assert/strict";
import { createRef } from "react";
import { renderToString } from "react-dom/server";

import type { DeckPreferences, TechnicalPanelPreferences } from "../../preferences";
import { SettingsPage } from "./page";

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
  assert.match(html, /语言/);
  assert.match(html, /主题/);
  assert.match(html, /技术面板/);
  assert.match(html, /LLM 增强器/);
  assert.doesNotMatch(html, /增强器 System Prompt/);
  assert.doesNotMatch(html, /增强器指令模板/);
  assert.doesNotMatch(html, /恢复默认模板/);
});
