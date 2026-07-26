import { useState, type CSSProperties } from "react";
import {
  Icon,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../shared/ui";
import { copyTextToClipboard } from "../../../shared/utils/clipboard";
import { MarkdownMessage } from "../../../shared/ui/markdown";
import { cn } from "../../../shared/utils/cn";
import type { GitCommit, GitCommitDetailState, GitGraphState } from "../../../store/facade";
import { formatDiffStatus, renderDiffPatch } from "./diff-tree";

type GitGraphPanelProps = {
  style?: CSSProperties;
  gitGraph?: GitGraphState;
  selectedCommitHash?: string | null;
  onSelectCommit?: (hash: string) => void;
};

type GraphRowModel = {
  commit: GitCommit;
  lane: number;
  activeLanes: number[];
  continuingLanes: number[];
  joinLanes: number[];
  mergeLanes: number[];
  laneCount: number;
};

const GRAPH_LANE_WIDTH = 14;
const GRAPH_ROW_HEIGHT = 32;
const GRAPH_LINE_OVERDRAW = 3;
const GRAPH_LANE_COLORS = [
  "#3b82f6",
  "#f97316",
  "#22c55e",
  "#a855f7",
  "#eab308",
];

export function GitGraphPanel({
  style,
  gitGraph,
  selectedCommitHash,
  onSelectCommit,
}: GitGraphPanelProps) {
  const [expandedCommitHash, setExpandedCommitHash] = useState<string | null>(
    selectedCommitHash ?? null,
  );

  function handleToggleCommit(hash: string) {
    if (expandedCommitHash !== hash) {
      onSelectCommit?.(hash);
    }
    setExpandedCommitHash((current) => (current === hash ? null : hash));
  }

  if (gitGraph?.loading) {
    return (
      <div
        className="git-graph-panel flex min-h-0 flex-1 flex-col overflow-auto p-4 text-sm text-muted-foreground"
        style={style}
      >
        <div className="empty-state">{gitGraph.message ?? "正在加载提交历史..."}</div>
      </div>
    );
  }

  if (!gitGraph || !gitGraph.commits?.length) {
    return (
      <div
        className="git-graph-panel flex min-h-0 flex-1 flex-col overflow-auto p-4 text-sm text-muted-foreground"
        style={style}
      >
        <div className="empty-state">暂无提交记录</div>
      </div>
    );
  }

  const rows = buildGraphRows(gitGraph.commits);
  const visibleLaneCount = Math.max(1, ...rows.map(resolveVisibleLaneCount));
  const graphColumnWidth = Math.max(40, visibleLaneCount * GRAPH_LANE_WIDTH + 8);
  const rowColumnStyle = {
    gridTemplateColumns: `${graphColumnWidth}px minmax(0,1fr)`,
  } satisfies CSSProperties;

  return (
    <div
      className="git-graph-panel flex min-h-0 flex-1 flex-col overflow-auto"
      style={style}
    >
      <div
        className="grid items-center gap-2 border-b border-border-ghost px-3 py-2 text-2xs uppercase tracking-[0.08em] text-muted-foreground"
        style={rowColumnStyle}
      >
        <span>Graph</span>
        <span>提交历史</span>
      </div>
      <TooltipProvider delayDuration={180}>
        <div className="git-graph-list">
          {rows.map((row, index) => {
            const isSelected = expandedCommitHash === row.commit.hash;
            return (
              <div key={row.commit.hash} data-commit-index={index}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      data-merge-commit={row.commit.parents.length > 1 ? "true" : undefined}
                      aria-expanded={isSelected}
                      className={cn(
                        "grid h-9 w-full items-center gap-2 px-3 text-left text-xs transition-colors hover:bg-surface-emphasis",
                        isSelected && "bg-surface-emphasis",
                      )}
                      style={rowColumnStyle}
                      onClick={() => handleToggleCommit(row.commit.hash)}
                    >
                      <GraphLaneCell
                        row={row}
                        laneCount={visibleLaneCount}
                        isFirst={index === 0}
                      />
                      <span className="flex h-full min-w-0 items-center gap-2 overflow-hidden border-b border-border-ghost">
                        {row.commit.refs.length > 0 ? (
                          <span className="flex shrink-0 flex-wrap gap-1">
                            {row.commit.refs.map((ref, idx) => (
                              <RefPill key={`${ref.name}-${idx}`} ref={ref} />
                            ))}
                          </span>
                        ) : null}
                        <span className="min-w-0 truncate">{row.commit.subject}</span>
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    align="start"
                    className="max-w-[460px] space-y-2 px-3 py-2 text-left"
                  >
                    <CommitDetail commit={row.commit} />
                  </TooltipContent>
                </Tooltip>
                {isSelected ? (
                  <div className="space-y-2 border-b border-border-ghost bg-surface px-3 py-2 text-left text-xs">
                    <CommitDetail
                      commit={row.commit}
                      detail={gitGraph.commitDetails?.[row.commit.hash]}
                      showFiles
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </TooltipProvider>
    </div>
  );
}

function CommitDetail({
  commit,
  detail,
  showFiles = false,
}: {
  commit: GitCommit;
  detail?: GitCommitDetailState;
  showFiles?: boolean;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const tooltipMarkdown = buildCommitTooltipMarkdown(commit);
  const copyHash = async () => {
    try {
      await copyTextToClipboard(
        commit.hash,
        typeof navigator === "undefined" ? undefined : navigator.clipboard,
      );
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1400);
    } catch {
      setCopyState("failed");
    }
  };
  return (
    <>
      <div className="font-medium text-foreground">{commit.subject}</div>
      {commit.refs.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {commit.refs.map((ref, idx) => (
            <RefPill key={`detail-${commit.hash}-${ref.name}-${idx}`} ref={ref} />
          ))}
        </div>
      ) : null}
      {tooltipMarkdown ? <MarkdownMessage text={tooltipMarkdown} /> : null}
      {typeof commit.changedFiles === "number" ? (
        <div className="text-2xs text-muted-foreground">
          已更改 {commit.changedFiles} 个文件
          {typeof commit.insertions === "number"
            ? `, ${commit.insertions} 行插入(+)`
            : ""}
          {typeof commit.deletions === "number"
            ? `, ${commit.deletions} 行删除(-)`
            : ""}
        </div>
      ) : null}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        <span>作者</span>
        <span>{commit.authorName}</span>
        <span>时间</span>
        <span>{new Date(commit.authoredAt).toLocaleString("zh-CN")}</span>
        <span>提交</span>
        <span className="flex min-w-0 items-center gap-1 font-mono">
          <span className="min-w-0 truncate" title={commit.hash}>{commit.hash}</span>
          <button
            type="button"
            className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-surface-emphasis hover:text-foreground"
            aria-label="复制提交哈希"
            title={copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制提交哈希"}
            onClick={(event) => {
              event.stopPropagation();
              void copyHash();
            }}
          >
            <Icon name={copyState === "copied" ? "check" : "copy"} size={10} />
          </button>
        </span>
      </div>
      {showFiles ? <CommitFileDiffs detail={detail} /> : null}
    </>
  );
}

function CommitFileDiffs({ detail }: { detail?: GitCommitDetailState }) {
  if (!detail || detail.loading) {
    return <div className="text-2xs text-muted-foreground">正在加载提交详情...</div>;
  }
  if (detail.error) {
    return <div className="text-2xs text-destructive">{detail.error}</div>;
  }
  if (!detail.files.length) {
    return <div className="text-2xs text-muted-foreground">该提交没有文件变更。</div>;
  }
  return (
    <div className="overflow-hidden rounded border border-border-ghost bg-surface-sunken">
      {detail.files.map((file) => (
        <details key={`${file.originalPath ?? ""}:${file.path}`} className="group border-b border-border-ghost last:border-b-0">
          <summary className="flex h-7 cursor-pointer list-none items-center gap-2 px-2 text-2xs hover:bg-surface-emphasis/50">
            <span className="w-3 shrink-0 font-semibold text-primary">
              {formatDiffStatus(file.status)}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>{file.path}</span>
            <span className="shrink-0 tabular-nums text-emerald-600">+{file.additions}</span>
            <span className="shrink-0 tabular-nums text-destructive">-{file.deletions}</span>
            <Icon name="chevronDown" size={10} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="max-h-80 overflow-auto border-t border-border-ghost">
            {file.patch ? (
              renderDiffPatch({ patch: file.patch })
            ) : (
              <div className="px-3 py-2 text-2xs text-muted-foreground">该文件没有文本 patch。</div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

function GraphLaneCell({
  row,
  laneCount,
  isFirst,
}: {
  row: GraphRowModel;
  laneCount: number;
  isFirst: boolean;
}) {
  const width = Math.max(laneCount, 1) * GRAPH_LANE_WIDTH;
  const centerY = GRAPH_ROW_HEIGHT / 2;
  const laneColor = resolveGraphLaneColor(row.lane);

  return (
    <span className="flex items-center" aria-hidden="true">
      <svg
        data-graph-svg="true"
        width={width}
        height={GRAPH_ROW_HEIGHT}
        viewBox={`0 0 ${width} ${GRAPH_ROW_HEIGHT}`}
        className="overflow-visible"
      >
        {row.activeLanes.map((laneIndex) => {
          if (row.joinLanes.includes(laneIndex)) {
            return null;
          }
          const x = laneCenterX(laneIndex);
          const strokeColor = resolveGraphLaneColor(laneIndex);
          const lineTop = isFirst ? centerY : -GRAPH_LINE_OVERDRAW;
          const lineBottom = row.continuingLanes.includes(laneIndex)
            ? GRAPH_ROW_HEIGHT + GRAPH_LINE_OVERDRAW
            : centerY;
          return (
            <line
              key={`lane-${row.commit.hash}-${laneIndex}`}
              x1={x}
              y1={lineTop}
              x2={x}
              y2={lineBottom}
              stroke={strokeColor}
              strokeOpacity="0.85"
              strokeWidth={1.6}
            />
          );
        })}
        {row.joinLanes.map((laneIndex) => (
          <path
            key={`join-${row.commit.hash}-${laneIndex}`}
            d={describeJoinPath(laneCenterX(laneIndex), laneCenterX(row.lane), centerY)}
            fill="none"
            stroke={resolveGraphLaneColor(laneIndex)}
            strokeOpacity="0.85"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {row.mergeLanes.map((laneIndex) => (
          <path
            key={`merge-${row.commit.hash}-${laneIndex}`}
            d={describeMergePath(laneCenterX(row.lane), laneCenterX(laneIndex), centerY)}
            fill="none"
            stroke={resolveGraphLaneColor(laneIndex)}
            strokeOpacity="0.85"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            data-merge-edge="true"
          />
        ))}
        <circle
          cx={laneCenterX(row.lane)}
          cy={centerY}
          r={4.5}
          fill={laneColor}
          stroke={laneColor}
          strokeWidth={1}
        />
      </svg>
    </span>
  );
}

function buildGraphRows(commits: GitCommit[]): GraphRowModel[] {
  const rows: GraphRowModel[] = [];
  let lanes: Array<string | null> = [];

  for (const commit of commits) {
    const matchingLanes = lanes.flatMap((value, index) =>
      value === commit.hash ? [index] : [],
    );
    let lane = matchingLanes[0] ?? -1;
    if (lane === -1) {
      lane = lanes.findIndex((value) => value === null);
      if (lane === -1) {
        lane = lanes.length;
      }
      lanes[lane] = commit.hash;
    }

    const activeLanes = lanes.flatMap((value, index) =>
      value ? [index] : [],
    );
    const joinLanes = matchingLanes.filter((laneIndex) => laneIndex !== lane);
    const nextLanes = [...lanes];
    const [firstParent, ...otherParents] = commit.parents;
    nextLanes[lane] = firstParent ?? null;
    for (const joinLane of joinLanes) {
      nextLanes[joinLane] = null;
    }

    const mergeLanes: number[] = [];
    for (const parentHash of otherParents) {
      let parentLane = nextLanes.indexOf(parentHash);
      if (parentLane === -1) {
        parentLane = nextLanes.findIndex(
          (value, index) => index > lane && value === null,
        );
        if (parentLane === -1) {
          parentLane = nextLanes.length;
        }
        nextLanes[parentLane] = parentHash;
      }
      mergeLanes.push(parentLane);
    }

    while (nextLanes.length > 0 && nextLanes.at(-1) === null) {
      nextLanes.pop();
    }
    const continuingLanes = nextLanes.flatMap((value, index) =>
      value ? [index] : [],
    );

    rows.push({
      commit,
      lane,
      activeLanes,
      continuingLanes,
      joinLanes,
      mergeLanes,
      laneCount: Math.max(lanes.length, nextLanes.length, lane + 1),
    });

    lanes = nextLanes;
  }

  return rows;
}

function RefPill({
  ref,
}: {
  ref: { name: string; kind: string; isCurrent: boolean };
}) {
  const kindStyle = {
    branch:
      "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
    tag: "bg-purple-100 text-purple-900 dark:bg-purple-900 dark:text-purple-100",
    detached:
      "bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100",
  }[ref.kind] || "bg-gray-100 text-gray-900 dark:bg-gray-900 dark:text-gray-100";

  const prefix = ref.isCurrent ? "HEAD -> " : "";

  return (
    <span
      className={cn(
        "inline-block rounded px-2 py-0.5 text-2xs font-medium",
        kindStyle,
      )}
    >
      {prefix}
      {ref.name}
    </span>
  );
}

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) {
      return "刚刚";
    }
    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes} 分钟前`;
    }
    if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      return `${hours} 小时前`;
    }
    if (seconds < 604800) {
      const days = Math.floor(seconds / 86400);
      return `${days} 天前`;
    }

    return date.toLocaleDateString("zh-CN");
  } catch {
    return isoString;
  }
}

function buildCommitTooltipMarkdown(commit: GitCommit) {
  if (!commit.body?.trim()) {
    return "";
  }
  const lines = commit.body
    .split(/\r?\n/u)
    .map((line) => line.replace(/\uFFFD/gu, "").trim())
    .filter((line) => /[\p{L}\p{N}\p{Script=Han}]/u.test(line))
    .slice(0, 6);
  if (!lines.length) {
    return "";
  }
  return lines
    .map((line) => (line.startsWith("-") || line.startsWith("*") ? line : `- ${line}`))
    .join("\n");
}

function laneCenterX(laneIndex: number) {
  return laneIndex * GRAPH_LANE_WIDTH + GRAPH_LANE_WIDTH / 2;
}

function resolveGraphLaneColor(laneIndex: number) {
  return GRAPH_LANE_COLORS[laneIndex % GRAPH_LANE_COLORS.length]!;
}

function resolveVisibleLaneCount(row: GraphRowModel) {
  return (
    Math.max(
      row.lane,
      ...row.activeLanes,
      ...row.joinLanes,
      ...row.mergeLanes,
      0,
    ) + 1
  );
}

function describeJoinPath(fromX: number, toX: number, centerY: number) {
  const bendY = centerY - 8;
  const controlX = fromX < toX ? fromX + 8 : fromX - 8;
  return `M ${fromX} ${-GRAPH_LINE_OVERDRAW} L ${fromX} ${bendY} C ${fromX} ${centerY - 2}, ${controlX} ${centerY}, ${toX} ${centerY}`;
}

function describeMergePath(fromX: number, toX: number, centerY: number) {
  const bendY = centerY + 8;
  const controlX = fromX < toX ? toX - 8 : toX + 8;
  return `M ${fromX} ${centerY} C ${fromX} ${centerY + 2}, ${controlX} ${centerY}, ${toX} ${bendY} L ${toX} ${GRAPH_ROW_HEIGHT + GRAPH_LINE_OVERDRAW}`;
}
