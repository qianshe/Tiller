import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "../../../shared/utils/cn";

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
  const [selectedPage, setSelectedPage] = useState<"worktrees" | "diff">("diff");
  const title = resolveInspectorTitle(
    selectedPage,
    activeSessionPresent,
    worktreeCount,
    diffCount,
  );

  return (
    <>
      {!collapsed ? resizer : null}

      {!collapsed ? (
        <aside
          className="mission-inspector mission-pane mission-pane-inspector col-start-7 col-end-8 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-ghost bg-surface shadow-none"
          style={style}
          aria-label="任务检视器"
          data-mission-mobile-pane="inspector"
        >
          <section className="inspector-section inspector-scroll mission-project-files-section grid min-h-0 gap-3 overflow-hidden p-3">
            <div className="section-head section-head-soft mission-inspector-section-head flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow text-xs font-semibold uppercase tracking-wider text-muted-foreground">项目变更</p>
                <h3 className="text-base font-semibold text-foreground">{title}</h3>
              </div>
              {loading ? (
                <span className="mission-inline-loading rounded-full bg-primary-soft px-2 py-1 text-xs font-semibold text-primary">加载中</span>
              ) : null}
            </div>
            <nav className="mission-inspector-tabs grid grid-cols-2 gap-1 rounded-lg bg-surface-sunken p-1" aria-label="项目变更子页">
              <button
                type="button"
                className={cn(
                  "rounded-md px-2 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-surface-emphasis hover:text-foreground",
                  selectedPage === "diff" && "bg-primary-soft text-primary",
                )}
                onClick={() => setSelectedPage("diff")}
              >
                Git Diff ({diffCount})
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-md px-2 py-1.5 text-xs font-semibold text-muted-foreground transition hover:bg-surface-emphasis hover:text-foreground",
                  selectedPage === "worktrees" && "bg-primary-soft text-primary",
                )}
                onClick={() => setSelectedPage("worktrees")}
              >
                Worktrees ({worktreeCount})
              </button>
            </nav>
            {selectedPage === "diff" ? diffPanel : worktreeList}
          </section>
        </aside>
      ) : null}
    </>
  );
}

function resolveInspectorTitle(
  selectedPage: "worktrees" | "diff",
  activeSessionPresent: boolean,
  worktreeCount: number,
  diffCount: number,
) {
  if (!activeSessionPresent) {
    return "未选择任务";
  }
  if (selectedPage === "diff") {
    return diffCount > 0 ? `${diffCount} 个变更` : "暂无变更";
  }
  return worktreeCount > 0 ? `${worktreeCount} 个 Worktree` : "暂无 Worktree";
}
