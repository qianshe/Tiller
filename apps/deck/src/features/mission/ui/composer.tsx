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
} from "react";
import type {
  AcpAgentProvider,
  AgentPromptImageContent,
  AvailableCommand,
  SessionConfigOption,
  SessionReasoningEffort,
  SessionSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import type { DeckPreferences } from "../../preferences";
import type { Locale, UI_COPY } from "../../../shared/utils/copy";
import {
  MissionConfigControls,
  type AgentModeOption,
  type MissionConfigPicker,
} from "./composer-config-controls";
import { ComposerAttachments } from "./composer-attachments";
import { ComposerDraftSelectors } from "./composer-draft-selectors";
import { SlashCommandPopup } from "./slash-command-popup";
type MissionComposerProps = {
  activeSession: SessionSummary | null;
  worktreePickerRef: MutableRefObject<HTMLDivElement | null>;
  worktreePickerOpen: boolean;
  setWorktreePickerOpen: Dispatch<SetStateAction<boolean>>;
  agentPickerRef: MutableRefObject<HTMLDivElement | null>;
  agentPickerOpen: boolean;
  setAgentPickerOpen: Dispatch<SetStateAction<boolean>>;
  selectedWorkspaceName: string;
  draftWorkspaceOptions: WorkspaceSummary[];
  selectedWorkspaceId: string | null;
  selectDraftWorkspace: (workspaceId: string) => void;
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
  draftPromptPlaceholder: string;
  slashPopupOpen: boolean;
  filteredSlashCommands: AvailableCommand[];
  slashSelectedIndex: number;
  applySlashCommand: (cmd: AvailableCommand) => void;
  setSlashSelectedIndex: Dispatch<SetStateAction<number>>;
  showDraftAgentModeSelect: boolean;
  missionConfigPicker: MissionConfigPicker;
  setMissionConfigPicker: Dispatch<SetStateAction<MissionConfigPicker>>;
  draftAgentModePickerLabel: string;
  draftAgentModeOptions: AgentModeOption[];
  effectiveDraftAgentMode?: string;
  updateSessionDraftPreferences: (next: {
    agentMode?: string;
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  }) => void;
  draftModelPlaceholder: string;
  draftModelPickerDisabled: boolean;
  draftModelPickerLabel: string;
  draftModelLoading: boolean;
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
  sessionExecutionPending: boolean;
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
  selectedWorkspaceName,
  draftWorkspaceOptions,
  selectedWorkspaceId,
  selectDraftWorkspace,
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
  draftPromptPlaceholder,
  slashPopupOpen,
  filteredSlashCommands,
  slashSelectedIndex,
  applySlashCommand,
  setSlashSelectedIndex,
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
  sessionExecutionPending,
  cancelSession,
  canSend,
}: MissionComposerProps) {
  return (
    <div className="chat-input-area draft-toolbar border-t border-border-ghost bg-surface p-3">
      {!activeSession ? (
        <ComposerDraftSelectors
          worktreePickerRef={worktreePickerRef}
          worktreePickerOpen={worktreePickerOpen}
          setWorktreePickerOpen={setWorktreePickerOpen}
          agentPickerRef={agentPickerRef}
          agentPickerOpen={agentPickerOpen}
          setAgentPickerOpen={setAgentPickerOpen}
          selectedWorkspaceName={selectedWorkspaceName}
          draftWorkspaceOptions={draftWorkspaceOptions}
          selectedWorkspaceId={selectedWorkspaceId}
          selectDraftWorkspace={selectDraftWorkspace}
          copy={copy}
          agentLocked={agentLocked}
          selectedDraftAgent={selectedDraftAgent}
          filteredAgents={filteredAgents}
          selectedAgentId={selectedAgentId}
          selectDraftAgent={selectDraftAgent}
        />
      ) : null}
      <form
        className="chat-input-form mission-order-editor grid gap-3 rounded-lg border border-border-ghost bg-surface-sunken p-3"
        onSubmit={submitPrompt}
      >
        <div ref={slashWrapperRef} className="slash-command-wrapper relative">
          <ComposerAttachments
            promptImages={promptImages}
            removePromptImage={removePromptImage}
            imagePasteNotice={imagePasteNotice}
          />
          <Textarea
            ref={missionPromptRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleMissionPromptKeyDown}
            onPaste={handleMissionPromptPaste}
            placeholder={draftPromptPlaceholder}
            className="min-h-28 resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0"
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
        <div className="mission-composer-sidecar flex flex-wrap items-center justify-between gap-3">
          <div className="mission-composer-tools flex items-center gap-1 text-muted-foreground" aria-hidden="true">
            <span className="grid size-7 place-items-center rounded-full bg-surface text-sm">＋</span> <span className="grid size-7 place-items-center rounded-full bg-surface text-sm">◎</span>
          </div>
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
            modelLoading={
              draftModelLoading ||
              (!activeSession &&
                selectedDraftAgent?.id === "opencode" &&
                draftConfigOptions.length === 0)
            }
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
          <div className="mission-composer-actions ml-auto flex items-center gap-2">
            {deckPreferences.promptEnhancer.enabled ? (
              <Button
                variant="outline"
                size="icon"
                type="button"
                onClick={enhancePromptDraft}
                disabled={!prompt.trim() || promptEnhancerBusy}
                aria-label="增强提示词"
                title="增强提示词"
              >
                ✦
              </Button>
            ) : null}
            {activeSession && sessionExecutionPending ? (
              <Button
                variant="destructive"
                size="icon"
                type="button"
                onClick={() => cancelSession(activeSession.id)}
                aria-label={copy.cancelSession}
                title={copy.cancelSession}
              >
                ■
              </Button>
            ) : (
              <Button
                size="icon"
                type="submit"
                disabled={!canSend}
                aria-label="发送"
                title="发送"
              >
                ➤
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
