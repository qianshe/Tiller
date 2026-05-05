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
    <div className="chat-input-area draft-toolbar">
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
        className="chat-input-form mission-order-editor"
        onSubmit={submitPrompt}
      >
        <div ref={slashWrapperRef} className="slash-command-wrapper">
          <ComposerAttachments
            promptImages={promptImages}
            removePromptImage={removePromptImage}
            imagePasteNotice={imagePasteNotice}
          />
          <textarea
            ref={missionPromptRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handleMissionPromptKeyDown}
            onPaste={handleMissionPromptPaste}
            placeholder={draftPromptPlaceholder}
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
        <div className="mission-composer-sidecar">
          <div className="mission-composer-tools" aria-hidden="true">
            <span>＋</span> <span>◎</span>
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
          <div className="mission-composer-actions">
            {deckPreferences.promptEnhancer.enabled ? (
              <button
                className="secondary composer-icon-button"
                type="button"
                onClick={enhancePromptDraft}
                disabled={!prompt.trim() || promptEnhancerBusy}
                aria-label="增强提示词"
                title="增强提示词"
              >
                ✦
              </button>
            ) : null}
            {activeSession && sessionExecutionPending ? (
              <button
                className="composer-send-icon composer-cancel-icon"
                type="button"
                onClick={() => cancelSession(activeSession.id)}
                aria-label={copy.cancelSession}
                title={copy.cancelSession}
              >
                ■
              </button>
            ) : (
              <button
                className="primary composer-send-icon"
                type="submit"
                disabled={!canSend}
                aria-label="发送"
                title="发送"
              >
                ➤
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
