import { cloneElement, isValidElement, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { GitCommitHorizontal, RefreshCw } from "lucide-react";
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
import type { GitStatusState } from "../../../store/facade";
import { GitDiscardConfirmDialog } from "./git-discard-confirm-dialog";

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
  gitStatus?: GitStatusState;
  onCommit?: (message: string, paths: string[]) => Promise<{ ok?: boolean } | void> | { ok?: boolean } | void;
  onGenerateDescription?: () => Promise<string>;
  onOpenGraph?: () => void;
  onOpenGitError?: () => void;
  onRefreshGitStatus?: () => void;
  onFetch?: () => Promise<unknown>;
  onPush?: () => Promise<unknown>;
  onPull?: () => Promise<unknown>;
  onDiscard?: (paths: string[]) => Promise<{ ok?: boolean } | void>;
  onCollapse: () => void;
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
  onOpenGitError,
  onCollapse,
  onRefreshGitStatus,
  onFetch,
  onPush,
  onPull,
  onDiscard,
  onToggleSelectAllDiffs,
}: MissionInspectorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
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
      const result = await onCommit(commitMessage, Array.from(selectedDiffPaths));
      if (result?.ok !== false) {
        setCommitMessage("");
      }
    } catch (error) {
      console.error("Commit failed:", error);
    } finally {
      setCommitting(false);
    }
  };

  const commitDisabled = !activeSession || selectedDiffCount === 0 || !commitMessage.trim() || committing || gitStatus?.committing;

  const handlePush = async () => {
    if (!onPush) return;
    setPushing(true);
    try {
      await onPush();
    } finally {
      setPushing(false);
    }
  };

  const handlePull = async () => {
    if (!onPull) return;
    setPulling(true);
    try {
      await onPull();
    } finally {
      setPulling(false);
    }
  };

  const handleFetch = async () => {
    if (!onFetch) return;
    setFetching(true);
    try {
      await onFetch();
    } finally {
      setFetching(false);
    }
  };

  const handleConfirmDiscard = async () => {
    if (!onDiscard || !discardConfirmOpen) return;
    setDiscarding(true);
    try {
      const result = await onDiscard(Array.from(selectedDiffPaths));
      if (result?.ok !== false) {
        setDiscardConfirmOpen(false);
      }
    } finally {
      setDiscarding(false);
    }
  };

  const status = gitStatus;
  const gitOperationBusy = resolveGitOperationBusy(status, {
    pulling,
    pushing,
    fetching,
    discarding,
    committing,
  });
  const pullDisabled = !onPull || gitOperationBusy;
  const pushDisabled = !onPush || gitOperationBusy;
  const fetchDisabled = !onFetch || gitOperationBusy;

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
              className="mission-worktree-picker relative flex min-w-0 items-center gap-1 text-2xs text-muted-foreground"
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
                {status && (status.behind > 0 || status.ahead > 0) ? (
                  <span
                    className="flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums"
                    title={status.trackingStale ? "远端状态可能已过期，请先 Fetch" : "Git 同步状态"}
                  >
                    {status.behind > 0 ? (
                      <span
                        className={status.trackingStale ? "text-muted-foreground/60" : "text-warning"}
                        title={`待 Pull ${status.behind} 个提交`}
                        aria-label={`待 Pull ${status.behind} 个提交`}
                      >
                        ↓{status.behind}
                      </span>
                    ) : null}
                    {status.ahead > 0 ? (
                      <span
                        className={status.trackingStale ? "text-muted-foreground/60" : "text-success"}
                        title={`待 Push ${status.ahead} 个提交`}
                        aria-label={`待 Push ${status.ahead} 个提交`}
                      >
                        ↑{status.ahead}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                <Icon name="chevronDown" size={10} className="text-muted-foreground" />
              </button>
              <button
                type="button"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-none bg-transparent text-muted-foreground hover:bg-surface-emphasis/60 disabled:opacity-50"
                onClick={handleGenerateMessage}
                disabled={diffCount === 0 || generating}
                title={generating ? "正在生成提交描述" : "生成提交描述"}
                aria-label={generating ? "正在生成提交描述" : "生成提交描述"}
              >
                <Icon name="activity" size={11} />
              </button>
              <button
                type="button"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-none bg-transparent text-muted-foreground hover:bg-surface-emphasis/60 disabled:opacity-50"
                onClick={onRefreshGitStatus}
                disabled={!onRefreshGitStatus || status?.loading}
                title="刷新 Git"
                aria-label="刷新 Git"
              >
                <RefreshCw size={11} aria-hidden="true" />
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
                <DropdownMenuContent
                  align="end"
                  side="top"
                  sideOffset={6}
                  className="min-w-32 rounded-lg border border-border-ghost/80 bg-surface-elevated p-1 text-foreground shadow-[0_14px_36px_rgb(0_0_0/0.34)] ring-1 ring-white/5"
                >
                  <DropdownMenuItem
                    className="rounded-md px-2 py-1 text-xs focus:bg-surface-emphasis focus:text-foreground"
                    onSelect={onOpenGraph}
                    disabled={!onOpenGraph}
                  >
                    历史
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="rounded-md px-2 py-1 text-xs focus:bg-surface-emphasis focus:text-foreground"
                    onSelect={() => void handleFetch()}
                    disabled={fetchDisabled}
                  >
                    {fetching ? "Fetch 中..." : "Fetch"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="rounded-md px-2 py-1 text-xs focus:bg-surface-emphasis focus:text-foreground"
                    onSelect={() => void handlePull()}
                    disabled={pullDisabled}
                  >
                    {pulling ? "Pull 中..." : "Pull"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="rounded-md px-2 py-1 text-xs focus:bg-surface-emphasis focus:text-foreground"
                    onSelect={() => void handlePush()}
                    disabled={pushDisabled}
                  >
                    {pushing ? "Push 中..." : "Push"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="rounded-md px-2 py-1 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
                        onSelect={() => setDiscardConfirmOpen(true)}
                        disabled={!onDiscard || gitOperationBusy || selectedDiffCount === 0}
                      >
                        丢弃选中改动
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="rounded-md px-2 py-1 text-xs focus:bg-surface-emphasis focus:text-foreground"
                    onSelect={onOpenGitError}
                    disabled={!onOpenGitError}
                  >
                    查看错误
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {pickerOpen ? (
                <div
                  className="absolute left-0 right-0 bottom-[calc(100%+4px)] z-10 max-h-[min(360px,55vh)] overflow-auto rounded-lg bg-popover text-popover-foreground shadow-lg"
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
                className="mission-inspector-commit-submit absolute bottom-2 right-2 flex h-6 min-w-[88px] items-center justify-center gap-1 rounded-full border border-border-ghost bg-surface-elevated/95 px-2.5 text-2xs font-medium text-foreground shadow-lg shadow-black/20 backdrop-blur disabled:opacity-50"
                disabled={commitDisabled}
                onClick={handleCommit}
              >
                <GitCommitHorizontal size={11} aria-hidden="true" />
                {committing ? "提交中..." : `Commit${selectedDiffCount > 0 ? ` (${selectedDiffCount})` : ""}`}
              </button>
            </div>
          </div>
        </aside>
      ) : null}
      <GitDiscardConfirmDialog
        open={discardConfirmOpen}
        selectedCount={selectedDiffCount}
        busy={discarding}
        onCancel={() => setDiscardConfirmOpen(false)}
        onConfirm={() => void handleConfirmDiscard()}
      />
    </>
  );
}

/**
 * Combines local in-flight flags with store-side busy flags so operations
 * stay gated across component remounts and while a Commit is in progress.
 */
export function resolveGitOperationBusy(
  status: GitStatusState | undefined,
  local: {
    pulling: boolean;
    pushing: boolean;
    fetching: boolean;
    discarding: boolean;
    committing: boolean;
  },
) {
  return local.pulling || local.pushing || local.fetching || local.discarding ||
    local.committing ||
    Boolean(
      status?.loading || status?.discarding || status?.pushing ||
        status?.pulling || status?.committing,
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
