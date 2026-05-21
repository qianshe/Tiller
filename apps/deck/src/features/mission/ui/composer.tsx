import {
  Button,
  Icon,
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
    ? (modelConfigMissing && !activeSessionModelKnown) || modelSettingsLocked
    : draftModelLoading || modelConfigMissing;
  const modelSettingsDisabled = activeSession
    ? (modelConfigMissing && !activeSessionModelKnown) || modelSettingsLocked
    : modelConfigMissing || draftModelLoading || modelSettingsLocked;
  const showInterruptOnly = Boolean(activeSession && sessionCanCancel);


  return (
    <div
      className="chat-input-area draft-toolbar mission-composer border-t border-border-ghost p-2 bg-surface"
      data-mission-swipe-lock="true"
    >
      <form
        className="chat-input-form mission-composer-deck wb-pane-sunken p-2 max-w-[1080px] mx-auto grid gap-2"
        onSubmit={submitPrompt}
      >
        <div className="mission-composer-context flex min-w-0 items-center gap-1.5">
          <button type="button" className="h-5 px-1.5 rounded text-2xs bg-surface hover:bg-surface-emphasis flex items-center gap-1 min-w-0">
            <Icon name="folder" size={10} />
            <span className="truncate">{selectedWorktreeName}</span>
          </button>
          {currentGitBranch ? (
            <button type="button" className="h-5 px-1.5 rounded text-2xs bg-surface hover:bg-surface-emphasis flex items-center gap-1 min-w-0">
              <Icon name="branch" size={10} />
              <span className="truncate">{currentGitBranch}</span>
            </button>
          ) : null}
          <button type="button" className="h-5 px-1.5 rounded text-2xs bg-surface hover:bg-surface-emphasis flex items-center gap-1 min-w-0">
            <Icon name="terminal" size={10} />
            <span className="truncate">{selectedDraftAgent?.name ?? "未选择 Agent"}</span>
          </button>
          <span className="ml-1 min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground tabular">
            → {activeSession?.title ?? draftPromptPlaceholder}
          </span>
        </div>
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
            rows={3}
            className="min-h-[72px] w-full resize-none rounded-none border-0 bg-transparent px-1 py-0 text-section shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
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
              size="icon-sm"
              className="mission-tools-trigger rounded-full bg-surface"
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
              size="icon-sm"
              className="mission-slash-trigger rounded-full bg-surface"
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
              size="icon-sm"
              className="mission-image-upload-trigger rounded-full bg-surface"
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
                  <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
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
          <span className="hidden min-w-0 truncate font-mono text-2xs text-muted-foreground tabular sm:block">
            esc 取消 · ↑ 历史
          </span>
          <div className="mission-composer-actions flex min-w-0 items-center justify-end gap-1">
            {deckPreferences.promptEnhancer.enabled && !showInterruptOnly ? (
              <Button
                variant="outline"
                size="icon-sm"
                type="button"
                className="mission-enhance-prompt-button"
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
                size="icon-sm"
                type="button"
                className="mission-cancel-session-button rounded-full font-bold text-white shadow-ambient"
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
                size="sm"
                type="submit"
                className="mission-send-prompt-button h-ctl-md px-3 text-action font-medium"
                disabled={!canSend}
                aria-label="发送"
                title="发送"
              >
                发送 <Icon name="send" size={11} />
              </Button>
            ) : null}
          </div>
        </div>
      </form>
    </div>
  );
}
