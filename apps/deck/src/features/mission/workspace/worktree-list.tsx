import { Icon } from "../../../shared/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../shared/ui";
import { joinClassNames } from "../utils/session-render-state";
import { normalizeWorktreePath } from "./runtime-display";
import type { MissionWorktreeSummaryItem } from "./worktree-summary";

export type MissionWorktreeOption = {
  name?: string | null;
  path: string;
};

export type MissionWorktreeAgentOption = {
  id: string;
  name?: string | null;
};

export function MissionWorktreeList({
  selectedSessionWorktreeItems,
  worktreeOptions,
  selectedCwd,
  activeSessionCwd,
  agents,
  onSelectCwd,
  onSelectDraftAgent,
}: {
  selectedSessionWorktreeItems: MissionWorktreeSummaryItem[];
  worktreeOptions: MissionWorktreeOption[];
  selectedCwd?: string | null;
  activeSessionCwd?: string | null;
  agents: MissionWorktreeAgentOption[];
  onSelectCwd: (cwd: string) => void;
  onSelectDraftAgent: (agentId: string) => void;
}) {
  return (
    <div className="mission-worktree-list grid gap-1">
      {selectedSessionWorktreeItems.length ? (
        selectedSessionWorktreeItems.map((item) => (
          <div
            key={normalizeWorktreePath(item.cwd)}
            className="rounded border border-border-ghost bg-surface px-3 py-2 text-sm"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Icon name="branch" size={11} className="text-muted-foreground" />
              <strong className="min-w-0 truncate text-foreground">{item.branchName}</strong>
            </div>
            <p className="mt-1 break-all font-mono text-[10px] leading-snug text-muted-foreground">
              {item.cwd}
            </p>
          </div>
        ))
      ) : worktreeOptions.length ? (
        worktreeOptions.map((worktree) => {
          const selected = normalizeWorktreePath(worktree.path) === normalizeWorktreePath(activeSessionCwd ?? selectedCwd);
          return (
            <div
              key={worktree.path}
              className={joinClassNames([
                "bg-transparent px-3 py-2 text-sm",
                selected ? "bg-surface-emphasis/50" : "hover:bg-surface-emphasis/40",
              ])}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <strong className="block truncate text-foreground">{worktree.name ?? worktree.path}</strong>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="rounded border border-border-ghost px-2 py-1 text-xs text-muted-foreground hover:bg-surface-emphasis"
                    >
                      连接
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {agents.length ? (
                      agents.map((agent) => (
                        <DropdownMenuItem
                          key={agent.id}
                          onSelect={() => {
                            onSelectCwd(worktree.path);
                            onSelectDraftAgent(agent.id);
                          }}
                        >
                          用 {agent.name ?? agent.id} 连接 ACP
                        </DropdownMenuItem>
                      ))
                    ) : (
                      <DropdownMenuItem disabled>暂无可用 ACP Agent</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p className="mt-1 break-all text-xs text-muted-foreground">{worktree.path}</p>
            </div>
          );
        })
      ) : (
        <p className="subtle compact text-sm leading-relaxed text-muted-foreground">
          当前选中会话暂无 cwd / 分支记录。
        </p>
      )}
    </div>
  );
}
