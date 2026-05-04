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
import type { DeckPreferences } from "../../../app/preferences";
import type { Locale, UI_COPY } from "../../../app/copy";
import {
  MissionConfigControls,
  type AgentModeOption,
  type MissionConfigPicker,
} from "./mission-config-controls";

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
  handleMissionPromptKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  handleMissionPromptPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
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
                <div className="draft-toolbar-grid draft-toolbar-grid-mission">
                  <div
                    ref={worktreePickerRef}
                    className={`mission-worktree-field ${worktreePickerOpen ? "open" : ""}`}
                  >
                    <span>Workspace</span>
                    <button
                      type="button"
                      className="mission-worktree-trigger"
                      onClick={() => {
                        setAgentPickerOpen(false);
                        setWorktreePickerOpen((current) => !current);
                      }}
                      aria-haspopup="listbox"
                      aria-expanded={worktreePickerOpen}
                    >
                      <strong>{selectedWorkspaceName}</strong>
                    </button>
                    {worktreePickerOpen ? (
                      <div
                        className="mission-worktree-menu"
                        role="listbox"
                        aria-label="Workspace"
                      >
                        {draftWorkspaceOptions.map((workspace) => (
                          <button
                            key={workspace.id}
                            type="button"
                            role="option"
                            aria-selected={workspace.id === selectedWorkspaceId}
                            className={
                              workspace.id === selectedWorkspaceId
                                ? "active"
                                : ""
                            }
                            onClick={() => selectDraftWorkspace(workspace.id)}
                          >
                            <strong>{workspace.name}</strong>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div
                    ref={agentPickerRef}
                    className={`mission-agent-field ${agentPickerOpen ? "open" : ""}`}
                  >
                    <span>{copy.selectedAgent}</span>
                    <button
                      type="button"
                      className="mission-agent-trigger"
                      onClick={() => {
                        setWorktreePickerOpen(false);
                        setAgentPickerOpen((current) => !current);
                      }}
                      aria-haspopup="listbox"
                      aria-expanded={agentPickerOpen}
                      disabled={agentLocked}
                    >
                      <strong>{selectedDraftAgent?.name ?? "选择舰员"}</strong>
                    </button>
                    {agentPickerOpen ? (
                      <div
                        className="mission-agent-menu"
                        role="listbox"
                        aria-label={copy.selectedAgent}
                      >
                        {filteredAgents.map((agent) => (
                          <button
                            key={agent.id}
                            type="button"
                            role="option"
                            aria-selected={agent.id === selectedAgentId}
                            className={
                              agent.id === selectedAgentId ? "active" : ""
                            }
                            onClick={() => selectDraftAgent(agent.id)}
                          >
                            {agent.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <form
                className="chat-input-form mission-order-editor"
                onSubmit={submitPrompt}
              >
                <div ref={slashWrapperRef} className="slash-command-wrapper">
                  {promptImages.length ? (
                    <div
                      className="mission-composer-attachments mission-attachment-strip"
                      aria-label="待发送图片"
                    >
                      {promptImages.map((image, index) => (
                        <span
                          key={`${image.uri ?? image.name}-${index}`}
                          className="mission-composer-attachment mission-attachment-chip"
                        >
                          image {index + 1}
                          <button
                            type="button"
                            className="mission-composer-attachment-remove"
                            onClick={() => removePromptImage(index)}
                            aria-label={`移除 image ${index + 1}`}
                            title="移除"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {imagePasteNotice ? (
                    <p className="subtle compact mission-composer-notice">
                      {imagePasteNotice}
                    </p>
                  ) : null}
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
                    <span>＋</span>
                    <span>◎</span>
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

function SlashCommandPopup({
  commands,
  selectedIndex,
  onSelect,
  onHover,
}: {
  commands: AvailableCommand[];
  selectedIndex: number;
  onSelect: (cmd: AvailableCommand) => void;
  onHover: (index: number) => void;
}) {
  return (
    <div className="slash-command-popup" role="listbox">
      {commands.map((cmd, index) => (
        <button
          key={cmd.name}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          className={`slash-command-item ${index === selectedIndex ? "selected" : ""}`}
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(cmd);
          }}
          onMouseEnter={() => onHover(index)}
        >
          <span className="slash-command-name">/{cmd.name}</span>
          {cmd.description ? (
            <span className="slash-command-desc">{cmd.description}</span>
          ) : null}
          {cmd.input?.hint ? (
            <span className="slash-command-hint">{cmd.input.hint}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
