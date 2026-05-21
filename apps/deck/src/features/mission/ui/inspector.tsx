import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "../../../shared/ui";
import { MissionPanelLoadingBadge } from "./panel-header";

type MissionInspectorProps = {
  collapsed: boolean;
  style: CSSProperties;
  activeSessionPresent: boolean;
  worktreeCount: number;
  loading?: boolean;
  worktreeList: ReactNode;
  diffCount: number;
  diffPanel: ReactNode;
  resizer: ReactNode;
};

export function MissionInspector({
  collapsed,
  style,
  activeSessionPresent,
  worktreeCount,
  loading,
  worktreeList,
  diffCount,
  diffPanel,
  resizer,
}: MissionInspectorProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const title = resolveInspectorTitle(activeSessionPresent, worktreeCount, diffCount);

  return (
    <>
      {!collapsed ? resizer : null}

      {!collapsed ? (
        <aside
          className="mission-inspector mission-pane mission-pane-inspector col-start-7 col-end-8 flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface-sunken border-l border-border-ghost shadow-none"
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
            <button
              type="button"
              className="grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-surface-emphasis"
              title="收起检视器"
              aria-label="收起检视器"
            >
              <Icon name="x" size={11} />
            </button>
          </div>
          <div className="mission-worktree-picker relative border-b border-border-ghost px-2 py-1.5">
            <button
              type="button"
              onClick={() => setPickerOpen((current) => !current)}
              className="wb-focus-ring flex h-7 w-full items-center gap-1.5 rounded bg-surface px-2 text-left hover:bg-surface-emphasis"
              title="选择 Worktree"
              aria-expanded={pickerOpen}
            >
              <Icon name="branch" size={11} className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-2xs tabular">
                {activeSessionPresent ? `${worktreeCount} Worktrees · ${diffCount} Diff` : "未选择任务"}
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
          <div className="flex-1 overflow-auto">
            <section className="grid gap-2 p-2">{diffPanel}</section>
          </div>
          <div className="mission-inspector-commit border-t border-border-ghost bg-surface p-2">
            <textarea
              rows={2}
              className="mb-2 w-full resize-none rounded bg-surface-sunken p-2 text-section shadow-[inset_0_0_0_1px_var(--border-ghost)] placeholder:text-muted-foreground focus:outline-none"
              placeholder="提交信息(必填) · 描述本次变更"
              aria-label="提交信息"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className="flex h-ctl-md flex-1 items-center justify-center gap-1.5 rounded bg-surface-sunken px-3 text-section font-medium text-muted-foreground"
                disabled
              >
                <Icon name="shield" size={12} /> Commit
              </button>
              <button
                type="button"
                className="flex h-ctl-md items-center gap-1.5 rounded bg-surface-sunken px-3 text-section hover:bg-surface-emphasis"
              >
                <Icon name="branch" size={11} /> Push
              </button>
              <button
                type="button"
                className="grid h-ctl-md w-7 place-items-center rounded bg-surface-sunken text-muted-foreground hover:bg-surface-emphasis"
                title="更多操作"
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
  if (diffCount > 0) {
    return `${diffCount} 个变更`;
  }
  return worktreeCount > 0 ? `${worktreeCount} 个 Worktree` : "暂无 Worktree";
}
