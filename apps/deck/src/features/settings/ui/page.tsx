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
  Icon,
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
  isMobile?: boolean;
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
  isMobile = false,
}: SettingsPageProps) {
  const settingsCopy = resolveSettingsCopy(deckPreferences.language);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("appearance");
  const [mobileScreen, setMobileScreen] = useState<"list" | "detail">("list");
  const [noRecordAssistant, setNoRecordAssistant] = useState(true);

  const handleCheckUpdates = () => {
    alert("当前已是最新版本 喵~");
  };

  const handleOpenLogDir = () => {
    alert("已向本地 Helm 节点请求打开日志目录 喵~");
  };
  const appearance = sectionMeta("appearance");
  const language = sectionMeta("language");
  const motion = sectionMeta("motion");
  const panels = sectionMeta("panels");
  const enhancer = sectionMeta("enhancer");
  const privacy = sectionMeta("privacy");
  const about = sectionMeta("about");

  const renderDetailContent = () => {
    return (
      <div className="max-w-[720px]">
        {activeSection === "appearance" ? (
          <SettingsSectionFrame id={appearance.id} label={appearance.label} desc={appearance.desc}>
            <SettingsRow label={settingsCopy.themeLabel} desc="保留 system / light / dark / tiller 四种现有偏好值。">
              <div className="flex flex-wrap gap-2">
                {(["system", "light", "dark", "tiller"] as const).map((t) => {
                  const active = deckPreferences.theme === t;
                  let bgVal = "";
                  if (t === "system") bgVal = "linear-gradient(135deg, #ffffff 50%, #1f1f1f 50%)";
                  else if (t === "light") bgVal = "#f9f9fb";
                  else if (t === "dark") bgVal = "#0e0e0e";
                  else if (t === "tiller") bgVal = "#b8c1ca";

                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => updateDeckPreference("theme", t)}
                      className={`h-7 px-2 rounded text-action flex items-center gap-1.5 transition-colors ${
                        active
                          ? "bg-primary text-on-primary font-medium"
                          : "bg-surface-sunken hover:bg-surface-emphasis text-muted-foreground"
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-sm shrink-0"
                        style={{
                          background: bgVal,
                          boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.2)",
                        }}
                      />
                      {t === "system"
                        ? settingsCopy.themeSystem
                        : t === "light"
                        ? settingsCopy.themeLight
                        : t === "dark"
                        ? settingsCopy.themeDark
                        : settingsCopy.themeTiller}
                    </button>
                  );
                })}
              </div>
            </SettingsRow>
            <SettingsRow label="控制密度" desc="调整整个界面的紧凑程度，影响高度与内边距。">
              <div className="flex flex-wrap gap-2">
                {(["compact", "default", "cozy"] as const).map((d) => {
                  const active = deckPreferences.density === d;
                  const labelMap = {
                    compact: "20px · Compact",
                    default: "24px · Default",
                    cozy: "28px · Cozy",
                  };
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => updateDeckPreference("density", d)}
                      className={`h-7 px-2 rounded text-action font-mono tabular transition-colors ${
                        active
                          ? "bg-primary text-on-primary font-medium"
                          : "bg-surface-sunken hover:bg-surface-emphasis text-muted-foreground"
                      }`}
                    >
                      {labelMap[d]}
                    </button>
                  );
                })}
              </div>
            </SettingsRow>
            <SettingsRow label="字体" desc="UI 字体 · 代码字体">
              <span className="font-mono text-2xs text-muted-foreground tabular mr-2">Inter · JetBrains Mono</span>
              <button
                type="button"
                className="h-6 px-2 rounded text-2xs bg-surface-sunken hover:bg-surface-emphasis text-muted-foreground"
              >
                更改
              </button>
            </SettingsRow>
          </SettingsSectionFrame>
        ) : null}

        {activeSection === "language" ? (
          <SettingsSectionFrame id={language.id} label={language.label} desc={language.desc}>
            <SettingsRow label={settingsCopy.languageLabel} desc="Deck 界面语言，不影响后端运行时。">
              <div className="flex flex-wrap gap-2">
                {(["zh-CN", "en-US"] as const).map((lang) => {
                  const active = deckPreferences.language === lang;
                  return (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => updateDeckPreference("language", lang)}
                      className={`h-7 px-3 rounded text-action transition-colors ${
                        active
                          ? "bg-primary text-on-primary font-medium"
                          : "bg-surface-sunken hover:bg-surface-emphasis text-muted-foreground"
                      }`}
                    >
                      {lang === "zh-CN" ? "中文" : "English"}
                    </button>
                  );
                })}
              </div>
            </SettingsRow>
            <SettingsRow label="时间格式" desc="影响 mission 时间戳 / activity timeline。">
              <div className="flex flex-wrap gap-2">
                {(["relative", "absolute"] as const).map((f) => {
                  const active = deckPreferences.timeFormat === f;
                  const labelMap = {
                    relative: "相对时间",
                    absolute: "24h 时刻",
                  };
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => updateDeckPreference("timeFormat", f)}
                      className={`h-7 px-3 rounded text-action transition-colors ${
                        active
                          ? "bg-primary text-on-primary font-medium"
                          : "bg-surface-sunken hover:bg-surface-emphasis text-muted-foreground"
                      }`}
                    >
                      {labelMap[f]}
                    </button>
                  );
                })}
              </div>
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
            <SettingsRow label="数据目录" desc="所有会话 / 配置 / 设备凭据保存路径">
              <span className="font-mono text-action text-muted-foreground tabular">~/.config/tiller</span>
            </SettingsRow>
            <SettingsRow label="日志保留" desc="单文件 ≤ 5MB · 滚动 5 份">
              <div className="flex items-center gap-2">
                <span className="font-mono text-action text-muted-foreground tabular mr-2">默认</span>
                <Button variant="outline" size="sm" className="h-6 px-2 text-2xs hover:bg-surface-sunken" onClick={handleOpenLogDir}>
                  打开日志目录
                </Button>
              </div>
            </SettingsRow>
            <SettingsRow label="不记录 assistant 正文" desc="Helm 默认行为 · 排查时直接读 sessions.sqlite">
              <Switch checked={noRecordAssistant} onCheckedChange={setNoRecordAssistant} />
            </SettingsRow>
            <SettingsRow label="重置偏好与数据" desc="清空浏览器本地缓存的偏好，重置提示词增强、主题和技术面板的所有设置。">
              <Button variant="outline" size="sm" type="button" onClick={resetDeckPreferences} className="text-destructive hover:bg-destructive/10">
                清空本地数据
              </Button>
            </SettingsRow>
          </SettingsSectionFrame>
        ) : null}

        {activeSection === "about" ? (
          <SettingsSectionFrame id={about.id} label={about.label} desc={about.desc}>
            <SettingsRow label="版本" desc="release channel · preview">
              <span className="font-mono text-action text-muted-foreground tabular">v0.6.0-radial · @qianshe/tiller@preview</span>
            </SettingsRow>
            <SettingsRow label="许可证" desc="Apache License 2.0 / MIT">
              <Button variant="outline" size="sm" className="h-6 px-2 text-2xs hover:bg-surface-sunken" onClick={() => window.open("https://www.apache.org/licenses/LICENSE-2.0.html", "_blank")}>
                查看
              </Button>
            </SettingsRow>
            <SettingsRow label="检查更新" desc="启动时检查 npm latest 通道">
              <Button variant="outline" size="sm" className="h-7 px-3 text-action bg-primary text-on-primary hover:bg-primary-strong" onClick={handleCheckUpdates}>
                立即检查
              </Button>
            </SettingsRow>
            <SettingsRow label="开源与社区" desc="Tiller 采用 Apache 2.0 / MIT 协议开源。欢迎贡献代码。">
              <a
                href="https://github.com/qianshe/Tiller"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded border border-border-ghost bg-surface px-2.5 py-1 text-meta text-muted-foreground hover:bg-surface-sunken hover:text-foreground transition-all"
              >
                <Icon name="sparkle" size={12} />
                GitHub: qianshe/Tiller
              </a>
            </SettingsRow>
          </SettingsSectionFrame>
        ) : null}
      </div>
    );
  };

  if (isMobile) {
    if (mobileScreen === "list") {
      return (
        <section className="wb-pane flex h-screen min-h-0 flex-col overflow-hidden p-1">
          <div className="wb-pane-head px-3">
            <span className="wb-pane-head-eyebrow">设置</span>
          </div>
          <div className="flex-1 overflow-auto p-2">
            <div className="grid gap-2">
              {SETTINGS_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => {
                    setActiveSection(section.id);
                    setMobileScreen("detail");
                  }}
                  className="wb-pane-sunken flex items-center gap-3 p-3 text-left w-full transition-colors hover:bg-surface-sunken"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded bg-surface-sunken text-muted-foreground">
                    <Icon name={section.icon} size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-section font-medium text-foreground">{section.label}</div>
                    <div className="text-meta text-muted-foreground truncate">{section.desc}</div>
                  </div>
                  <Icon name="chevronRight" size={12} className="text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        </section>
      );
    }

    const activeSectionMeta = sectionMeta(activeSection);
    return (
      <section className="wb-pane flex h-screen min-h-0 flex-col overflow-hidden p-1">
        <div className="wb-pane-head">
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            onClick={() => setMobileScreen("list")}
            title="返回"
            className="-ml-1 mr-1.5"
          >
            <Icon name="chevronLeft" size={12} />
          </Button>
          <span className="wb-pane-head-eyebrow">{activeSectionMeta.label}</span>
          <span className="ml-1.5 text-meta text-muted-foreground hidden sm:inline">{activeSectionMeta.desc}</span>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" type="button" onClick={resetDeckPreferences}>
            {settingsCopy.reset}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {renderDetailContent()}
        </div>
      </section>
    );
  }

  return (
    <section className="settings-v6-page grid h-screen grid-cols-[220px_minmax(0,1fr)] gap-1 p-1">
      <SettingsNavigation activeId={activeSection} onSelect={setActiveSection} />

      <section className="wb-pane flex min-h-0 flex-col overflow-hidden">
        <div className="wb-pane-head">
          <span className="wb-pane-head-eyebrow">{sectionMeta(activeSection).label}</span>
          <span className="ml-1.5 text-meta text-muted-foreground">{sectionMeta(activeSection).desc}</span>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" type="button" onClick={resetDeckPreferences}>
            {settingsCopy.reset}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {renderDetailContent()}
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
