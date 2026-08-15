import type { FileDiffSummary } from "@tiller/shared";
import { formatGitDiffStatus, renderGitDiffStats, type GitDiffTreeNode, buildGitDiffTree } from "./diff-tree";

export function GitDiffFileList({
  files,
  selectedPath,
  collapsedDirectories,
  onSelectFile,
  onToggleDirectory,
}: {
  files: FileDiffSummary[];
  selectedPath: string | null;
  collapsedDirectories: ReadonlySet<string>;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
}) {
  const tree = buildGitDiffTree(files);
  return (
    <div className="grid min-h-0 gap-0.5 overflow-auto pr-1" aria-label="Git Diff 文件列表">
      {tree.map((node) => (
        <GitDiffTreeRow
          key={node.id}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          collapsedDirectories={collapsedDirectories}
          onSelectFile={onSelectFile}
          onToggleDirectory={onToggleDirectory}
        />
      ))}
    </div>
  );
}

function GitDiffTreeRow({
  node,
  depth,
  selectedPath,
  collapsedDirectories,
  onSelectFile,
  onToggleDirectory,
}: {
  node: GitDiffTreeNode;
  depth: number;
  selectedPath: string | null;
  collapsedDirectories: ReadonlySet<string>;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
}) {
  if (node.kind === "file" && node.file) {
    const file = node.file;
    return (
      <button
        type="button"
        className={`grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-1 rounded-none px-1 py-1 text-left text-meta transition hover:bg-surface-emphasis/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${selectedPath === file.path ? "bg-surface-emphasis/80 text-foreground" : "text-foreground"}`}
        style={{ paddingLeft: `${4 + depth * 10}px` }}
        onClick={() => onSelectFile(file.path)}
        title={file.path}
      >
        <span className="grid size-3 place-items-center rounded-sm border border-current bg-transparent font-mono text-[9px] font-semibold leading-none text-primary" aria-hidden="true">
          {formatGitDiffStatus(file.status)}
        </span>
        <span className="min-w-0 truncate">{node.name}</span>
        {renderGitDiffStats(file)}
      </button>
    );
  }

  const collapsed = collapsedDirectories.has(node.path);
  return (
    <section className="grid gap-0.5" key={node.id}>
      <button
        type="button"
        className="grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-1 rounded-none px-1 py-1 text-left text-meta font-medium text-foreground transition hover:bg-surface-emphasis/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        style={{ paddingLeft: `${depth * 10}px` }}
        onClick={() => onToggleDirectory(node.path)}
        aria-expanded={!collapsed}
      >
        <span className="text-muted-foreground">{collapsed ? "▸" : "▾"}</span>
        <span className="min-w-0 truncate">{node.name}</span>
        <span className="rounded-sm bg-surface-emphasis/70 px-1.5 font-mono text-2xs tabular text-muted-foreground">{node.count}</span>
      </button>
      {!collapsed ? node.children?.map((child) => (
        <GitDiffTreeRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          collapsedDirectories={collapsedDirectories}
          onSelectFile={onSelectFile}
          onToggleDirectory={onToggleDirectory}
        />
      )) : null}
    </section>
  );
}
