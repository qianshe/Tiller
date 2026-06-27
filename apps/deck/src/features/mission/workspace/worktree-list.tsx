import { Icon } from "../../../shared/ui";
import { joinClassNames } from "../utils/session-render-state";
import { normalizeWorktreePath } from "./runtime-display";
import type { MissionWorktreeSummaryItem } from "./worktree-summary";

export type MissionWorktreeOption = {
  name?: string | null;
  path: string;
  branch?: string | null;
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
  onSelectCwd,
  onClose,
}: {
  selectedSessionWorktreeItems: MissionWorktreeSummaryItem[];
  worktreeOptions: MissionWorktreeOption[];
  selectedCwd?: string | null;
  activeSessionCwd?: string | null;
  onSelectCwd: (cwd: string) => void;
  onClose?: () => void;
}) {
  return (
    <div className="mission-worktree-list grid gap-1">
      {selectedSessionWorktreeItems.length ? (
        selectedSessionWorktreeItems.map((item) => (
          <button
            key={normalizeWorktreePath(item.cwd)}
            type="button"
            className="rounded border border-border-ghost bg-surface px-3 py-2 text-left text-sm hover:bg-surface-emphasis/50"
            onClick={() => {
              onSelectCwd(item.cwd);
              onClose?.();
            }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <Icon name="branch" size={11} className="text-muted-foreground" />
              <strong className="min-w-0 truncate text-foreground">{item.projectName}</strong>
            </div>
            <p className="mt-1 truncate text-xs leading-snug text-muted-foreground">
              {item.branchName}
            </p>
            <p className="mt-1 break-all font-mono text-[10px] leading-snug text-muted-foreground">
              {item.cwd}
            </p>
          </button>
        ))
      ) : worktreeOptions.length ? (
        worktreeOptions.map((worktree) => {
          const selected = normalizeWorktreePath(worktree.path) === normalizeWorktreePath(activeSessionCwd ?? selectedCwd);
          return (
            <button
              key={worktree.path}
              type="button"
              className={joinClassNames([
                "w-full bg-transparent px-3 py-2 text-left text-sm",
                selected ? "bg-surface-emphasis/50" : "hover:bg-surface-emphasis/40",
              ])}
              onClick={() => {
                onSelectCwd(worktree.path);
                onClose?.();
              }}
            >
              <div className="min-w-0">
                <strong className="block truncate text-foreground">{worktree.name ?? worktree.path}</strong>
              </div>
              <p className="mt-1 break-all text-xs text-muted-foreground">{worktree.path}</p>
            </button>
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
