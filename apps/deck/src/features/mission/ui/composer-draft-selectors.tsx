import type {
  AcpAgentProvider,
  WorkspaceSummary,
} from "@tiller/shared";
import { cn } from "../../../shared/utils/cn";
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
  currentGitBranch?: string | null;
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
  currentGitBranch,
  copy,
  agentLocked,
  selectedDraftAgent,
  filteredAgents,
  selectedAgentId,
  selectDraftAgent,
}: ComposerDraftSelectorsProps) {
  return (
    <div className="draft-toolbar-grid draft-toolbar-grid-mission grid gap-3 rounded-lg border border-border-ghost bg-surface-sunken p-3 sm:grid-cols-2">
      <div
        ref={worktreePickerRef}
        className={`mission-worktree-field ${worktreePickerOpen ? "open" : ""} relative grid gap-1`}
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Workspace</span>
        <button
          type="button"
          className="mission-worktree-trigger flex min-h-10 items-center justify-between rounded-md border border-border-ghost bg-surface px-3 py-2 text-left text-sm text-foreground transition hover:bg-surface-emphasis"
          onClick={() => {
            setAgentPickerOpen(false);
            setWorktreePickerOpen((current) => !current);
          }}
          aria-haspopup="listbox"
          aria-expanded={worktreePickerOpen}
        >
          <strong>{selectedWorkspaceName}</strong>
        </button>
        <span className="text-xs text-muted-foreground">
          当前分支：{currentGitBranch || "未检测"}
        </span>
        {worktreePickerOpen ? (
          <div
            className="mission-worktree-menu absolute left-0 top-full z-40 mt-2 grid max-h-72 w-full gap-1 overflow-auto rounded-md border border-border-ghost bg-popover-glass p-1 shadow-ambient backdrop-blur-2xl"
            role="listbox"
            aria-label="Workspace"
          >
            {draftWorkspaceOptions.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                role="option"
                aria-selected={workspace.id === selectedWorkspaceId}
                className={cn("rounded-sm px-3 py-2 text-left text-sm text-foreground transition hover:bg-primary-soft hover:text-primary", workspace.id === selectedWorkspaceId && "active bg-primary-soft text-primary")}
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
        className={`mission-agent-field ${agentPickerOpen ? "open" : ""} relative grid gap-1`}
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">ACP Agent（创建前必选）</span>
        <button
          type="button"
          className="mission-agent-trigger flex min-h-10 items-center justify-between rounded-md border border-border-ghost bg-surface px-3 py-2 text-left text-sm text-foreground transition hover:bg-surface-emphasis disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => {
            setWorktreePickerOpen(false);
            setAgentPickerOpen((current) => !current);
          }}
          aria-haspopup="listbox"
          aria-expanded={agentPickerOpen}
          disabled={agentLocked}
        >
          <strong>{selectedDraftAgent?.name ?? "选择 ACP Agent"}</strong>
        </button>
        {agentPickerOpen ? (
          <div
            className="mission-agent-menu absolute left-0 top-full z-40 mt-2 grid max-h-72 w-full gap-1 overflow-auto rounded-md border border-border-ghost bg-popover-glass p-1 shadow-ambient backdrop-blur-2xl"
            role="listbox"
            aria-label={copy.selectedAgent}
          >
            {filteredAgents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                role="option"
                aria-selected={agent.id === selectedAgentId}
                className={cn("rounded-sm px-3 py-2 text-left text-sm text-foreground transition hover:bg-primary-soft hover:text-primary", agent.id === selectedAgentId && "active bg-primary-soft text-primary")}
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
