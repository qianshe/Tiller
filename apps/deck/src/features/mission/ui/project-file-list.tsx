import type { ProjectFileSummary } from "@tiller/shared";

type ProjectFileListProps = {
  activeSessionPresent: boolean;
  loading?: boolean;
  message?: string;
  projectFiles: ProjectFileSummary[];
  visibleProjectFiles: ProjectFileSummary[];
  collapsedDirectories: Set<string>;
  onToggleDirectory: (path: string) => void;
};

/**
 * Tree-style project file list shown in the mission inspector.
 */
export function ProjectFileList({
  activeSessionPresent,
  loading,
  message,
  projectFiles,
  visibleProjectFiles,
  collapsedDirectories,
  onToggleDirectory,
}: ProjectFileListProps) {
  if (!activeSessionPresent) {
    return <div className="empty-state">选择左侧任务后显示项目文件。</div>;
  }
  if (loading && !projectFiles.length) {
    return <div className="empty-state">正在加载项目文件...</div>;
  }
  if (!projectFiles.length) {
    return <div className="empty-state">{message || "暂无项目文件"}</div>;
  }
  if (!visibleProjectFiles.length) {
    return <div className="empty-state">没有匹配的项目文件</div>;
  }

  return (
    <div
      className="mission-project-file-list"
      role="tree"
      aria-label="项目文件列表"
    >
      {visibleProjectFiles.map((file) => {
        const isDirectory = file.kind === "directory";
        const collapsed = collapsedDirectories.has(file.path);
        const depth = Math.max(file.path.split("/").length - 1, 0);
        return (
          <button
            key={`${file.kind}:${file.path}`}
            type="button"
            className={`mission-project-file-row mission-project-file-${file.kind}`}
            role="treeitem"
            aria-expanded={isDirectory ? !collapsed : undefined}
            title={file.path}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            onClick={() => {
              if (isDirectory) {
                onToggleDirectory(file.path);
              }
            }}
          >
            <span className="mission-project-file-caret">
              {isDirectory ? (collapsed ? "▸" : "▾") : ""}
            </span>
            <span className="mission-project-file-icon" aria-hidden="true">
              {isDirectory ? (collapsed ? "📁" : "📂") : "📄"}
            </span>
            <strong>{file.path.split("/").slice(-1)[0] ?? file.path}</strong>
          </button>
        );
      })}
    </div>
  );
}
