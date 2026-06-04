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
} from "./config-controls";
import { ComposerAttachments } from "./attachments";
import { MissionStatusBar } from "./mission-status-bar";
import { SlashCommandPopup } from "./slash-command-popup";
type MissionComposerProps = {
  activeSession: SessionSummary | null;
  contextSession?: SessionSummary | null;
  worktreePickerRef: MutableRefObject<HTMLDivElement | null>;
  worktreePickerOpen: boolean;
  setWorktreePickerOpen: Dispatch<SetStateAction<boolean>>;
  agentPickerRef: MutableRefObject<HTMLDivElement | null>;
  agentPickerOpen: boolean;
  setAgentPickerOpen: Dispatch<SetStateAction<boolean>>;
  selectedProjectName?: string | null;
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
  submitPrompt: (
    event: FormEvent<HTMLFormElement>,
    targetSession?: SessionSummary | null,
  ) => void;
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
  contextSession,
  worktreePickerRef,
  worktreePickerOpen,
  setWorktreePickerOpen,
  agentPickerRef,
  agentPickerOpen,
  setAgentPickerOpen,
  selectedProjectName,
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
  const composerSession = contextSession ?? activeSession;
  const draftProjectLabel = selectedProjectName?.trim() || "未选项目";
  const composerProjectLabel = composerSession?.projectName?.trim() || draftProjectLabel;
  const composerWorktreeLabel = composerSession
    ? composerSession.worktreeName?.trim() || currentGitBranch || null
    : selectedWorktreeName.trim() || null;
  const composerAgentLabel = composerSession?.agentName ?? selectedDraftAgent?.name ?? "未选择 ACP";
  const worktreePickerAvailable = !composerSession && draftWorktreeOptions.length > 0;

  return (
    <div
      className="chat-input-area draft-toolbar mission-composer border-t border-border-ghost px-2 py-1.5 bg-surface"
      data-mission-swipe-lock="true"
      data-testid="mission-composer"
    >
      <form
        className="chat-input-form mission-composer-deck wb-pane-sunken px-2 py-1.5 w-full max-w-[min(1120px,calc(100%_-_32px))] mx-auto grid gap-1.5"
        onSubmit={(event) => submitPrompt(event, composerSession)}
        data-testid="composer-form"
      >
        <div className="mission-composer-context flex min-w-0 items-center gap-1.5">
          <span
            className="h-5 px-1.5 rounded text-2xs bg-surface flex items-center gap-1 min-w-0"
            title={composerProjectLabel}
          >
            <Icon name="folder" size={10} />
            <span className="truncate">{composerProjectLabel}</span>
          </span>
          {composerWorktreeLabel ? (
            <div ref={worktreePickerRef} className="relative min-w-0">
              <button
                type="button"
                className="h-5 px-1.5 rounded text-2xs bg-surface hover:bg-surface-emphasis flex items-center gap-1 min-w-0"
                onClick={() => {
                  if (!worktreePickerAvailable) {
                    return;
                  }
                  setAgentPickerOpen(false);
                  setWorktreePickerOpen((current) => !current);
                }}
                aria-haspopup={worktreePickerAvailable ? "listbox" : undefined}
                aria-expanded={worktreePickerAvailable ? worktreePickerOpen : undefined}
                aria-label={worktreePickerAvailable ? "选择 Worktree" : undefined}
                title={worktreePickerAvailable ? "选择 Worktree" : composerWorktreeLabel}
              >
                <Icon name="branch" size={10} />
                <span className="truncate">{composerWorktreeLabel}</span>
              </button>
              {worktreePickerAvailable && worktreePickerOpen ? (
                <div
                  className="absolute bottom-full left-0 z-50 mb-2 grid max-h-64 min-w-48 gap-1 overflow-auto rounded-lg border border-border-ghost bg-popover-glass p-1 shadow-ambient backdrop-blur-2xl"
                  role="listbox"
                  aria-label="选择 Worktree"
                >
                  {draftWorktreeOptions.map((worktree) => (
                    <button
                      key={worktree.path}
                      type="button"
                      role="option"
                      aria-selected={worktree.path === selectedCwd}
                      className={`rounded-md px-2.5 py-1.5 text-left text-section transition hover:bg-primary-soft hover:text-primary ${worktree.path === selectedCwd ? "bg-primary-soft text-primary" : "text-foreground"}`}
                      onClick={() => selectDraftWorktree(worktree.path)}
                    >
                      <strong className="block truncate">{worktree.name ?? worktree.path}</strong>
                      <span className="block truncate font-mono text-2xs text-muted-foreground">{worktree.path}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <button type="button" className="h-5 px-1.5 rounded text-2xs bg-surface hover:bg-surface-emphasis flex items-center gap-1 min-w-0">
            <Icon name="server" size={10} />
            <span className="truncate">{composerAgentLabel}</span>
          </button>
          <span className="ml-1 min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground tabular">
            → {composerSession?.title ?? draftPromptPlaceholder}
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
            rows={2}
            className="min-h-[48px] w-full resize-none rounded-none border-0 bg-transparent px-1 py-0 text-section shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
            data-testid="composer-input"
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
            className="col-start-2 self-center justify-self-center pointer-events-none flex h-6 w-fit max-w-[min(18rem,50%)] items-center rounded bg-surface-sunken/80 px-2 py-0 text-center shadow-sm"
            modelLoading={modelConfigLoading}
            promptEnhancing={promptEnhancerBusy}
          />
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
