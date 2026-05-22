import type { FileDiffSummary } from "@tiller/shared";
import type { ReactNode } from "react";
import {
  buildMissionDiffTree,
  formatDiffStatus,
  renderDiffStats,
  type MissionDiffTreeNode,
} from "./diff-tree";

const EMPTY_COLLAPSED_DIFF_DIRECTORIES: ReadonlySet<string> = new Set();

type MissionDiffPanelProps = {
  selectedDiffFilePath: string | null;
  diffs: FileDiffSummary[];
  noDiffSummary: string;
  collapsedDiffDirectories?: ReadonlySet<string>;
  selectedCommitDiffPaths?: ReadonlySet<string>;
  onToggleCommitDiff?: (path: string) => void;
  onToggleCommitDiffDirectory?: (paths: string[]) => void;
  onOpenDiffDetail: (path: string) => void;
  onToggleDiffDirectory: (path: string) => void;
};

/**
 * Shows session Git diff in the project inspector so file context and changes stay together.
 */
export function MissionDiffPanel({
  diffs,
  noDiffSummary,
  collapsedDiffDirectories = EMPTY_COLLAPSED_DIFF_DIRECTORIES,
  selectedCommitDiffPaths,
  onToggleCommitDiff,
  onToggleCommitDiffDirectory,
  onOpenDiffDetail,
  onToggleDiffDirectory,
}: MissionDiffPanelProps) {
  const diffTree = buildMissionDiffTree(diffs);

  if (!diffs.length) {
    return (
      <div className="empty-state rounded border border-border-ghost bg-surface-sunken p-3 text-meta text-muted-foreground">
        {noDiffSummary}
      </div>
    );
  }

  return (
    <div
      className="mission-inspector-diff mission-change-tree grid min-h-0 gap-0.5 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Git Diff 文件列表"
      data-mission-swipe-lock="true"
    >
      {diffTree.map((node) =>
        renderDiffTreeNode({
          node,
          collapsedDiffDirectories,
          selectedCommitDiffPaths,
          onToggleCommitDiff,
          onToggleCommitDiffDirectory,
          onOpenDiffDetail,
          onToggleDiffDirectory,
        }),
      )}
    </div>
  );
}

type RenderDiffTreeNodeInput = {
  node: MissionDiffTreeNode;
  depth?: number;
  collapsedDiffDirectories: ReadonlySet<string>;
  selectedCommitDiffPaths?: ReadonlySet<string>;
  onToggleCommitDiff?: (path: string) => void;
  onToggleCommitDiffDirectory?: (paths: string[]) => void;
  onOpenDiffDetail: (path: string) => void;
  onToggleDiffDirectory: (path: string) => void;
};

function renderDiffTreeNode({
  node,
  depth = 0,
  collapsedDiffDirectories,
  selectedCommitDiffPaths,
  onToggleCommitDiff,
  onToggleCommitDiffDirectory,
  onOpenDiffDetail,
  onToggleDiffDirectory,
}: RenderDiffTreeNodeInput): ReactNode {
  if (node.kind === "file" && node.file) {
    const file = node.file;
    const selectedForCommit = selectedCommitDiffPaths?.has(file.path) ?? false;
    return (
      <label
        key={node.id}
        className="mission-file-row mission-file-row-compact mission-file-row-button grid w-full grid-cols-[16px_minmax(0,1fr)_auto_auto] items-center gap-1 rounded-none px-1 py-0.5 text-left text-meta text-foreground transition hover:bg-surface-emphasis/60 focus-within:ring-1 focus-within:ring-ring/40"
        style={{ paddingLeft: `${4 + depth * 10}px` }}
      >
        <span
          aria-hidden="true"
          className={`mission-file-status status-${file.status} grid size-3 place-items-center rounded-sm border border-current bg-transparent p-0 font-mono text-[9px] font-semibold leading-none tabular text-primary`}
          title={formatDiffStatus(file.status)}
        >
          {formatDiffStatus(file.status)}
        </span>
        <button
          type="button"
          className="min-w-0 truncate text-left"
          onClick={() => onOpenDiffDetail(file.path)}
        >
          {node.name}
        </button>
        {renderDiffStats(file)}
        <input
          type="checkbox"
          className="ml-1 size-3.5 accent-[var(--primary)]"
          checked={selectedForCommit}
          onChange={() => onToggleCommitDiff?.(file.path)}
          aria-label={`选择 ${file.path} 用于提交`}
          onClick={(event) => event.stopPropagation()}
        />
      </label>
    );
  }

  const collapsed = collapsedDiffDirectories.has(node.path);
  const childFilePaths = collectDiffFilePaths(node);
  const directorySelected = childFilePaths.length > 0 && childFilePaths.every((path) => selectedCommitDiffPaths?.has(path));
  return (
    <section
      key={node.id}
      className={`mission-change-group ${collapsed ? "collapsed" : ""} grid gap-0.5`}
    >
      <div
        className="mission-change-group-title grid w-full grid-cols-[16px_minmax(0,1fr)_auto_auto] items-center gap-1 rounded-none px-1 py-0.5 text-left text-meta font-medium text-foreground transition hover:bg-surface-emphasis/60"
        style={{ paddingLeft: `${0 + depth * 10}px` }}
      >
        <button
          type="button"
          className="grid size-4 place-items-center text-muted-foreground"
          onClick={() => onToggleDiffDirectory(node.path)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "展开" : "收起"} ${node.name}`}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        <button
          type="button"
          className="min-w-0 truncate text-left font-medium"
          onClick={() => onToggleDiffDirectory(node.path)}
        >
          {node.name}
        </button>
        <span className="mission-change-count rounded-sm bg-surface-emphasis/70 px-1.5 py-0 font-mono text-2xs tabular text-muted-foreground">
          {node.count}
        </span>
        <input
          type="checkbox"
          className="ml-1 size-3.5 accent-[var(--primary)]"
          checked={directorySelected}
          disabled={!childFilePaths.length}
          onChange={() => onToggleCommitDiffDirectory?.(childFilePaths)}
          aria-label={`选择 ${node.path || node.name} 下的全部变更用于提交`}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
      {!collapsed
        ? node.children?.map((child) =>
            renderDiffTreeNode({
              node: child,
              depth: depth + 1,
              collapsedDiffDirectories,
              selectedCommitDiffPaths,
              onToggleCommitDiff,
              onToggleCommitDiffDirectory,
              onOpenDiffDetail,
              onToggleDiffDirectory,
            }),
          )
        : null}
    </section>
  );
}

function collectDiffFilePaths(node: MissionDiffTreeNode): string[] {
  if (node.kind === "file") {
    return node.file ? [node.file.path] : [];
  }
  return node.children?.flatMap((child) => collectDiffFilePaths(child)) ?? [];
}
