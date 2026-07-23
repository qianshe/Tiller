import {
  Button,
  Icon,
  Textarea,
} from "../../../shared/ui";
import {
  type FormEvent as ReactFormEvent,
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
  ProjectSummary,
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
import { ContextUsageIndicator } from "./context-usage-indicator";
type MissionComposerProps = {
  activeSession: SessionSummary | null;
  contextSession?: SessionSummary | null;
  isMobile?: boolean;
  worktreePickerRef: MutableRefObject<HTMLDivElement | null>;
  worktreePickerOpen: boolean;
  setWorktreePickerOpen: Dispatch<SetStateAction<boolean>>;
  agentPickerRef: MutableRefObject<HTMLDivElement | null>;
  agentPickerOpen: boolean;
  setAgentPickerOpen: Dispatch<SetStateAction<boolean>>;
  selectedProjectId?: string | null;
  selectedProjectName?: string | null;
  draftProjectOptions: ProjectSummary[];
  selectDraftProject: (projectId: string) => void;
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
  sessionRestoring: boolean;
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
  promptEnhancerStatus: string;
  sessionCanCancel: boolean;
  cancelSession: (sessionId: string) => void;
  onOpenModelPicker?: () => void;
  canSend: boolean;
};

export function insertTextAtSelection(
  value: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined,
  insertedText: string,
) {
  const start = selectionStart ?? value.length;
  const end = selectionEnd ?? value.length;
  return {
    nextValue: `${value.slice(0, start)}${insertedText}${value.slice(end)}`,
    nextCaret: start + insertedText.length,
  };
}

export function MissionComposer({
  activeSession,
  contextSession,
  isMobile = false,
  worktreePickerRef,
  worktreePickerOpen,
  setWorktreePickerOpen,
  agentPickerRef,
  agentPickerOpen,
  setAgentPickerOpen,
  selectedProjectId,
  selectedProjectName,
  draftProjectOptions,
  selectDraftProject,
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
  sessionRestoring,
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
  promptEnhancerStatus,
  sessionCanCancel,
  cancelSession,
  onOpenModelPicker,
  canSend,
}: MissionComposerProps) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const [contextPicker, setContextPicker] = useState<"project" | "worktree" | null>("worktree");
  const skipNextMobileLineBreakInputRef = useRef(false);
  const explicitMobileSubmitRef = useRef(false);
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
  const composerSession = contextSession ?? activeSession;
  const draftProjectLabel = selectedProjectName?.trim() || "未选项目";
  const composerProjectLabel = composerSession?.projectName?.trim() || draftProjectLabel;
  const composerWorktreeLabel = composerSession
    ? composerSession.worktreeName?.trim() || currentGitBranch || null
    : selectedWorktreeName.trim() || null;
  const composerAgentLabel = composerSession?.agentName ?? selectedDraftAgent?.name ?? "未选择 ACP";
  const projectPickerAvailable = !composerSession && draftProjectOptions.length > 0;
  const worktreePickerAvailable = !composerSession && draftWorktreeOptions.length > 0;
  const projectPickerOpen = worktreePickerOpen && contextPicker === "project";
  const draftWorktreePickerOpen = worktreePickerOpen && contextPicker === "worktree";
  const promptRows = isMobile ? 1 : 2;
  const composerShellClassName = isMobile
    ? "chat-input-area draft-toolbar mission-composer border-t border-border-ghost px-2 py-1 bg-surface"
    : "chat-input-area draft-toolbar mission-composer border-t border-border-ghost px-2 py-1.5 bg-surface";
  const composerDeckClassName = isMobile
    ? "chat-input-form mission-composer-deck wb-pane-sunken px-1.5 py-1 w-full max-w-[min(1120px,calc(100%_-_32px))] mx-auto grid gap-0"
    : "chat-input-form mission-composer-deck wb-pane-sunken px-2 py-1.5 w-full max-w-[min(1120px,calc(100%_-_32px))] mx-auto grid gap-0.5";
  const composerContextClassName = isMobile
    ? "mission-composer-context flex min-w-0 items-center gap-1"
    : "mission-composer-context flex min-w-0 items-center gap-1.5";
  const composerContextGroupClassName = isMobile
    ? "flex min-w-0 items-center gap-1"
    : "flex min-w-0 items-center gap-1.5";
  const composerPromptClassName = isMobile
    ? "min-h-8 w-full resize-none rounded-none border-0 bg-transparent px-0.5 py-0 text-section shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
    : "min-h-[48px] w-full resize-none rounded-none border-0 bg-transparent px-1 py-0 text-section shadow-none placeholder:text-muted-foreground focus-visible:ring-0";
  const composerSidecarClassName = isMobile
    ? "mission-composer-sidecar grid min-h-6 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1"
    : "mission-composer-sidecar grid min-h-7 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5";
  const composerToolsClassName = isMobile
    ? "mission-composer-tools relative flex min-w-0 items-center gap-0.5 text-muted-foreground"
    : "mission-composer-tools relative flex min-w-0 items-center gap-1 text-muted-foreground";
  const composerStatusClassName = isMobile
    ? "col-start-2 self-center justify-self-center pointer-events-none flex h-5 w-fit max-w-[min(12rem,42%)] items-center rounded bg-surface-sunken/80 px-1.5 py-0 text-center shadow-sm"
    : "col-start-2 self-center justify-self-center pointer-events-none flex h-6 w-fit max-w-[min(18rem,50%)] items-center rounded bg-surface-sunken/80 px-2 py-0 text-center shadow-sm";
  const composerActionsClassName = isMobile
    ? "mission-composer-actions flex min-w-0 items-center justify-end gap-0.5"
    : "mission-composer-actions flex min-w-0 items-center justify-end gap-1";
  const composerSendButtonClassName = isMobile
    ? "mission-send-prompt-button h-[var(--control-h-sm)] px-2.5 text-action font-medium"
    : "mission-send-prompt-button h-ctl-md px-3 text-action font-medium";
  const syncPromptLineBreak = (target: HTMLTextAreaElement) => {
    const { nextValue, nextCaret } = insertTextAtSelection(
      target.value,
      target.selectionStart,
      target.selectionEnd,
      "\n",
    );
    setPrompt(nextValue);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        missionPromptRef.current?.setSelectionRange(nextCaret, nextCaret);
      });
    }
  };
  const handleComposerPromptKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (
      isMobile &&
      !slashPopupOpen &&
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.nativeEvent.isComposing
    ) {
      skipNextMobileLineBreakInputRef.current = true;
      event.preventDefault();
      syncPromptLineBreak(event.currentTarget);
      return;
    }
    handleMissionPromptKeyDown(event);
  };
  const handleComposerPromptBeforeInput = (event: ReactFormEvent<HTMLTextAreaElement>) => {
    if (isMobile && !slashPopupOpen) {
      const nativeEvent = event.nativeEvent as InputEvent;
      const inputType = nativeEvent.inputType;
      if (
        !nativeEvent.isComposing &&
        (inputType === "insertLineBreak" || inputType === "insertParagraph")
      ) {
        event.preventDefault();
        if (skipNextMobileLineBreakInputRef.current) {
          skipNextMobileLineBreakInputRef.current = false;
          return;
        }
        syncPromptLineBreak(event.currentTarget);
      }
    }
  };
  const toggleContextPicker = (picker: "project" | "worktree") => {
    const shouldOpen = contextPicker !== picker || !worktreePickerOpen;
    setAgentPickerOpen(false);
    setContextPicker(shouldOpen ? picker : null);
    setWorktreePickerOpen(shouldOpen);
  };

  return (
    <div
      className={composerShellClassName}
      data-mission-swipe-lock="true"
      data-testid="mission-composer"
    >
      <form
        className={composerDeckClassName}
        onSubmit={(event) => {
          if (isMobile && !explicitMobileSubmitRef.current) {
            event.preventDefault();
            return;
          }
          explicitMobileSubmitRef.current = false;
          submitPrompt(event, composerSession);
        }}
        data-testid="composer-form"
      >
        <div className={composerContextClassName}>
          <div ref={worktreePickerRef} className={composerContextGroupClassName}>
            <div className="relative min-w-0">
              <button
                type="button"
                className="h-5 px-1.5 rounded text-2xs bg-surface hover:bg-surface-emphasis flex items-center gap-1 min-w-0"
                onClick={() => {
                  if (!projectPickerAvailable) {
                    return;
                  }
                  toggleContextPicker("project");
                }}
                aria-haspopup={projectPickerAvailable ? "listbox" : undefined}
                aria-expanded={projectPickerAvailable ? projectPickerOpen : undefined}
                aria-label={projectPickerAvailable ? "选择项目" : undefined}
                title={projectPickerAvailable ? "选择项目" : composerProjectLabel}
              >
                <Icon name="folder" size={10} />
                <span className="truncate">{composerProjectLabel}</span>
              </button>
              {projectPickerAvailable && projectPickerOpen ? (
                <div
                  className="absolute bottom-full left-0 z-50 mb-2 grid max-h-64 min-w-56 gap-1 overflow-auto rounded-lg border border-border-ghost bg-popover-glass p-1 shadow-ambient backdrop-blur-2xl"
                  role="listbox"
                  aria-label="选择项目"
                >
                  {draftProjectOptions.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      role="option"
                      aria-selected={project.id === selectedProjectId}
                      className={`rounded-md px-2.5 py-1.5 text-left text-section transition hover:bg-primary-soft hover:text-primary ${project.id === selectedProjectId ? "bg-primary-soft text-primary" : "text-foreground"}`}
                      onClick={() => {
                        selectDraftProject(project.id);
                        setContextPicker(null);
                      }}
                    >
                      <strong className="block truncate">{project.name}</strong>
                      <span className="block truncate font-mono text-2xs text-muted-foreground">{project.path}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          {composerWorktreeLabel ? (
            <div className="relative min-w-0">
              <button
                type="button"
                className="h-5 px-1.5 rounded text-2xs bg-surface hover:bg-surface-emphasis flex items-center gap-1 min-w-0"
                onClick={() => {
                  if (!worktreePickerAvailable) {
                    return;
                  }
                  toggleContextPicker("worktree");
                }}
                aria-haspopup={worktreePickerAvailable ? "listbox" : undefined}
                aria-expanded={worktreePickerAvailable ? draftWorktreePickerOpen : undefined}
                aria-label={worktreePickerAvailable ? "选择 Worktree" : undefined}
                title={worktreePickerAvailable ? "选择 Worktree" : composerWorktreeLabel}
              >
                <Icon name="branch" size={10} />
                <span className="truncate">{composerWorktreeLabel}</span>
              </button>
              {worktreePickerAvailable && draftWorktreePickerOpen ? (
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
                      onClick={() => {
                        selectDraftWorktree(worktree.path);
                        setContextPicker(null);
                      }}
                    >
                      <strong className="block truncate">{worktree.name ?? worktree.path}</strong>
                      <span className="block truncate font-mono text-2xs text-muted-foreground">{worktree.path}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          </div>
          {isMobile ? null : (
            <button type="button" className="h-5 px-1.5 rounded text-2xs bg-surface hover:bg-surface-emphasis flex items-center gap-1 min-w-0">
              <Icon name="server" size={10} />
              <span className="truncate">{composerAgentLabel}</span>
            </button>
          )}
          {isMobile ? (
            <span className="min-w-0 flex-1" aria-hidden="true" />
          ) : (
            <span className="ml-1 min-w-0 flex-1 truncate font-mono text-2xs text-muted-foreground tabular">
              → {composerSession?.title ?? "新会话"}
            </span>
          )}
          <ContextUsageIndicator
            sessionId={composerSession?.id ?? null}
            isMobile={isMobile}
          />
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
            onKeyDown={handleComposerPromptKeyDown}
            onBeforeInput={handleComposerPromptBeforeInput}
            onPaste={handleMissionPromptPaste}
            placeholder={draftPromptPlaceholder}
            rows={promptRows}
            enterKeyHint={isMobile ? "enter" : undefined}
            className={composerPromptClassName}
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
        <div className={composerSidecarClassName}>
          <div
            className={composerToolsClassName}
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
                    onOpenModelPicker={onOpenModelPicker}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <MissionStatusBar
            className={composerStatusClassName}
            modelLoading={modelConfigLoading}
            sessionRestoring={sessionRestoring}
            promptEnhancing={promptEnhancerBusy}
            promptEnhancerStatus={promptEnhancerStatus}
          />
          <div className={composerActionsClassName}>
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
                    className={composerSendButtonClassName}
                    disabled={!canSend}
                    aria-label="发送"
                    title="发送"
                onClick={() => {
                  explicitMobileSubmitRef.current = true;
                }}
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
