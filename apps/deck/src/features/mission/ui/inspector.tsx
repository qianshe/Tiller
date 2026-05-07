import type { CSSProperties, ReactNode } from "react";
import { Input } from "../../../shared/ui";

type MissionInspectorProps = {
  collapsed: boolean;
  style: CSSProperties;
  activeSessionPresent: boolean;
  projectFileCount: number;
  loading?: boolean;
  message?: string;
  filter: string;
  projectFileList: ReactNode;
  resizer: ReactNode;
  onFilterChange: (value: string) => void;
};

export function MissionInspector({
  collapsed,
  style,
  activeSessionPresent,
  projectFileCount,
  loading,
  message,
  filter,
  projectFileList,
  resizer,
  onFilterChange,
}: MissionInspectorProps) {
  return (
    <>
      {!collapsed ? resizer : null}

      {!collapsed ? (
        <aside
          className="mission-inspector mission-pane mission-pane-inspector col-start-7 col-end-8 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border-ghost bg-surface shadow-none"
          style={style}
          aria-label="任务检视器"
        >
          <section className="inspector-section inspector-scroll mission-project-files-section grid min-h-0 gap-3 overflow-hidden p-3">
            <div className="section-head section-head-soft mission-inspector-section-head flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow text-xs font-semibold uppercase tracking-wider text-muted-foreground">项目文件</p>
                <h3 className="text-base font-semibold text-foreground">
                  {activeSessionPresent
                    ? projectFileCount > 0
                      ? `${projectFileCount} 个文件`
                      : "按需查看"
                    : "未选择任务"}
                </h3>
              </div>
              {loading ? (
                <span className="mission-inline-loading rounded-full bg-primary-soft px-2 py-1 text-xs font-semibold text-primary">加载中</span>
              ) : null}
            </div>
            <p className="subtle compact text-sm leading-relaxed text-muted-foreground">
              {activeSessionPresent
                ? (message ?? "Web 端暂不拉取全量 Git 文件；请优先查看 Git Diff / 航行日志。")
                : "选择任务后才显示项目文件。"}
            </p>
            <Input
              className="mission-project-file-search bg-surface-sunken"
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              placeholder={projectFileCount > 0 ? "搜索文件路径" : "已暂停全量文件索引"}
              aria-label="搜索项目文件"
              disabled={activeSessionPresent && projectFileCount === 0}
            />
            {projectFileList}
          </section>
        </aside>
      ) : null}
    </>
  );
}
