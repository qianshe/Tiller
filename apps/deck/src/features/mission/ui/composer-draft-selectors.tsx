import type {
  AcpAgentProvider,
  WorkspaceSummary,
} from "@tiller/shared";
import type {
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import type { Locale, UI_COPY } from "../../../shared/utils/copy";

type ComposerDraftSelectorsProps = {
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
};

/**
 * Draft-only workspace and agent pickers shown before a session exists.
 */
export function ComposerDraftSelectors({
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
}: ComposerDraftSelectorsProps) {
  return (
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
                className={workspace.id === selectedWorkspaceId ? "active" : ""}
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
                className={agent.id === selectedAgentId ? "active" : ""}
                onClick={() => selectDraftAgent(agent.id)}
              >
                {agent.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
