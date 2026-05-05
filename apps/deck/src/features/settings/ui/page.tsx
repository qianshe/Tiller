import type { RefObject } from "react";
import type { PromptEnhancerModelOption } from "../../prompt-enhancer/enhancer";
import {
  DEFAULT_PROMPT_ENHANCER_INSTRUCTION_TEMPLATE,
  DEFAULT_PROMPT_LLM_SYSTEM_PROMPT,
  type DeckLanguage,
  type DeckPreferences,
  type DeckTheme,
  type TechnicalPanelPreferences,
} from "../../preferences/storage";
import { PromptEnhancerCard } from "./prompt-enhancer-card";
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
  resetPromptEnhancerDefaults: () => void;
  testPromptEnhancerSelectedModel: () => void;
};
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
  resetPromptEnhancerDefaults,
  testPromptEnhancerSelectedModel,
}: SettingsPageProps) {
  const settingsCopy =
    deckPreferences.language === "en-US"
      ? {
          title: "Settings",
          subtitle:
            "Configure Deck theme, language, technical panels, and prompt enhancement. All options are stored locally in this browser.",
          reset: "Reset defaults",
          languageEyebrow: "Language",
          languageLabel: "Language",
          languageHelp:
            "Switches navigation and core Settings copy; ACP Crew domain terms keep their original names.",
          themeEyebrow: "Theme",
          themeLabel: "Theme",
          themeSystem: "System",
          themeLight: "Light",
          themeDark: "Dark",
          themeHelp:
            "Theme only affects this Deck and is not written to Helm or Crew config.",
          motionEyebrow: "Motion",
          reduceMotion: "Reduce transition animations",
          technicalEyebrow: "Technical panel controls",
          technicalTitle:
            "Choose which diagnostic details are visible by default",
          logbookOpen: "Open Logbook by default",
          diffOpen: "Open diff summary by default",
          runtimeMeta: "Show Session runtime metadata",
          permissionWorkspace: "Show permission request workspace path",
          connectionDebug: "Show connection/pairing debug echo",
          enhancerEyebrow: "Prompt enhancement",
          enhancerTitle: "Wrap casual chat as a standard prompt",
          enhancerEnabled: "Enable before send",
          enhancerHelp: [
            "Enhancement is prepended before sending to ACP;",
            "the chat window still shows your original input",
            "and nothing is written to Helm/backend config.",
          ].join(" "),
          instructionLabel: "Enhanced prompt textbox · Role and goal",
          modelLabel: "Model config position · Reasoning preference",
          contractLabel: "Output contract",
          saveEyebrow: "Saved state",
          browserTitle: "Current browser",
          saveStatus:
            "Frontend preferences are auto-saved; backend, provider, and Helm-level settings still belong to the concrete Helm / Crew.",
          devicesEyebrow: "Trusted devices",
          devicesTitle: "7-day remembered Deck / App devices",
          devicesHelp:
            "Each trusted device is scoped to this Helm profile. Revoking a device forces it to pair again on that device.",
          devicesEmpty: "No trusted devices yet.",
          currentDevice: "Current device",
          revoke: "Revoke",
          clientKindWeb: "Web",
          clientKindApp: "App",
          lastSeen: "Last seen",
          expiresAt: "Expires",
        }
      : {
          title: "设置",
          subtitle:
            "配置 Deck 语言、主题、技术面板与提示词增强；所有选项只保存在浏览器本地。",
          reset: "重置默认",
          languageEyebrow: "语言 / Language",
          languageLabel: "语言",
          languageHelp:
            "用于切换导航与 设置基础文案；ACP 舰员 领域术语保持原名。",
          themeEyebrow: "主题切换",
          themeLabel: "主题",
          themeSystem: "跟随系统",
          themeLight: "浅色",
          themeDark: "深色",
          themeHelp: "主题只影响当前 Deck，不会写入 Helm 或舰员配置。",
          motionEyebrow: "动效",
          reduceMotion: "减少过渡动画",
          technicalEyebrow: "技术面板控制",
          technicalTitle: "决定哪些诊断信息默认展示",
          logbookOpen: "默认展开航行日志",
          diffOpen: "默认展开变更摘要",
          runtimeMeta: "显示任务 runtime 元信息",
          permissionWorkspace: "显示权限请求工作区路径",
          connectionDebug: "显示连接/配对调试回显",
          enhancerEyebrow: "提示词增强",
          enhancerTitle: "把普通对话包装成标准提示词",
          enhancerEnabled: "发送前启用",
          enhancerHelp:
            "增强内容会在发送到 ACP 前拼接；聊天窗口仍显示你的原始输入，不会写入 Helm 或后端配置。",
          instructionLabel: "增强提示词文本框 · 角色与目标",
          modelLabel: "模型配置位置 · 推理偏好",
          contractLabel: "输出契约",
          saveEyebrow: "保存状态",
          browserTitle: "当前浏览器",
          saveStatus:
            "前端偏好会自动保存；后端、provider、Helm 级配置仍在具体 Helm / 舰员中管理。",
          devicesEyebrow: "信标",
          devicesTitle: "当前 Helm 记住的 7 天信标",
          devicesHelp:
            "每个信标都只属于当前 Helm profile。撤销后，该设备下次必须重新配对。",
          devicesEmpty: "当前还没有信标。",
          currentDevice: "当前信标",
          revoke: "撤销",
          clientKindWeb: "网页",
          clientKindApp: "App",
          lastSeen: "最近认证",
          expiresAt: "信任到期",
        };
  return (
    <section className="workspace-single">
      <section className="card surface-card stack-gap">
        <div className="section-head section-head-soft">
          <div>
            <h2>{settingsCopy.title}</h2>
          </div>
          <button
            className="secondary"
            type="button"
            onClick={resetDeckPreferences}
          >
            {settingsCopy.reset}
          </button>
        </div>
        <div className="settings-grid settings-form">
          <section className="note-box settings-card">
            <label>
              <span>{settingsCopy.languageLabel}</span>
              <select
                aria-label={settingsCopy.languageLabel}
                value={deckPreferences.language}
                onChange={(event) =>
                  updateDeckPreference(
                    "language",
                    event.target.value as DeckLanguage,
                  )
                }
              >
                <option value="zh-CN">中文</option>
                <option value="en-US">English</option>
              </select>
            </label>
          </section>
          <section className="note-box settings-card">
            <label>
              <span>{settingsCopy.themeLabel}</span>
              <select
                value={deckPreferences.theme}
                onChange={(event) =>
                  updateDeckPreference("theme", event.target.value as DeckTheme)
                }
              >
                <option value="system">{settingsCopy.themeSystem}</option>
                <option value="light">{settingsCopy.themeLight}</option>
                <option value="dark">{settingsCopy.themeDark}</option>
              </select>
            </label>
          </section>
          <section className="note-box settings-card">
            <p className="eyebrow">{settingsCopy.motionEyebrow}</p>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={deckPreferences.reduceMotion}
                onChange={(event) =>
                  updateDeckPreference("reduceMotion", event.target.checked)
                }
              />
              <span>{settingsCopy.reduceMotion}</span>
            </label>
          </section>
          <section className="note-box settings-card settings-card-full">
            <p className="eyebrow">{settingsCopy.technicalEyebrow}</p>
            <h3>{settingsCopy.technicalTitle}</h3>
            <div className="settings-control-grid">
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={technicalPanels.logbookDefaultOpen}
                  onChange={(event) =>
                    updateTechnicalPanelPreference(
                      "logbookDefaultOpen",
                      event.target.checked,
                    )
                  }
                />
                <span>{settingsCopy.logbookOpen}</span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={technicalPanels.diffDefaultOpen}
                  onChange={(event) =>
                    updateTechnicalPanelPreference(
                      "diffDefaultOpen",
                      event.target.checked,
                    )
                  }
                />
                <span>{settingsCopy.diffOpen}</span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={technicalPanels.showSessionRuntimeMeta}
                  onChange={(event) =>
                    updateTechnicalPanelPreference(
                      "showSessionRuntimeMeta",
                      event.target.checked,
                    )
                  }
                />
                <span>{settingsCopy.runtimeMeta}</span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={technicalPanels.showPermissionWorkspace}
                  onChange={(event) =>
                    updateTechnicalPanelPreference(
                      "showPermissionWorkspace",
                      event.target.checked,
                    )
                  }
                />
                <span>{settingsCopy.permissionWorkspace}</span>
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={technicalPanels.showConnectionDebug}
                  onChange={(event) =>
                    updateTechnicalPanelPreference(
                      "showConnectionDebug",
                      event.target.checked,
                    )
                  }
                />
                <span>{settingsCopy.connectionDebug}</span>
              </label>
            </div>
          </section>
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
            resetDefaults={resetPromptEnhancerDefaults}
            testSelectedModel={testPromptEnhancerSelectedModel}
          />
        </div>
      </section>
    </section>
  );
}
function groupPromptEnhancerModels(
  models: PromptEnhancerModelOption[],
  filter: string,
) {
  const needle = filter.trim().toLowerCase();
  const groups = new Map<string, PromptEnhancerModelOption[]>();
  for (const model of models) {
    if (
      needle &&
      !model.id.toLowerCase().includes(needle) &&
      !model.ownedBy.toLowerCase().includes(needle)
    ) {
      continue;
    }
    const owner = model.ownedBy || "default";
    groups.set(owner, [...(groups.get(owner) ?? []), model]);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([owner, ownerModels]) => ({
      owner,
      models: ownerModels.sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    }));
}
