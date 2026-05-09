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
  onOpenDiffDetail,
  onToggleDiffDirectory,
}: MissionDiffPanelProps) {
  const diffTree = buildMissionDiffTree(diffs);

  if (!diffs.length) {
    return (
      <div className="empty-state rounded-md border border-border-ghost bg-surface-sunken p-4 text-sm text-muted-foreground">
        {noDiffSummary}
      </div>
    );
  }

  return (
    <div
      className="mission-inspector-diff mission-change-tree grid min-h-0 gap-1 overflow-y-auto pr-1"
      aria-label="Git Diff 文件列表"
    >
      {diffTree.map((node) =>
        renderDiffTreeNode({
          node,
          collapsedDiffDirectories,
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
  onOpenDiffDetail: (path: string) => void;
  onToggleDiffDirectory: (path: string) => void;
};

function renderDiffTreeNode({
  node,
  depth = 0,
  collapsedDiffDirectories,
  onOpenDiffDetail,
  onToggleDiffDirectory,
}: RenderDiffTreeNodeInput): ReactNode {
  if (node.kind === "file" && node.file) {
    const file = node.file;
    return (
      <button
        key={node.id}
        type="button"
        className="mission-file-row mission-file-row-compact mission-file-row-button grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition hover:bg-surface-emphasis focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => onOpenDiffDetail(file.path)}
      >
        <span className={`mission-file-status status-${file.status} rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary`}>
          {formatDiffStatus(file.status)}
        </span>
        <strong className="min-w-0 truncate">{node.name}</strong>
        {renderDiffStats(file)}
      </button>
    );
  }

  const collapsed = collapsedDiffDirectories.has(node.path);
  return (
    <section
      key={node.id}
      className={`mission-change-group ${collapsed ? "collapsed" : ""} grid gap-1`}
    >
      <button
        type="button"
        className="mission-change-group-title grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-foreground transition hover:bg-surface-emphasis"
        style={{ paddingLeft: `${2 + depth * 14}px` }}
        onClick={() => onToggleDiffDirectory(node.path)}
        aria-expanded={!collapsed}
      >
        <span>{collapsed ? "▸" : "▾"}</span>
        <span className="min-w-0 truncate">{node.name}</span>
        <span className="mission-change-count rounded-full bg-surface-emphasis px-2 py-0.5 text-xs text-muted-foreground">
          {node.count}
        </span>
      </button>
      {!collapsed
        ? node.children?.map((child) =>
            renderDiffTreeNode({
              node: child,
              depth: depth + 1,
              collapsedDiffDirectories,
              onOpenDiffDetail,
              onToggleDiffDirectory,
            }),
          )
        : null}
    </section>
  );
}
