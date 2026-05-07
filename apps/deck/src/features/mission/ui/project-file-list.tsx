import type { ProjectFileSummary } from "@tiller/shared";

type ProjectFileListProps = {
  activeSessionPresent: boolean;
  loading?: boolean;
  message?: string;
  projectFiles: ProjectFileSummary[];
  visibleProjectFiles: ProjectFileSummary[];
  expandedDirectories: Set<string>;
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
  expandedDirectories,
  onToggleDirectory,
}: ProjectFileListProps) {
  if (!activeSessionPresent) {
    return <div className="empty-state rounded-md border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">选择左侧任务后显示项目文件。</div>;
  }
  if (loading && !projectFiles.length) {
    return <div className="empty-state rounded-md border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">正在加载项目文件...</div>;
  }
  if (!projectFiles.length) {
    return <div className="empty-state rounded-md border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">{message || "Web 端暂不加载全量 Git 文件；可通过 Git Diff 和航行日志查看相关结构。"}</div>;
  }
  if (!visibleProjectFiles.length) {
    return <div className="empty-state rounded-md border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">没有匹配的项目文件</div>;
  }

  return (
    <div
      className="mission-project-file-list min-h-0 space-y-1 overflow-y-auto pr-1"
      role="tree"
      aria-label="项目文件列表"
    >
      {visibleProjectFiles.map((file) => {
        const isDirectory = file.kind === "directory";
        const expanded = expandedDirectories.has(file.path);
        const depth = Math.max(file.path.split("/").length - 1, 0);
        return (
          <button
            key={`${file.kind}:${file.path}`}
            type="button"
            className={`mission-project-file-row mission-project-file-${file.kind} grid w-full grid-cols-[16px_20px_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition hover:bg-surface-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40`}
            role="treeitem"
            aria-expanded={isDirectory ? expanded : undefined}
            title={file.path}
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            onClick={() => {
              if (isDirectory) {
                onToggleDirectory(file.path);
              }
            }}
          >
            <span className="mission-project-file-caret text-xs text-muted-foreground">
              {isDirectory ? (expanded ? "▾" : "▸") : ""}
            </span>
            <span className="mission-project-file-icon text-sm" aria-hidden="true">
              {isDirectory ? (expanded ? "📂" : "📁") : "📄"}
            </span>
            <strong className="min-w-0 truncate font-medium">{file.path.split("/").slice(-1)[0] ?? file.path}</strong>
          </button>
        );
      })}
    </div>
  );
}
