import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../shared/ui/tabs";
import { MissionPanelHeader, MissionPanelLoadingBadge } from "./panel-header";

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
            <MissionPanelHeader
              className="section-head section-head-soft mission-inspector-section-head"
              title={title}
              action={loading ? <MissionPanelLoadingBadge /> : null}
            />
            <Tabs
              value={selectedPage}
              onValueChange={(value) => setSelectedPage(value as "worktrees" | "diff")}
              className="grid min-h-0 gap-2 overflow-hidden"
              aria-label="项目变更子页"
            >
              <TabsList size="xs" className="grid grid-cols-2">
                <TabsTrigger size="xs" value="diff">
                  Git Diff ({diffCount})
                </TabsTrigger>
                <TabsTrigger size="xs" value="worktrees">
                  Worktrees ({worktreeCount})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="diff" className="mt-0 min-h-0 overflow-hidden">
                {diffPanel}
              </TabsContent>
              <TabsContent value="worktrees" className="mt-0 min-h-0 overflow-hidden">
                {worktreeList}
              </TabsContent>
            </Tabs>
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
