import type { RefObject } from "react";
import { useState } from "react";
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@/shared/ui";
import type { PromptEnhancerModelOption } from "../../prompt-enhancer";
import type {
  DeckLanguage,
  DeckPreferences,
  DeckTheme,
  TechnicalPanelPreferences,
} from "../../preferences";
import { resolveSettingsCopy } from "../utils/copy";
import { PromptEnhancerCard } from "./prompt-enhancer-card";
import { SettingsNavigation } from "./settings-navigation";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./settings-sections";
import { SettingsRow, SettingsSectionFrame } from "./settings-section-frame";

type SettingsPageProps = {
  deckPreferences: DeckPreferences;
  technicalPanels: TechnicalPanelPreferences;
  promptModelPickerRef: RefObject<HTMLDivElement | null>;
  promptEnhancerBusy: boolean;
  promptEnhancerModelPickerOpen: boolean;
  promptEnhancerModelFilter: string;
  promptEnhancerModels: PromptEnhancerModelOption[];
  promptEnhancerStatus: string;
  resetDeckPreferences: () => void;
  updateDeckPreference: <K extends keyof DeckPreferences>(
    key: K,
    value: DeckPreferences[K],
  ) => void;
  updateTechnicalPanelPreference: <K extends keyof TechnicalPanelPreferences>(
    key: K,
    value: TechnicalPanelPreferences[K],
  ) => void;
  updatePromptEnhancerLlmPreference: <
    K extends keyof DeckPreferences["promptEnhancer"]["llm"],
  >(
    key: K,
    value: DeckPreferences["promptEnhancer"]["llm"][K],
  ) => void;
  updatePromptEnhancerModelInput: (value: string) => void;
  setPromptEnhancerModelPickerOpen: (open: boolean) => void;
  refreshPromptEnhancerModels: () => void;
  setPromptEnhancerModelFilter: (value: string) => void;
  selectPromptEnhancerModel: (model: PromptEnhancerModelOption) => void;
  testPromptEnhancerSelectedModel: () => void;
};

function sectionMeta(id: SettingsSectionId) {
  return SETTINGS_SECTIONS.find((section) => section.id === id)!;
}

export function SettingsPage({
  deckPreferences,
  technicalPanels,
  promptModelPickerRef,
  promptEnhancerBusy,
  promptEnhancerModelPickerOpen,
  promptEnhancerModelFilter,
  promptEnhancerModels,
  promptEnhancerStatus,
  resetDeckPreferences,
  updateDeckPreference,
  updateTechnicalPanelPreference,
  updatePromptEnhancerLlmPreference,
  updatePromptEnhancerModelInput,
  setPromptEnhancerModelPickerOpen,
  refreshPromptEnhancerModels,
  setPromptEnhancerModelFilter,
  selectPromptEnhancerModel,
  testPromptEnhancerSelectedModel,
}: SettingsPageProps) {
  const settingsCopy = resolveSettingsCopy(deckPreferences.language);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("appearance");
  const appearance = sectionMeta("appearance");
  const language = sectionMeta("language");
  const motion = sectionMeta("motion");
  const panels = sectionMeta("panels");
  const enhancer = sectionMeta("enhancer");
  const privacy = sectionMeta("privacy");
  const about = sectionMeta("about");

  return (
    <section className="settings-v6-page grid h-screen grid-cols-[220px_minmax(0,1fr)] gap-1 p-1">
      <SettingsNavigation activeId={activeSection} onSelect={setActiveSection} />

      <section className="wb-pane flex min-h-0 flex-col overflow-hidden">
        <div className="wb-pane-head">
          <span className="wb-pane-head-eyebrow">{sectionMeta(activeSection).label}</span>
          <span className="ml-1.5 text-2xs text-muted-foreground">{sectionMeta(activeSection).desc}</span>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" type="button" onClick={resetDeckPreferences}>
            {settingsCopy.reset}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="max-w-[720px]">
            {activeSection === "appearance" ? (
              <SettingsSectionFrame id={appearance.id} label={appearance.label} desc={appearance.desc}>
                <SettingsRow label={settingsCopy.themeLabel} desc="保留 system / light / dark / tiller 四种现有偏好值。">
                  <Select
                    value={deckPreferences.theme}
                    onValueChange={(value) =>
                      updateDeckPreference("theme", value as DeckTheme)
                    }
                  >
                    <SelectTrigger aria-label={settingsCopy.themeLabel}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">{settingsCopy.themeSystem}</SelectItem>
                      <SelectItem value="light">{settingsCopy.themeLight}</SelectItem>
                      <SelectItem value="dark">{settingsCopy.themeDark}</SelectItem>
                      <SelectItem value="tiller">{settingsCopy.themeTiller}</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingsRow>
              </SettingsSectionFrame>
            ) : null}

            {activeSection === "language" ? (
              <SettingsSectionFrame id={language.id} label={language.label} desc={language.desc}>
                <SettingsRow label={settingsCopy.languageLabel} desc="Deck 界面语言，不影响后端运行时。">
                  <Select
                    value={deckPreferences.language}
                    onValueChange={(value) =>
                      updateDeckPreference("language", value as DeckLanguage)
                    }
                  >
                    <SelectTrigger aria-label={settingsCopy.languageLabel}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="zh-CN">中文</SelectItem>
                      <SelectItem value="en-US">English</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingsRow>
                <SettingsRow label="时间格式" desc="影响 mission 时间戳 / activity timeline。">
                  <span className="rounded bg-primary px-3 py-1 text-[12px] text-on-primary">相对时间</span>
                  <span className="rounded bg-surface-sunken px-3 py-1 text-[12px] text-muted-foreground">24h 时刻</span>
                </SettingsRow>
              </SettingsSectionFrame>
            ) : null}

            {activeSection === "motion" ? (
              <SettingsSectionFrame id={motion.id} label={motion.label} desc={motion.desc}>
                <SettingsRow label={settingsCopy.reduceMotion} desc={settingsCopy.motionEyebrow}>
                  <Switch
                    checked={deckPreferences.reduceMotion}
                    onCheckedChange={(checked) =>
                      updateDeckPreference("reduceMotion", checked)
                    }
                  />
                </SettingsRow>
              </SettingsSectionFrame>
            ) : null}

            {activeSection === "panels" ? (
              <SettingsSectionFrame id={panels.id} label={panels.label} desc={settingsCopy.technicalTitle}>
                <div className="grid gap-2 sm:grid-cols-2">
                  <TechnicalSwitch
                    checked={technicalPanels.logbookDefaultOpen}
                    label={settingsCopy.logbookOpen}
                    onCheckedChange={(checked) =>
                      updateTechnicalPanelPreference("logbookDefaultOpen", checked)
                    }
                  />
                  <TechnicalSwitch
                    checked={technicalPanels.diffDefaultOpen}
                    label={settingsCopy.diffOpen}
                    onCheckedChange={(checked) =>
                      updateTechnicalPanelPreference("diffDefaultOpen", checked)
                    }
                  />
                  <TechnicalSwitch
                    checked={technicalPanels.showSessionRuntimeMeta}
                    label={settingsCopy.runtimeMeta}
                    onCheckedChange={(checked) =>
                      updateTechnicalPanelPreference("showSessionRuntimeMeta", checked)
                    }
                  />
                  <TechnicalSwitch
                    checked={technicalPanels.showPermissionWorktree}
                    label={settingsCopy.permissionWorktree}
                    onCheckedChange={(checked) =>
                      updateTechnicalPanelPreference("showPermissionWorktree", checked)
                    }
                  />
                  <TechnicalSwitch
                    checked={technicalPanels.showConnectionDebug}
                    label={settingsCopy.connectionDebug}
                    onCheckedChange={(checked) =>
                      updateTechnicalPanelPreference("showConnectionDebug", checked)
                    }
                  />
                </div>
              </SettingsSectionFrame>
            ) : null}

            {activeSection === "enhancer" ? (
              <SettingsSectionFrame id={enhancer.id} label={enhancer.label} desc={enhancer.desc}>
                <PromptEnhancerCard
                  deckPreferences={deckPreferences}
                  pickerRef={promptModelPickerRef}
                  busy={promptEnhancerBusy}
                  modelPickerOpen={promptEnhancerModelPickerOpen}
                  modelFilter={promptEnhancerModelFilter}
                  models={promptEnhancerModels}
                  status={promptEnhancerStatus}
                  updateLlmPreference={updatePromptEnhancerLlmPreference}
                  updateModelInput={updatePromptEnhancerModelInput}
                  setModelPickerOpen={setPromptEnhancerModelPickerOpen}
                  refreshModels={refreshPromptEnhancerModels}
                  setModelFilter={setPromptEnhancerModelFilter}
                  selectModel={selectPromptEnhancerModel}
                  testSelectedModel={testPromptEnhancerSelectedModel}
                />
              </SettingsSectionFrame>
            ) : null}

            {activeSection === "privacy" ? (
              <SettingsSectionFrame id={privacy.id} label={privacy.label} desc={privacy.desc}>
                <p className="text-sm leading-6 text-muted-foreground">
                  Tiller Deck 保持 local-first：设置保存在本地偏好中，ACP / Helm 数据仍由现有连接与运行时提供。
                </p>
              </SettingsSectionFrame>
            ) : null}

            {activeSection === "about" ? (
              <SettingsSectionFrame id={about.id} label={about.label} desc={about.desc}>
                <p className="text-sm leading-6 text-muted-foreground">
                  当前页面已迁移到 v6 Workbench Void 分类布局；真实偏好更新入口保持不变。
                </p>
              </SettingsSectionFrame>
            ) : null}
          </div>
        </div>
      </section>
    </section>
  );
}

type TechnicalSwitchProps = {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

function TechnicalSwitch({
  checked,
  label,
  onCheckedChange,
}: TechnicalSwitchProps) {
  return (
    <Label className="flex items-center gap-3 rounded-md bg-surface-sunken px-3 py-2">
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
      <span>{label}</span>
    </Label>
  );
}
