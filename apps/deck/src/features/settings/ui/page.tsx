import type { RefObject } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
    <section className="worktree-single">
      <Card className="grid gap-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              {settingsCopy.title}
            </h2>
          </div>
          <Button variant="secondary" type="button" onClick={resetDeckPreferences}>
            {settingsCopy.reset}
          </Button>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="grid content-start gap-3 p-4 shadow-card">
            <Label className="grid gap-2">
              <span>{settingsCopy.languageLabel}</span>
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
            </Label>
          </Card>
          <Card className="grid content-start gap-3 p-4 shadow-card">
            <Label className="grid gap-2">
              <span>{settingsCopy.themeLabel}</span>
              <Select
                value={deckPreferences.theme}
                onValueChange={(value) =>
                  updateDeckPreference("theme", value as DeckTheme)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">{settingsCopy.themeSystem}</SelectItem>
                  <SelectItem value="light">{settingsCopy.themeLight}</SelectItem>
                  <SelectItem value="dark">{settingsCopy.themeDark}</SelectItem>
                  <SelectItem value="tiller">{settingsCopy.themeTiller}</SelectItem>
                </SelectContent>
              </Select>
            </Label>
          </Card>
          <Card className="grid content-start gap-3 p-4 shadow-card">
            <p className="eyebrow">{settingsCopy.motionEyebrow}</p>
            <Label className="flex items-center gap-3">
              <Switch
                checked={deckPreferences.reduceMotion}
                onCheckedChange={(checked) =>
                  updateDeckPreference("reduceMotion", checked)
                }
              />
              <span>{settingsCopy.reduceMotion}</span>
            </Label>
          </Card>
          <Card className="grid content-start gap-3 p-4 shadow-card lg:col-span-3">
            <CardHeader className="p-0">
              <p className="eyebrow">{settingsCopy.technicalEyebrow}</p>
              <CardTitle>{settingsCopy.technicalTitle}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 p-0 sm:grid-cols-2">
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
            </CardContent>
          </Card>
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
      </Card>
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
