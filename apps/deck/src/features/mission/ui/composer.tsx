import {
  Button,
  Textarea,
} from "../../../shared/ui";
import {
  type ClipboardEvent as ReactClipboardEvent,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type SetStateAction,
  useRef,
  useState,
} from "react";
import type {
  AcpAgentProvider,
  AgentPromptImageContent,
  AvailableCommand,
  SessionConfigOption,
  SessionReasoningEffort,
  SessionSummary,
  WorktreeSummary,
} from "@tiller/shared";
import type { SessionConfigPreferencePatch } from "../types";
import type { DeckPreferences } from "../../preferences";
import type { Locale, UI_COPY } from "../../../shared/utils/copy";
import {
  MissionConfigControls,
  type AgentModeOption,
  type MissionConfigPicker,
} from "./composer-config-controls";
import { ComposerAttachments } from "./composer-attachments";
import { MissionStatusBar } from "./mission-status-bar";
import { SlashCommandPopup } from "./slash-command-popup";
type MissionComposerProps = {
  activeSession: SessionSummary | null;
  worktreePickerRef: MutableRefObject<HTMLDivElement | null>;
  worktreePickerOpen: boolean;
  setWorktreePickerOpen: Dispatch<SetStateAction<boolean>>;
  agentPickerRef: MutableRefObject<HTMLDivElement | null>;
  agentPickerOpen: boolean;
  setAgentPickerOpen: Dispatch<SetStateAction<boolean>>;
  selectedWorktreeName: string;
  draftWorktreeOptions: WorktreeSummary[];
  selectedCwd: string | null;
  selectDraftWorktree: (worktreeId: string) => void;
  currentGitBranch?: string | null;
  copy: (typeof UI_COPY)[Locale];
  agentLocked: boolean;
  selectedDraftAgent: AcpAgentProvider | null;
  filteredAgents: AcpAgentProvider[];
  selectedAgentId: string | null;
  selectDraftAgent: (agentId: string) => void;
  submitPrompt: (event: FormEvent<HTMLFormElement>) => void;
  slashWrapperRef: MutableRefObject<HTMLDivElement | null>;
  promptImages: AgentPromptImageContent[];
  removePromptImage: (index: number) => void;
  imagePasteNotice: string;
  missionPromptRef: MutableRefObject<HTMLTextAreaElement | null>;
  prompt: string;
  setPrompt: Dispatch<SetStateAction<string>>;
  handleMissionPromptKeyDown: (
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) => void;
  handleMissionPromptPaste: (
    event: ReactClipboardEvent<HTMLTextAreaElement>,
  ) => void;
  onAddPromptImages: (files: FileList | null) => void;
  draftPromptPlaceholder: string;
  slashPopupOpen: boolean;
  filteredSlashCommands: AvailableCommand[];
  slashSelectedIndex: number;
  applySlashCommand: (cmd: AvailableCommand) => void;
  setSlashSelectedIndex: Dispatch<SetStateAction<number>>;
  openSlashCommands: () => void;
  showDraftAgentModeSelect: boolean;
  missionConfigPicker: MissionConfigPicker;
  setMissionConfigPicker: Dispatch<SetStateAction<MissionConfigPicker>>;
  draftAgentModePickerLabel: string;
  draftAgentModeOptions: AgentModeOption[];
  effectiveDraftAgentMode?: string;
  updateSessionDraftPreferences: (next: SessionConfigPreferencePatch) => void;
  draftModelPlaceholder: string;
  draftModelPickerDisabled: boolean;
  draftModelPickerLabel: string;
  draftModelLoading: boolean;
  draftModelConfigReady: boolean;
  modelSettingsLocked: boolean;
  draftModelBaseOptions: string[];
  resolveReasoningOptionsForModel: (
    model: string,
    modelOptions: string[],
    configOptions: SessionConfigOption[],
  ) => SessionReasoningEffort[];
  draftAllModelOptions: string[];
  draftConfigOptions: SessionConfigOption[];
  effectiveDraftReasoningEffort: SessionReasoningEffort;
  effectiveDraftModelBase: string;
  resolveCombinedModelValue: (
    model: string,
    reasoning: SessionReasoningEffort | undefined,
    modelOptions: string[],
  ) => string;
  showDraftReasoningSelect: boolean;
  resolveReasoningLabel: (value: SessionReasoningEffort) => string;
  draftReasoningOptions: SessionReasoningEffort[];
  deckPreferences: DeckPreferences;
  enhancePromptDraft: () => void;
  promptEnhancerBusy: boolean;
  sessionCanCancel: boolean;
  cancelSession: (sessionId: string) => void;
  canSend: boolean;
};
export function MissionComposer({
  activeSession,
  worktreePickerRef,
  worktreePickerOpen,
  setWorktreePickerOpen,
  agentPickerRef,
  agentPickerOpen,
  setAgentPickerOpen,
  selectedWorktreeName,
  draftWorktreeOptions,
  selectedCwd,
  selectDraftWorktree,
  currentGitBranch,
  copy,
  agentLocked,
  selectedDraftAgent,
  filteredAgents,
  selectedAgentId,
  selectDraftAgent,
  submitPrompt,
  slashWrapperRef,
  promptImages,
  removePromptImage,
  imagePasteNotice,
  missionPromptRef,
  prompt,
  setPrompt,
  handleMissionPromptKeyDown,
  handleMissionPromptPaste,
  onAddPromptImages,
  draftPromptPlaceholder,
  slashPopupOpen,
  filteredSlashCommands,
  slashSelectedIndex,
  applySlashCommand,
  setSlashSelectedIndex,
  openSlashCommands,
  showDraftAgentModeSelect,
  missionConfigPicker,
  setMissionConfigPicker,
  draftAgentModePickerLabel,
  draftAgentModeOptions,
  effectiveDraftAgentMode,
  updateSessionDraftPreferences,
  draftModelPlaceholder,
  draftModelPickerDisabled,
  draftModelPickerLabel,
  draftModelLoading,
  draftModelConfigReady,
  modelSettingsLocked,
  draftModelBaseOptions,
  resolveReasoningOptionsForModel,
  draftAllModelOptions,
  draftConfigOptions,
  effectiveDraftReasoningEffort,
  effectiveDraftModelBase,
  resolveCombinedModelValue,
  showDraftReasoningSelect,
  resolveReasoningLabel,
  draftReasoningOptions,
  deckPreferences,
  enhancePromptDraft,
  promptEnhancerBusy,
  sessionCanCancel,
  cancelSession,
  canSend,
}: MissionComposerProps) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const activeSessionModelKnown = Boolean(activeSession?.model?.trim());
  const modelConfigMissing = activeSession
    ? !draftModelConfigReady
    : selectedDraftAgent?.protocol === "acp" && draftConfigOptions.length === 0;
  const modelConfigLoading = activeSession
    ? modelConfigMissing && !activeSessionModelKnown
    : draftModelLoading || modelConfigMissing;
  const modelSettingsDisabled = activeSession
    ? (modelConfigMissing && !activeSessionModelKnown) || modelSettingsLocked
    : modelConfigMissing || draftModelLoading || modelSettingsLocked;
  const showInterruptOnly = Boolean(activeSession && sessionCanCancel);


  return (
    <div
      className="chat-input-area draft-toolbar mission-composer border-t border-border-ghost bg-surface p-3"
      data-mission-swipe-lock="true"
    >
      <form
        className="chat-input-form mission-order-editor grid gap-3 rounded-md border border-border-ghost/70 bg-surface px-3 py-2.5"
        onSubmit={submitPrompt}
      >
        <div ref={slashWrapperRef} className="slash-command-wrapper relative">
          <ComposerAttachments
            promptImages={promptImages}
            removePromptImage={removePromptImage}
          />
          <Textarea
            id="mission-prompt-input"
            name="missionPrompt"
            ref={missionPromptRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleMissionPromptKeyDown}
            onPaste={handleMissionPromptPaste}
            placeholder={draftPromptPlaceholder}
            rows={1}
            className="min-h-28 resize-none rounded-none border-0 bg-transparent px-1 py-0 text-base shadow-none focus-visible:ring-0"
          />
          {slashPopupOpen ? (
            <SlashCommandPopup
              commands={filteredSlashCommands}
              selectedIndex={slashSelectedIndex}
              onSelect={applySlashCommand}
              onHover={setSlashSelectedIndex}
            />
          ) : null}
        </div>
        <div className="mission-composer-sidecar grid min-h-7 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5">
          <div
            className="mission-composer-tools relative flex min-w-0 items-center gap-1 text-muted-foreground"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setToolsOpen(false);
              }
            }}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mission-tools-trigger size-7 rounded-full bg-surface !text-sm"
              aria-haspopup="menu"
              aria-expanded={toolsOpen}
              aria-label="打开任务设置"
              title="模型设置"
              disabled={modelSettingsDisabled}
              onClick={() => {
                if (modelSettingsDisabled) {
                  return;
                }
                setToolsOpen((current) => !current);
              }}
            >
              ⋯
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mission-slash-trigger size-7 rounded-full bg-surface !text-sm"
              aria-label="输入斜杠命令"
              title="输入斜杠命令"
              onClick={openSlashCommands}
            >
              /
            </Button>
            <input
              ref={imageInputRef}
              className="mission-image-upload-input sr-only"
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                onAddPromptImages(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mission-image-upload-trigger size-7 rounded-full bg-surface !text-sm"
              aria-label="添加图片"
              title="添加图片"
              onClick={() => imageInputRef.current?.click()}
            >
              +
            </Button>
            {toolsOpen && !modelSettingsDisabled ? (
              <div
                className="mission-tools-menu absolute bottom-full left-0 z-50 mb-2 grid w-56 max-w-[calc(100vw-3rem)] gap-3 overflow-visible rounded-lg border border-border-ghost bg-popover-glass p-3 shadow-ambient backdrop-blur-2xl"
                role="menu"
                aria-label="任务设置"
              >
                <div className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    模型设置
                  </span>
                  <MissionConfigControls
                    showAgentModeSelect={showDraftAgentModeSelect}
                    picker={missionConfigPicker}
                    setPicker={setMissionConfigPicker}
                    agentModeLabel={draftAgentModePickerLabel}
                    agentModeOptions={draftAgentModeOptions}
                    effectiveAgentMode={effectiveDraftAgentMode}
                    updatePreferences={updateSessionDraftPreferences}
                    modelPlaceholder={draftModelPlaceholder}
                    modelDisabled={draftModelPickerDisabled}
                    modelLabel={draftModelPickerLabel}
                    modelLoading={modelConfigLoading}
                    modelBaseOptions={draftModelBaseOptions}
                    resolveReasoningOptionsForModel={resolveReasoningOptionsForModel}
                    allModelOptions={draftAllModelOptions}
                    configOptions={draftConfigOptions}
                    effectiveReasoningEffort={effectiveDraftReasoningEffort}
                    effectiveModelBase={effectiveDraftModelBase}
                    resolveCombinedModelValue={resolveCombinedModelValue}
                    showReasoningSelect={showDraftReasoningSelect}
                    resolveReasoningLabel={resolveReasoningLabel}
                    reasoningOptions={draftReasoningOptions}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <MissionStatusBar
            modelLoading={modelConfigLoading}
            promptEnhancing={promptEnhancerBusy}
          />
          <div className="mission-composer-actions flex min-w-0 items-center justify-end gap-1">
            {deckPreferences.promptEnhancer.enabled && !showInterruptOnly ? (
              <Button
                variant="outline"
                size="icon"
                type="button"
                className="mission-enhance-prompt-button size-7 !text-sm"
                onClick={enhancePromptDraft}
                disabled={!prompt.trim() || promptEnhancerBusy}
                aria-label="增强提示词"
                title="增强提示词"
              >
                ✦
              </Button>
            ) : null}
            {showInterruptOnly && activeSession ? (
              <Button
                variant="destructive"
                size="icon"
                type="button"
                className="mission-cancel-session-button size-7 rounded-full bg-destructive !text-sm font-bold text-white shadow-ambient hover:bg-destructive/90"
                onClick={() => cancelSession(activeSession.id)}
                aria-label={copy.cancelSession}
                title={copy.cancelSession}
              >
                <span
                  aria-hidden="true"
                  className="mission-cancel-session-stop-icon block size-1.5 rounded-[1px] bg-current"
                />
              </Button>
            ) : null}
            {!showInterruptOnly ? (
              <Button
                size="icon"
                type="submit"
                className="mission-send-prompt-button size-7 !text-sm"
                disabled={!canSend}
                aria-label="发送"
                title="发送"
              >
                ➤
              </Button>
            ) : null}
          </div>
        </div>
      </form>
    </div>
  );
}
