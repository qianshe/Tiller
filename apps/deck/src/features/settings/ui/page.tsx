import type { RefObject } from "react";
import type { PromptEnhancerModelOption } from "../../prompt-enhancer/enhancer";
import type {
  DeckLanguage,
  DeckPreferences,
  DeckTheme,
  TechnicalPanelPreferences,
} from "../../preferences/storage";
import { resolveSettingsCopy } from "../utils/copy";
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
  const settingsCopy = resolveSettingsCopy(deckPreferences.language);
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
