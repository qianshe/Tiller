import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "../../../shared/ui";
import { MissionPanelLoadingBadge } from "./panel-header";
import type { SessionSummary } from "@tiller/shared";

type MissionInspectorProps = {
  collapsed: boolean;
  style: CSSProperties;
  activeSessionPresent: boolean;
  activeSession?: SessionSummary | null;
  dispatch?: any;
  rpcClient?: any;
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
  deckPreferences?: any;
  onCommit?: (message: string, paths: string[]) => void;
  onGenerateDescription?: () => Promise<string>;
  onOpenGraph?: () => void;
  onCollapse: () => void;
  onRefreshGitStatus?: () => void;
};

export function MissionInspector({
  collapsed,
  style,
  activeSessionPresent,
  activeSession,
  dispatch,
  rpcClient,
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
  deckPreferences,
  onCommit,
  onGenerateDescription,
  onOpenGraph,
  onCollapse,
  onRefreshGitStatus,
}: MissionInspectorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const [committing, setCommitting] = useState(false);

  const title = resolveInspectorTitle(activeSessionPresent, worktreeCount, diffCount);
  const commitScopeLabel = selectedDiffCount > 0 ? `${selectedDiffCount}/${diffCount} Diff` : `${diffCount} Diff`;

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

  const handleDebugUpdates = async () => {
    if (!activeSession || !dispatch || !rpcClient) {
      console.warn("⚠️ Debug Updates: No active session or RPC client available");
      return;
    }

    try {
      const result: any = await dispatch(rpcClient, "session/list_updates", {
        sessionId: activeSession.id,
        limit: 100,
      });

      if (result?.ok) {
        console.group("📊 Session Updates Debug Report");
        console.log("━".repeat(60));
        console.log(`Session ID: ${result.sessionId}`);
        console.log(`Total: ${result.updates.length} updates | Has More: ${result.hasMore}`);
        if (result.nextCursor) {
          console.log(`Next Cursor: ${result.nextCursor}`);
        }
        console.log("━".repeat(60));

        // 格式化表格
        console.table(
          result.updates.map((u: any) => ({
            Seq: u.sequence,
            Source: u.source,
            Type: u.updateType,
            Time: new Date(u.receivedAt).toLocaleTimeString(),
          }))
        );

        console.log("\n💡 Expand the array below to view full update details:");
        console.log(result.updates);
        console.groupEnd();
      } else {
        console.error("❌ Failed to fetch session updates:", result?.message ?? "Unknown error");
      }
    } catch (error) {
      console.error("❌ Debug Updates Error:", error);
    }
  };

  return (
    <>
      {!collapsed ? resizer : null}

      {!collapsed ? (
        <aside
          className="mission-inspector mission-pane mission-pane-inspector col-start-7 col-end-8 flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface-sunken border-l border-border-ghost shadow-none"
          style={style}
          aria-label="任务检视器"
          data-mission-mobile-pane="inspector"
        >
          <div className="wb-pane-head mission-inspector-section-head">
            <span className="wb-pane-head-eyebrow">工作区</span>
            <span className="min-w-0 truncate font-mono text-meta text-muted-foreground tabular">
              {title}
            </span>
            <div className="flex-1" />
            {loading ? <MissionPanelLoadingBadge /> : null}
            {activeSessionPresent ? (
              <button
                type="button"
                className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-surface-emphasis"
                title="调试会话更新（输出到 Console）"
                aria-label="调试会话更新"
                onClick={handleDebugUpdates}
              >
                <Icon name="inspect" size={11} />
              </button>
            ) : null}
            <button
              type="button"
              className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-surface-emphasis"
              title="收起检视器"
              aria-label="收起检视器"
              onClick={onCollapse}
            >
              <Icon name="x" size={11} />
            </button>
          </div>
          <div className="mission-worktree-picker relative border-b border-border-ghost px-2 py-1">
            <button
              type="button"
              onClick={() => setPickerOpen((current) => !current)}
              className="wb-focus-ring flex h-5 w-full items-center gap-1.5 rounded-none bg-transparent px-2 text-left hover:bg-surface-emphasis/60"
              title="选择 Worktree"
              aria-expanded={pickerOpen}
            >
              <Icon name="branch" size={11} className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-2xs tabular">
                {activeSessionPresent ? worktreeSummaryLabel : "未选择任务"}
              </span>
              <Icon name="chevronDown" size={10} className="text-muted-foreground" />
            </button>
            {pickerOpen ? (
              <div
                className="absolute left-2 right-2 top-[calc(100%-2px)] z-10 max-h-[min(360px,55vh)] overflow-auto rounded-lg bg-popover text-popover-foreground shadow-lg"
                style={{
                  backdropFilter: "blur(20px)",
                  boxShadow:
                    "inset 0 0 0 1px var(--border-ghost), 0 12px 28px rgb(0 0 0 / 0.25)",
                  animation: "sb-pop 180ms cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}
              >
                {worktreeList}
              </div>
            ) : null}
          </div>
          <div
            className="flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ msOverflowStyle: "none", scrollbarWidth: "none" }}
          >
            <section className="grid gap-2 px-1 py-2">{diffPanel}</section>
          </div>
          <div className="mission-inspector-commit border-t border-border-ghost bg-surface p-2">
            <div className="mb-1 flex items-center justify-between gap-2 text-2xs text-muted-foreground">
              <span>{commitScopeLabel}</span>
              <div className="flex items-center gap-1">
                {onRefreshGitStatus ? (
                  <button
                    type="button"
                    className="flex h-5 items-center gap-1 rounded-none bg-transparent px-1.5 hover:bg-surface-emphasis/60"
                    onClick={onRefreshGitStatus}
                    title="刷新 Git 状态"
                  >
                    <Icon name="activity" size={10} /> 刷新 Git
                  </button>
                ) : null}
                <button
                  type="button"
                  className="flex h-5 items-center gap-1 rounded-none bg-transparent px-1.5 hover:bg-surface-emphasis/60"
                  onClick={handleGenerateMessage}
                  disabled={diffCount === 0 || generating}
                >
                  <Icon name="activity" size={10} /> {generating ? "生成中..." : "生成描述"}
                </button>
              </div>
            </div>
            <textarea
              rows={2}
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.currentTarget.value)}
              className="mb-2 w-full resize-none rounded-none bg-transparent p-2 text-section shadow-none placeholder:text-muted-foreground focus:bg-surface-sunken/50 focus:outline-none"
              placeholder="提交信息(必填) · 描述本次变更"
              aria-label="提交信息"
              disabled={committing}
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="flex h-ctl-md flex-1 items-center justify-center gap-1.5 rounded-none bg-transparent px-3 text-section font-medium text-muted-foreground disabled:opacity-50"
                disabled={commitDisabled}
                onClick={handleCommit}
              >
                <Icon name="shield" size={12} /> {committing ? "提交中..." : `Commit${selectedDiffCount > 0 ? ` (${selectedDiffCount})` : ""}`}
              </button>
              {onOpenGraph ? (
                <button
                  type="button"
                  className="flex h-ctl-md items-center gap-1.5 rounded-none bg-transparent px-3 text-section hover:bg-surface-emphasis/60"
                  onClick={onOpenGraph}
                  title="查看提交历史"
                >
                  <Icon name="branch" size={11} /> 历史
                </button>
              ) : null}
              <button
                type="button"
                className="flex h-ctl-md items-center gap-1.5 rounded-none bg-transparent px-3 text-section text-muted-foreground/60"
                disabled
                title="Push 暂未实现"
              >
                <Icon name="branch" size={11} /> Push
              </button>
              <button
                type="button"
                className="flex h-ctl-md items-center gap-1.5 rounded-none bg-transparent px-3 text-section text-muted-foreground/60"
                disabled
                title="Pull 暂未实现"
              >
                <Icon name="chevronDown" size={11} /> Pull
              </button>
              <button
                type="button"
                className="grid h-ctl-md w-7 place-items-center rounded-none bg-transparent text-muted-foreground/60"
                disabled
                title="更多操作暂未实现"
              >
                <Icon name="more" size={11} />
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
