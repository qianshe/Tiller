import { cloneElement, isValidElement, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
} from "../../../shared/ui";
import { MissionPanelLoadingBadge } from "./panel-header";
import type { SessionSummary } from "@tiller/shared";

type MissionInspectorProps = {
  collapsed: boolean;
  style: CSSProperties;
  activeSessionPresent: boolean;
  activeSession?: SessionSummary | null;
  worktreeCount: number;
  worktreeSummaryLabel: string;
  loading?: boolean;
  worktreeList: ReactNode;
  diffCount: number;
  selectedDiffCount: number;
  selectedDiffPaths?: Set<string>;
  diffPanel: ReactNode;
  resizer: ReactNode;
  gitStatus?: any;
  onCommit?: (message: string, paths: string[]) => void;
  onGenerateDescription?: () => Promise<string>;
  onOpenGraph?: () => void;
  onCollapse: () => void;
  onRefreshGitStatus?: () => void;
  onToggleSelectAllDiffs?: () => void;
};

export function MissionInspector({
  collapsed,
  style,
  activeSessionPresent,
  activeSession,
  worktreeCount,
  worktreeSummaryLabel,
  loading,
  worktreeList,
  diffCount,
  selectedDiffCount,
  selectedDiffPaths = new Set(),
  diffPanel,
  resizer,
  gitStatus,
  onCommit,
  onGenerateDescription,
  onOpenGraph,
  onCollapse,
  onRefreshGitStatus,
  onToggleSelectAllDiffs,
}: MissionInspectorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const title = resolveInspectorTitle(activeSessionPresent, worktreeCount, diffCount);
  const commitScopeLabel = selectedDiffCount > 0 ? `${selectedDiffCount}/${diffCount} Diff` : `${diffCount} Diff`;
  const allDiffsSelected = diffCount > 0 && selectedDiffCount === diffCount;
  const resolvedWorktreeList = isValidElement(worktreeList)
    ? cloneElement(
        worktreeList as ReactElement<{ onClose?: () => void }>,
        { onClose: () => setPickerOpen(false) },
      )
    : worktreeList;

  useEffect(() => {
    if (!pickerOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!pickerRef.current?.contains(target)) {
        setPickerOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [pickerOpen]);

  const handleGenerateMessage = async () => {
    if (!onGenerateDescription) {
      setCommitMessage(selectedDiffCount > 0 ? `chore：更新 ${selectedDiffCount} 个选中文件` : `chore：更新 ${diffCount} 个文件`);
      return;
    }

    setGenerating(true);
    try {
      const message = await onGenerateDescription();
      setCommitMessage(message);
    } catch (error) {
      console.error("Failed to generate commit message:", error);
    } finally {
      setGenerating(false);
    }
  };

  const handleCommit = async () => {
    if (!onCommit || !commitMessage.trim() || selectedDiffCount === 0) {
      return;
    }

    setCommitting(true);
    try {
      await onCommit(commitMessage, Array.from(selectedDiffPaths));
      setCommitMessage("");
    } catch (error) {
      console.error("Commit failed:", error);
    } finally {
      setCommitting(false);
    }
  };

  const commitDisabled = !activeSession || selectedDiffCount === 0 || !commitMessage.trim() || committing || gitStatus?.committing;

  return (
    <>
      {!collapsed ? resizer : null}

      {!collapsed ? (
        <aside
          className="mission-inspector mission-pane mission-pane-inspector col-start-7 col-end-8 flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden bg-surface-sunken shadow-none"
          style={style}
          aria-label="任务检视器"
          data-mission-mobile-pane="inspector"
        >
          <div className="wb-pane-head mission-inspector-section-head flex-nowrap gap-1.5 overflow-hidden">
            <span className="wb-pane-head-eyebrow shrink-0 whitespace-nowrap">工作区</span>
            <span className="min-w-0 flex-1 truncate whitespace-nowrap text-meta text-muted-foreground">
              {title}
            </span>
            <span className="shrink-0 whitespace-nowrap text-2xs text-muted-foreground">
              {commitScopeLabel}
            </span>
            {onToggleSelectAllDiffs ? (
              <button
                type="button"
                className="shrink-0 whitespace-nowrap rounded-none bg-transparent px-1.5 py-0.5 text-2xs text-muted-foreground hover:bg-surface-emphasis/60 hover:text-foreground"
                onClick={onToggleSelectAllDiffs}
                disabled={diffCount === 0}
              >
                {allDiffsSelected ? "取消全选" : "全选"}
              </button>
            ) : null}
            {loading ? <MissionPanelLoadingBadge /> : null}
            <button
              type="button"
              className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-surface-emphasis"
              title="收起检视器"
              aria-label="收起检视器"
              onClick={onCollapse}
            >
              <Icon name="x" size={11} />
            </button>
          </div>
          <div
            className="flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ msOverflowStyle: "none", scrollbarWidth: "none" }}
          >
            <section className="grid gap-2 px-1 py-2">{diffPanel}</section>
          </div>
          <div className="mission-inspector-commit grid gap-2 border-t border-border-ghost bg-surface px-2 py-2">
            <div
              ref={pickerRef}
              className="mission-worktree-picker relative grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 text-2xs text-muted-foreground"
            >
              <button
                type="button"
                onClick={() => setPickerOpen((current) => !current)}
                className="wb-focus-ring flex min-w-0 flex-1 items-center gap-1.5 rounded-none bg-transparent px-1.5 py-1 text-left hover:bg-surface-emphasis/60"
                title="选择 Worktree"
                aria-expanded={pickerOpen}
              >
                <Icon name="branch" size={11} className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-2xs tabular">
                  {activeSessionPresent ? worktreeSummaryLabel : "未选择任务"}
                </span>
                <Icon name="chevronDown" size={10} className="text-muted-foreground" />
              </button>
              <button
                type="button"
                className="flex h-6 shrink-0 items-center gap-1 rounded-none bg-transparent px-1.5 text-2xs text-muted-foreground hover:bg-surface-emphasis/60"
                onClick={handleGenerateMessage}
                disabled={diffCount === 0 || generating}
              >
                <Icon name="activity" size={10} /> {generating ? "生成中..." : "生成描述"}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-none bg-transparent text-muted-foreground hover:bg-surface-emphasis/60"
                    title="更多 Git 操作"
                    aria-label="更多 Git 操作"
                  >
                    <Icon name="more" size={11} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onRefreshGitStatus ? (
                    <DropdownMenuItem onSelect={onRefreshGitStatus}>
                      刷新 Git
                    </DropdownMenuItem>
                  ) : null}
                  {onOpenGraph ? (
                    <DropdownMenuItem onSelect={onOpenGraph}>
                      查看提交历史
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled>Push</DropdownMenuItem>
                  <DropdownMenuItem disabled>Pull</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {pickerOpen ? (
                <div
                  className="absolute left-0 right-0 top-[calc(100%+4px)] z-10 max-h-[min(360px,55vh)] overflow-auto rounded-lg bg-popover text-popover-foreground shadow-lg"
                  style={{
                    backdropFilter: "blur(20px)",
                    boxShadow:
                      "inset 0 0 0 1px var(--border-ghost), 0 12px 28px rgb(0 0 0 / 0.25)",
                    animation: "sb-pop 180ms cubic-bezier(0.34, 1.56, 0.64, 1)",
                  }}
                >
                  {resolvedWorktreeList}
                </div>
              ) : null}
            </div>
            <div className="mission-inspector-commit-editor relative min-w-0 w-full">
              <textarea
                rows={4}
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.currentTarget.value)}
                className="min-h-[96px] w-full resize-none overflow-y-auto rounded-none border border-border-ghost bg-surface-sunken/35 px-2 py-2 pb-10 text-section leading-5 shadow-none placeholder:text-muted-foreground focus:bg-surface-sunken/50 focus:outline-none"
                placeholder="提交信息(必填) · 描述本次变更"
                aria-label="提交信息"
                disabled={committing}
              />
              <button
                type="button"
                className="mission-inspector-commit-submit absolute bottom-2 right-2 flex h-7 min-w-[108px] items-center justify-center gap-1.5 rounded-full border border-border-ghost bg-surface-elevated/95 px-3 text-section font-medium text-foreground shadow-lg shadow-black/20 backdrop-blur disabled:opacity-50"
                disabled={commitDisabled}
                onClick={handleCommit}
              >
                <Icon name="shield" size={12} /> {committing ? "提交中..." : `Commit${selectedDiffCount > 0 ? ` (${selectedDiffCount})` : ""}`}
              </button>
            </div>
          </div>
        </aside>
      ) : null}
    </>
  );
}

function resolveInspectorTitle(
  activeSessionPresent: boolean,
  worktreeCount: number,
  diffCount: number,
) {
  if (!activeSessionPresent) {
    return "未选择任务";
  }
  return worktreeCount > 0 ? `${worktreeCount} 个 Worktree` : "暂无 Worktree";
}
