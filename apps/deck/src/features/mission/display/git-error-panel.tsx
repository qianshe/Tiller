import { AlertTriangle } from "lucide-react";
import type { GitGraphState, GitStatusState } from "../../../store/facade";

type GitErrorPanelProps = {
  gitStatus?: GitStatusState;
  gitGraph?: GitGraphState;
};

export function GitErrorPanel({ gitStatus, gitGraph }: GitErrorPanelProps) {
  const error = gitStatus?.error ?? gitStatus?.remoteRefreshError ?? gitGraph?.error;

  if (!error) {
    return (
      <div className="git-error-panel flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
        当前没有 Git 错误。
      </div>
    );
  }

  return (
    <div className="git-error-panel flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex items-center gap-2 border-b border-border-ghost px-3 py-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-destructive/10 text-destructive">
          <AlertTriangle size={13} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">Git 操作错误</div>
          <div className="truncate font-mono text-2xs text-muted-foreground" title={gitStatus?.cwd ?? gitGraph?.cwd}>
            {gitStatus?.cwd ?? gitGraph?.cwd ?? "未知工作区"}
          </div>
        </div>
      </div>
      <pre className="m-3 whitespace-pre-wrap break-words rounded-lg border border-border-ghost/80 bg-surface-elevated p-3 font-mono text-xs leading-5 text-foreground shadow-sm">
        {error}
      </pre>
    </div>
  );
}
