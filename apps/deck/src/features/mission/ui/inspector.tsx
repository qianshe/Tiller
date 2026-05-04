import type { CSSProperties, ReactNode } from "react";

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
  onExpand: () => void;
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
  onExpand,
}: MissionInspectorProps) {
  return (
    <>
      {!collapsed ? resizer : null}
      {collapsed ? (
        <button
          className="mission-inspector-toggle mission-inspector-floating-toggle"
          type="button"
          onClick={onExpand}
          aria-label="展开任务检视器"
          title="展开任务检视器"
        >
          ›
        </button>
      ) : null}

      {!collapsed ? (
        <aside
          className="mission-inspector mission-pane mission-pane-inspector"
          style={style}
          aria-label="任务检视器"
        >
          <section className="inspector-section inspector-scroll mission-project-files-section">
            <div className="section-head section-head-soft mission-inspector-section-head">
              <div>
                <p className="eyebrow">项目文件</p>
                <h3>
                  {activeSessionPresent
                    ? `${projectFileCount} 个文件`
                    : "未选择任务"}
                </h3>
              </div>
              {loading ? (
                <span className="mission-inline-loading">加载中</span>
              ) : null}
            </div>
            <p className="subtle compact">
              {activeSessionPresent
                ? (message ??
                  "完整文件列表由 Helm 按当前任务的 Project / Workspace 返回。")
                : "选择任务后才显示项目文件。"}
            </p>
            <input
              className="mission-project-file-search"
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              placeholder="搜索文件路径"
              aria-label="搜索项目文件"
            />
            {projectFileList}
          </section>
        </aside>
      ) : null}
    </>
  );
}
