import type { RefObject } from "react";
import { useEffect, useState } from "react";
import { Button, Icon } from "@/shared/ui";
import type { PromptEnhancerModelOption } from "../../prompt-enhancer";
import type { PromptEnhancerPreferences } from "../../prompt-enhancer";
import type { DeckPreferences, TechnicalPanelPreferences } from "../../preferences";
import { resolveSettingsCopy } from "../utils/copy";
import { PromptEnhancerCard } from "./prompt-enhancer-card";
import { SettingsNavigation } from "./settings-navigation";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./settings-sections";
import { SettingsRow, SettingsSectionFrame, SettingsSwitch } from "./settings-section-frame";
import type { LoggingLevel, LoggingSettings } from "../types";

const LOGGING_LEVELS: LoggingLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

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
  updatePromptEnhancerPreference: <K extends keyof PromptEnhancerPreferences>(
    key: K,
    value: PromptEnhancerPreferences[K],
  ) => void;
  updatePromptEnhancerModelInput: (value: string) => void;
  setPromptEnhancerModelPickerOpen: (open: boolean) => void;
  refreshPromptEnhancerModels: () => void;
  setPromptEnhancerModelFilter: (value: string) => void;
  selectPromptEnhancerModel: (model: PromptEnhancerModelOption) => void;
  testPromptEnhancerSelectedModel: () => void;
  loggingSettings?: LoggingSettings | null;
  loggingStatus?: string;
  loggingClientAvailable?: boolean;
  loggingConnectionKnownConnected?: boolean;
  onRefreshLoggingSettings?: () => void;
  onSaveLoggingLevel?: (level: LoggingLevel) => void;
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
  updatePromptEnhancerPreference,
  updatePromptEnhancerLlmPreference,
  updatePromptEnhancerModelInput,
  setPromptEnhancerModelPickerOpen,
  refreshPromptEnhancerModels,
  setPromptEnhancerModelFilter,
  selectPromptEnhancerModel,
  testPromptEnhancerSelectedModel,
  loggingSettings,
  loggingStatus,
  loggingClientAvailable = false,
  loggingConnectionKnownConnected = false,
  onRefreshLoggingSettings,
  onSaveLoggingLevel,
  isMobile = false,
}: SettingsPageProps) {
  const settingsCopy = resolveSettingsCopy(deckPreferences.language);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("appearance");
  const [mobileScreen, setMobileScreen] = useState<"list" | "detail">("list");
  const [loggingDraftLevel, setLoggingDraftLevel] = useState<LoggingLevel | "">("");
  const visibleLoggingStatus =
    (loggingClientAvailable || loggingConnectionKnownConnected) && loggingStatus === "Helm 未连接" ? "" : loggingStatus;

  useEffect(() => {
    setLoggingDraftLevel(loggingSettings?.level ?? "");
  }, [loggingSettings?.level]);

  const appearance = sectionMeta("appearance");
  const language = sectionMeta("language");
  const motion = sectionMeta("motion");
  const panels = sectionMeta("panels");
  const enhancer = sectionMeta("enhancer");
  const privacy = sectionMeta("privacy");
  const about = sectionMeta("about");

  const renderDetailContent = () => {
    return (
      <div className="max-w-[640px]">
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
              <span className="font-mono text-2xs text-muted-foreground tabular">Inter · JetBrains Mono</span>
            </SettingsRow>
          </SettingsSectionFrame>
        ) : null}

        {activeSection === "language" ? (
          <SettingsSectionFrame id={language.id} label={language.label} desc={language.desc}>
            <SettingsRow label={settingsCopy.languageLabel} desc="切换会即时生效">
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
            <SettingsRow label="时间格式" desc="影响 mission 时间戳 / activity timeline">
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
            <SettingsRow label="减少动效" desc="禁用 streaming pulse / drawer slide / fade transitions">
              <SettingsSwitch
                label="减少动效"
                checked={deckPreferences.reduceMotion}
                onCheckedChange={(checked) =>
                  updateDeckPreference("reduceMotion", checked)
                }
              />
            </SettingsRow>
          </SettingsSectionFrame>
        ) : null}

        {activeSection === "panels" ? (
          <SettingsSectionFrame id={panels.id} label={panels.label} desc={panels.desc}>
            <SettingsRow label={settingsCopy.logbookOpen} desc="mission 进入时即可见工具调用列表">
              <SettingsSwitch
                label={settingsCopy.logbookOpen}
                checked={technicalPanels.logbookDefaultOpen}
                onCheckedChange={(checked) => updateTechnicalPanelPreference("logbookDefaultOpen", checked)}
              />
            </SettingsRow>
            <SettingsRow label={settingsCopy.diffOpen} desc="mission 进入时即可见 patch 列表">
              <SettingsSwitch
                label={settingsCopy.diffOpen}
                checked={technicalPanels.diffDefaultOpen}
                onCheckedChange={(checked) => updateTechnicalPanelPreference("diffDefaultOpen", checked)}
              />
            </SettingsRow>
            <SettingsRow label={settingsCopy.runtimeMeta} desc="PID / Working dir / Spawn args">
              <SettingsSwitch
                label={settingsCopy.runtimeMeta}
                checked={technicalPanels.showSessionRuntimeMeta}
                onCheckedChange={(checked) => updateTechnicalPanelPreference("showSessionRuntimeMeta", checked)}
              />
            </SettingsRow>
            <SettingsRow label={settingsCopy.permissionWorktree} desc="权限弹窗附加 cwd / scope 说明">
              <SettingsSwitch
                label={settingsCopy.permissionWorktree}
                checked={technicalPanels.showPermissionWorktree}
                onCheckedChange={(checked) => updateTechnicalPanelPreference("showPermissionWorktree", checked)}
              />
            </SettingsRow>
            <SettingsRow label="Mission Thinking" desc="只控制会话小窗口中的 Thinking 展示">
              <SettingsSwitch
                label="Mission Thinking"
                checked={technicalPanels.showMissionThinking}
                onCheckedChange={(checked) => updateTechnicalPanelPreference("showMissionThinking", checked)}
              />
            </SettingsRow>
            <SettingsRow label={settingsCopy.connectionDebug} desc="WebSocket / RPC raw 帧">
              <SettingsSwitch
                label={settingsCopy.connectionDebug}
                checked={technicalPanels.showConnectionDebug}
                onCheckedChange={(checked) => updateTechnicalPanelPreference("showConnectionDebug", checked)}
              />
            </SettingsRow>
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
              updatePreference={updatePromptEnhancerPreference}
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
              <span className="font-mono text-2xs text-muted-foreground tabular">~/.config/tiller</span>
            </SettingsRow>
            <SettingsRow label="日志保留" desc="单文件 ≤ 5MB · 滚动 5 份">
              <span className="font-mono text-2xs text-muted-foreground tabular">默认</span>
            </SettingsRow>
            <SettingsRow label="日志级别" desc="保存后当前 Helm 进程立即生效">
              <div className="grid justify-items-end gap-1.5">
                <div className="flex items-center justify-end gap-2">
                  <select
                    value={loggingDraftLevel}
                    onChange={(event) => setLoggingDraftLevel(event.target.value as LoggingLevel)}
                    className="h-8 min-w-[140px] rounded border border-border-ghost bg-surface-sunken px-2 font-mono text-action uppercase text-foreground outline-none transition-colors hover:bg-surface-emphasis focus:border-primary"
                  >
                    <option value="" disabled>
                      选择级别
                    </option>
                    {LOGGING_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    className="h-7 px-2 text-action bg-primary text-on-primary hover:bg-primary-strong disabled:bg-surface-sunken disabled:text-muted-foreground"
                    disabled={!loggingDraftLevel || loggingDraftLevel === loggingSettings?.level || !onSaveLoggingLevel || !loggingClientAvailable}
                    onClick={() => {
                      if (loggingDraftLevel) {
                        onSaveLoggingLevel?.(loggingDraftLevel);
                      }
                    }}
                  >
                    保存
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    className="h-7 px-2 text-action hover:bg-surface-sunken"
                    onClick={onRefreshLoggingSettings}
                  >
                    刷新
                  </Button>
                </div>
                {visibleLoggingStatus ? (
                  <span className="block w-[220px] text-right font-mono text-2xs leading-5 text-muted-foreground tabular whitespace-normal break-words sm:w-[360px]">
                    {visibleLoggingStatus}
                  </span>
                ) : null}
              </div>
            </SettingsRow>
            <SettingsRow label="不记录 assistant 正文" desc="Helm 固定行为 · 排查时直接读 sessions.sqlite">
              <span className="font-mono text-2xs text-muted-foreground tabular">固定</span>
            </SettingsRow>
          </SettingsSectionFrame>
        ) : null}

        {activeSection === "about" ? (
          <SettingsSectionFrame id={about.id} label={about.label} desc={about.desc}>
            <SettingsRow label="版本" desc="release channel · preview">
              <span className="font-mono text-2xs text-muted-foreground tabular">@qianshe/tiller@preview</span>
            </SettingsRow>
            <SettingsRow label="许可证" desc="Apache License 2.0">
              <Button variant="outline" size="sm" className="h-6 px-2 text-2xs hover:bg-surface-sunken" onClick={() => window.open("https://www.apache.org/licenses/LICENSE-2.0.html", "_blank")}>
                查看
              </Button>
            </SettingsRow>
            <SettingsRow label="检查更新" desc="启动时检查 npm latest 通道">
              <span className="font-mono text-2xs text-muted-foreground tabular">自动</span>
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
          <div className="flex-1 overflow-auto p-1">
            <div className="grid gap-0">
              {SETTINGS_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => {
                    setActiveSection(section.id);
                    setMobileScreen("detail");
                  }}
                  className="flex h-12 w-full items-center gap-2.5 rounded px-2 text-left transition-colors hover:bg-surface-sunken active:bg-surface-emphasis"
                >
                  <Icon name={section.icon} size={16} className="text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] text-foreground">{section.label}</div>
                    <div className="text-2xs text-muted-foreground truncate">{section.desc}</div>
                  </div>
                  <Icon name="chevronRight" size={14} className="text-muted-foreground" />
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
          <Button variant="ghost" size="sm" type="button" title="重置所有 Deck 前端偏好" onClick={resetDeckPreferences}>
            重置全部
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
          <Button variant="ghost" size="sm" type="button" title="重置所有 Deck 前端偏好" onClick={resetDeckPreferences}>
            重置全部
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {renderDetailContent()}
        </div>
      </section>
    </section>
  );
}
